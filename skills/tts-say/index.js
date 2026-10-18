// 语音回复技能（LLM 型）—— 用户明确要求时，用人设把要说的话**念出来**（语音代替文字）。
//
// ── 为什么是 Skill、为什么工具能"代替文字"───────────────────────────────
//   · 发送能力只在工具的 execute(ctx) 里：ctx.sender / ctx.onebot / ctx.chatKey 全在
//     （orchestrator.js:907-921）。而 5 个钩子（before-context / before-llm-messages /
//     after-response / before-tool / after-tool）**都不带 sender** → 插件型扩展
//     根本没法发语音，除非改核心。所以这里只能是 skill。
//   · "只发语音、不发文字"不需要任何拦截：核心从不会自动把助手文字发出去，
//     模型必须调 send_message 才说话（prompt.js:802、收尾只看 session.sent，
//     orchestrator.js:1258）。所以模型不调 send_message，群里就一个字都没有。
//   · 但模型可能不听话（直接调 send_message）→ 用 before-tool 闸门兜底：
//     本轮是语音模式就把 send_message 拦下来，让它改口用语音工具。
//
// ── TTS：为什么用 Windows 自带语音 ──────────────────────────────────────
//   · 实测：Edge TTS 的 HTTP 端点已 404（微软改成 WSS + DRM 令牌）、Google TTS 网络不通、
//     pip 装 edge-tts 也失败（本机到 PyPI/镜像都不稳）。
//   · Windows SAPI 自带「Microsoft Huihui Desktop」中文女声：**离线、免 key、零依赖**。
//   · 音色更好的路子留了口子：设置里 engine=edge 会调 `python -m edge_tts`，
//     装不上就自动退回 sapi（不会因为缺依赖就哑火）。
//
// ── 投递：为什么能直接发 wav ─────────────────────────────────────────────
//   · 实测 SnowLuma(OneBot v11) 直接接受 wav 的 record 段（file:// / 裸路径 / base64 都成功），
//     **不需要 silk 编码器**；`audio` 段不支持（retcode 1400），别用。
//   · 走 ctx.sender.sendMedia（sender.js:348）：自带去重 + 限频 + 停顿 + 留档，
//     不要绕过它直接调 onebot.sendSegments（会跳过限频留档 → 刷屏/重复发）。
//
// ── 落盘：为什么状态不写技能目录 ─────────────────────────────────────────
//   · skills/ 被 fs.watch 递归监听（plugin-loader.js:565），自己往里写文件会触发
//     热重载 → 内存状态清零，自激循环。音频和状态都放 DATA_DIR。

const BUILD_TAG = 'v1.0.0';

/** 注入标记。⚠️ 必须与 api-beggar 的「【触发】」区分开 ——
 *  两个技能的注入幂等判据都靠"内容里已有自己的标记"，共用一个会让对方误以为已注入。 */
const INJECT_TAG = '【语音触发】';

/** 跨会话（转达给别人）用另一个标记：闸门要能分辨"当前会话语音"和"转达语音"。 */
const CROSS_TAG = '【语音转达】';

/** 核心 user prompt 的分段标记（prompt.js:855）。 */
const UNREAD_MARKER = '【未读信息】';
const CORE_SECTION_RE = /\n【(?:记忆|已读信息|新已读信息|未读信息|新加入成员|当前时间|角色设定|表情包|引导说明)/;

const DEFAULT_KEYWORDS = '发语音,说语音,语音回复,用语音,念一下,读出来,发个语音,语音说,发条语音,能语音吗';

/** 转达意图词：只有它和语音词**同时**出现才走跨会话（宁可少发，绝不误发给别人）。 */
const DEFAULT_CROSS_KEYWORDS = '发给,发到,转告,告诉,私聊,语音发给,发语音给,帮我转告,替我告诉';

/** 中文 TTS 大约每秒 4.5 个字（rate=0），用来估算时长、决定要不要截断。 */
const CHARS_PER_SEC = 4.5;

/**
 * 每秒字节数（静音检测要用）。⚠️ 两个引擎的**单位完全不同**，混用会把正常音频
 * 判成静音：sapi 出 16kHz/16bit/单声道 wav = 32000 B/s；
 * edge 出 48kbps mp3 ≈ 6000 B/s（实测 28.1KB ≈ 4.7 秒，与 4.5 字/秒对得上）。
 */
const BYTES_PER_SEC = { sapi: 32000, edge: 6000 };

/** edge-tts 的安装位置（相对 DATA_DIR）。装这里不进 skills/，不触发热重载。 */
const VENDOR_DIR_NAME = 'tts-vendor';

const SYNTH_TIMEOUT_MS = 30000;

let cfg = () => ({});
let log = () => {};
let warn = () => (() => {});

let stateLoaded = false;
let statePath = '';
let cacheDir = '';
let dataDir = '';   // DATA_DIR 本体，edge-tts 的 vendor 目录从它拼
/** 记住上次哪种投递方式成功过，避免每条都先撞一次失败。 */
let deliveryMemory = '';
let state = { lastSaidAt: 0, lastChatKey: '', targets: {} };

export async function setup(api) {
  cfg = api.config;
  log = api.log || (() => {});
  warn = api.warn || (() => {});
  // setup 是 async（plugin-loader.js:368 会 await）：先把 core 配置读到手，
  // 这样 say_to 的描述能反映真实的开关状态，而不是永远写"未开启"。
  await warmCoreConfig();

  api.registerTool({
    id: 'say',
    name: '发语音',
    description:
      '把要说的话合成成一条语音消息发出去，用来代替打字。'
      + '只在用户明确要求「发语音/念一下/用语音说」时调用；平时不要调。'
      + '调用它就不要再调 send_message —— 语音回复不需要文字。'
      + '返回第一行是 status：ok=已发出语音 / cooling=刚说过、这次算了 / dry-run=演练，没真发 / error=失败。',
    category: 'media',
    icon: '🔊',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要用语音念出来的内容（原样念，不要加"我要说"之类的前缀）' }
      },
      required: ['text']
    },

    async execute(ctx, args) {
      const text = String(args?.text ?? '').trim();
      try {
        return await doSay(ctx, text);
      } catch (error) {
        warn(`语音合成异常：${describe(error)}`);
        return fail(`${humanize(error)}。改用 send_message 打字回复吧。`);
      }
    }
  });

  // ── 跨会话语音：把一句话念给**别的**群/私聊 ────────────────────────────
  //
  // ⚠️ 安全边界：core 的"跨会话发送"管控是**硬编码 send_to 这个 id** 的
  //   （tool-registry.js:186），管不到我们这个工具；执行层那四道校验
  //   （tools.js:220-241）也只写在 send_to 里。所以这里**逐条复刻**一遍，
  //   属于有意的第二道边界（纵深防御），不是重复劳动。
  //   读不到全局配置时 fail-closed：宁可不发，也不做一次没有白名单校验的发送。
  api.registerTool({
    id: 'say_to',
    name: '发语音给指定会话',
    // 描述随开关状态变化（照搬 send_to 的策略：关闭时明确说没权限，
    // 省得模型白试一次）。setup 阶段读一次即可 —— 真正的边界在 execute 里。
    description: (() => {
      const base = '把要说的话合成成语音，发送到另一个群/私聊（不在当前会话里说，而是发去别处）。'
        + '适用于：有人明确让你用语音转告某人/某群。';
      return crossGateState(readSettings(), coreConfig()).open
        ? `${base}先用 get_chats 查目标 chatKey（形如 group:123 / private:456），再传 targetChatKey。只在有明确理由时用，不要骚扰别人。`
        : `${base}（当前未开启：需要「设置 → 工具与技能」的「允许跨会话发送」和本技能的「跨会话语音」两个开关都打开。）`;
    })(),
    category: 'media',
    icon: '📨',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要念给对方听的内容（原样念，不要加"我要告诉TA"之类的前缀）' },
        targetChatKey: { type: 'string', description: '目标会话：group:群号 / private:QQ号（用 get_chats 查，不要自己编）' }
      },
      required: ['text', 'targetChatKey']
    },

    async execute(ctx, args) {
      const text = String(args?.text ?? '').trim();
      const target = String(args?.targetChatKey ?? '').trim();
      try {
        return await doSayTo(ctx, text, target);
      } catch (error) {
        warn(`跨会话语音异常：${describe(error)}`);
        return fail(`跨会话语音失败：${humanize(error)}。改用 send_to 发文字，或在当前会话用 say。`);
      }
    }
  });

  api.registerTool({
    id: 'list_voices',
    name: '列出可用音色',
    description:
      '列出可用的 TTS 音色真名（默认只给中文，14 个；all=true 给全部 100+ 语种）。'
      + '用户问"你能用什么声音说话"、或要换一个音色时调用 —— 拿这里的真名去填「音色」设置，别自己编。',
    category: 'media',
    icon: '🎙️',
    parameters: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'true = 列出全部语种（100+），默认 false 只列中文' }
      },
      required: []
    },

    async execute(ctx, args) {
      try {
        return await doListVoices(args?.all === true);
      } catch (error) {
        warn(`音色列举失败：${describe(error)}`);
        return fail(`列举音色失败：${humanize(error)}`);
      }
    }
  });

  log(`语音回复技能已加载（${BUILD_TAG}，默认 TTS=Windows SAPI 离线；装了 edge-tts 可用神经音色）`);
}

/** 可用性自检：同步返回，绝不做 IO（manager.js:187-199 只认 false / {ok:false}）。 */
export function available() {
  return { ok: true };
}

// ── 钩子：关键词注入 + 文字闸门 ──────────────────────────────────────────

export const hooks = {
  /** 命中关键词才注入指令；不命中什么都不做（零成本）。 */
  'before-llm-messages': async (payload) => {
    try {
      // 跨会话分支要看 core 开关，这里保证配置引用已就绪（读不到 = 按关闭处理）
      if (!coreCfgRef) await warmCoreConfig();
      injectTrigger(payload);
    } catch (error) {
      warn(`语音触发判定失败（本次不注入）：${describe(error)}`);
    }
  },

  /**
   * 语音闸门：本轮是语音模式时，把**文字**发送拦下来。
   * 没有它的话，模型很可能又打字又发语音，就不是"代替"了。
   * 判据 = 本轮消息里有没有我们的注入标记（inputMessages 是注入后的快照，
   * orchestrator.js:876 → 882，写入时机在工具执行之前）。
   *
   * 跨会话模式（转达）下额外拦 send_to：同一句话不该又发文字给别人。
   */
  'before-tool': async (payload) => {
    try {
      const name = payload?.toolName;
      if (name !== 'send_message' && name !== 'send_to') return;   // 只拦文字发送
      if (!voiceModeThisTurn(payload?.session)) return;            // 本轮不是语音模式 → 不碰
      return {
        block: true,
        reason: name === 'send_to'
          ? '用户要求用语音转达：请改用 tts-say__say_to 把内容念给对方，不要用文字发。'
          : '用户要求只用语音回复：请立刻改用 say 工具把刚才要说的内容念出来，不要发文字。'
      };
    } catch (error) {
      warn(`语音闸门异常（本次不拦）：${describe(error)}`);
    }
  }
};

function injectTrigger(payload) {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || !messages.length) return;

  const msg = messages[messages.length - 1];
  if (!msg || msg.role !== 'user' || typeof msg.content !== 'string') return;
  if (msg.content.includes(INJECT_TAG) || msg.content.includes(CROSS_TAG)) return;   // 幂等

  const s = readSettings();
  const tail = unreadTail(msg.content);
  const hit = pickKeyword(tail, s.triggerKeywords);
  if (!hit) return;

  // 转达意图：只有"语音词 + 转达词"同时出现才走跨会话。
  // 宁可少发 —— 单纯说"发语音"永远只在当前会话，绝不莫名发到别人那里。
  const to = pickKeyword(tail, s.crossKeywords);
  if (to) {
    const gate = crossGateState(s, coreConfig());
    if (!gate.open) {
      msg.content = `${msg.content}\n\n${CROSS_TAG}用户要求「${hit}」并想转达给「${to}」，但跨会话语音当前未开启`
        + '（需要「设置 → 工具与技能」的「允许跨会话发送」和本技能的「跨会话语音」两个开关都打开）。'
        + '请直接告诉用户这个功能没开，不要发送任何内容。';
      return;
    }
    msg.content = `${msg.content}\n\n${CROSS_TAG}用户要求用语音转达（触发词「${hit}」+ 转达词「${to}」）：`
      + '① 先用 get_chats 查清楚目标会话的 chatKey（group:群号 / private:QQ号，不要自己编）；'
      + '② 再调用 tts-say__say_to，把要说的话原样放进 text、目标放进 targetChatKey；'
      + `③ 目标必须在白名单内，且本轮最多 ${s.crossMaxPerRun} 条、同一目标 ${s.crossCooldownSec} 秒内不重复。`
      + '④ 不要用 send_message / send_to 发文字（会被拦），转达完就结束这一轮。';
    return;
  }

  msg.content = `${msg.content}\n\n${INJECT_TAG}用户明确要求「${hit}」，这一轮改用语音回复：`
    + '调用 tts-say__say，把你要说的话**原样**放进 text 参数念出来。'
    + '三条硬规矩：① 不要调用 send_message（不要打字）；② 一次只发一条，别拆成多条；'
    + '③ 念完不要再调其它工具，直接结束。'
    + `（若用户是在提问，先想好答案再念，念的就是答案本身。语音上限 ${s.maxChars} 字 / 约 ${s.maxSeconds} 秒，超了会自动截断。）`;
}

/** 本轮是不是语音模式（当前会话或跨会话转达都算）。字段缺失返回 false = 放行。 */
function voiceModeThisTurn(session) {
  const list = session?.inputMessages;
  if (!Array.isArray(list) || !list.length) return false;
  const last = list[list.length - 1];
  if (typeof last?.content !== 'string') return false;
  return last.content.includes(INJECT_TAG) || last.content.includes(CROSS_TAG);
}

function unreadTail(content) {
  const i = content.lastIndexOf(UNREAD_MARKER);
  if (i < 0) return '';
  const rest = content.slice(i + UNREAD_MARKER.length);
  const cut = rest.search(CORE_SECTION_RE);
  return cut >= 0 ? rest.slice(0, cut) : rest;
}

function pickKeyword(tail, rawKeywords) {
  if (!tail) return '';
  const hay = tail.toLowerCase();
  for (const kw of splitKeywords(rawKeywords)) {
    if (hay.includes(kw.toLowerCase())) return kw;
  }
  return '';
}

function splitKeywords(raw) {
  const out = [];
  const seen = new Set();
  for (const piece of String(raw ?? '').split(/[,，、;；|\s]+/)) {
    const kw = piece.trim();
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function doSay(ctx, text) {
  const s = readSettings();
  await loadState();

  if (!text) return tell('error', '没有要念的内容。给 text 传要说的话。');
  if (!ctx?.sender || typeof ctx.sender.sendMedia !== 'function') {
    return fail('这个环境没有发送能力（ctx.sender.sendMedia 不存在），改用文字回复。');
  }
  const chatKey = String(ctx.chatKey || '');
  if (!/^(group|private):\S+$/.test(chatKey)) {
    return fail('拿不到会话信息（chatKey 异常），改用文字回复。');
  }

  // 冷却：同一会话刚念过就别连发
  const left = cooldownLeftMs(s.cooldownSec, chatKey);
  if (left > 0) {
    return tell('cooling',
      `${Math.ceil(left / 1000)} 秒内刚发过语音，这次就不重复了 —— 直接用 send_message 打字回复。`);
  }

  const { text: spoken, truncated, dropped } = fitText(text, s);
  if (!spoken) return tell('error', '要念的内容太短了，一句话都不剩。');

  let audio;
  try {
    audio = await synthesize(spoken, s);
  } catch (error) {
    log(`合成失败：${describe(error)}`);
    return fail(`${synthFailMessage(s, error)}。改用 send_message 打字回复。`);
  }

  const seconds = estimateSeconds(spoken, s);
  const secText = oneDecimal(seconds);
  if (s.dryRun) {
    await cleanupFile(audio.file);
    return tell('dry-run',
      `【演练模式】已合成 ${spoken.length} 字（约 ${secText} 秒，${audio.engine} / ${audio.voice}），`
      + '但**没有发送**。确认音色和内容没问题后，把「演练模式」关掉。'
      + edgeFallbackNote(s, audio) + ignoredNote(audio));
  }

  let sent;
  try {
    sent = await deliver(ctx, audio, s, spoken);
  } catch (error) {
    await cleanupFile(audio.file);
    log(`发送失败：${describe(error)}`);
    return fail(`语音发送失败：${humanize(error)}。改用 send_message 打字回复。`);
  }
  // 发完即删：onebot 已经收完并上传完（sendMedia 是 await 的），留着只会一天天堆文件。
  // 必须 await —— 发射后不管会和下一次合成抢目录，测试也抓不到残留。
  await cleanupFile(audio.file);

  markSaid(chatKey);
  const tail = truncated ? `（原文 ${text.length} 字，已截掉末尾 ${dropped} 字）` : '';
  return tell('ok',
    `已发出语音（${secText} 秒，${audio.engine} / ${audio.voice}${tail}）。`
    + '接下来什么都别做，直接结束这一轮 —— 不要再补文字。'
    + edgeFallbackNote(s, audio) + ignoredNote(audio));
}

/** 先按设定的投递方式发，失败再退到另一种；把成功的记下来。 */
async function deliver(ctx, audio, s, spoken, targetChatKey = null) {
  const chatKey = String(targetChatKey || ctx.chatKey);
  const order = [];
  if (s.delivery === 'record') order.push('record', 'file');
  else if (s.delivery === 'file') order.push('file', 'record');
  else order.push(deliveryMemory === 'file' ? 'file' : 'record', deliveryMemory === 'file' ? 'record' : 'file');

  let firstErr = null;
  for (const kind of order) {
    const fileRef = `file://${audio.file.replace(/\\/g, '/')}`;
    const segments = [{ type: kind, data: { file: fileRef } }];
    try {
      const r = await ctx.sender.sendMedia(chatKey, segments, {
        label: kind === 'record' ? '[语音]' : `[语音文件 ${audio.file.split('.').pop()}]`,
        // 每分钟一个桶：同一分钟内的重复内容会被去重挡掉（防误双发），
        // 过了一分钟同样的内容又能再发（防误伤正常重复）。
        dedupeKey: `tts:${kind}:${hashLite(spoken)}:${Math.floor(Date.now() / 60000)}`
      });
      deliveryMemory = kind;
      log(`语音已发送：${kind} → ${chatKey}（${audio.file}）→ message_id=${r?.message_id ?? '?'}`);
      return r;
    } catch (error) {
      firstErr = firstErr || error;
      log(`投递方式 ${kind} 失败：${describe(error)}`);
    }
  }
  throw firstErr || new Error('所有投递方式都失败了');
}

// ── 跨会话语音 ────────────────────────────────────────────────────────────

/**
 * core 全局配置。getConfig 是**进程内单例**（config.js:542），和核心读同一份，
 * UI 改完设置立刻生效，不用重启也不用刷新技能。
 * 读不到时一律 fail-closed —— 没有白名单校验的跨会话发送是不能接受的。
 */
let coreCfgRef = null;

async function warmCoreConfig() {
  if (coreCfgRef) return coreCfgRef;
  try {
    coreCfgRef = await import('../../src/config.js');
  } catch (error) {
    coreCfgRef = null;
  }
  return coreCfgRef;
}

function coreConfig() {
  try {
    return typeof coreCfgRef?.getConfig === 'function' ? coreCfgRef.getConfig() : null;
  } catch (error) {
    return null;
  }
}

/**
 * 跨会话闸门。判定口径**逐条对齐** tools.js:220-241 的 send_to，
 * 外加本技能自己那道开关（纵深防御：两个开关都开才允许）。
 */
function crossGateState(s, coreCfg) {
  if (!s.crossEnabled) {
    return { open: false, reason: '本技能的「跨会话语音」开关没打开（技能设置 → 跨会话语音）' };
  }
  if (!coreCfg) {
    return { open: false, reason: '读不到全局配置，无法校验白名单，已按关闭处理' };
  }
  if (coreCfg.tools?.crossChatSend !== true) {
    return { open: false, reason: '「允许跨会话发送」未开启（设置 → 工具与技能）' };
  }
  return { open: true, reason: '' };
}

/** 目标是否在白名单内。口径与 send_to 一致：空名单 + allowAllWhenEmpty 才放行。 */
function targetAllowed(coreCfg, targetChatKey) {
  const [kind, id] = targetChatKey.split(':');
  const allow = coreCfg.allow || {};
  const list = (kind === 'group' ? allow.groups : allow.private) || [];
  const allowedAll = list.length === 0 && coreCfg.allowAllWhenEmpty === true;
  return list.map(String).includes(id) || allowedAll;
}

/**
 * 跨会话语音主流程。校验顺序与 send_to 一致
 * （开关 → 格式 → 非当前会话 → 白名单），再加本技能两道：单轮配额、目标冷却。
 */
async function doSayTo(ctx, text, targetChatKey) {
  const s = readSettings();
  await loadState();
  await warmCoreConfig();

  if (!text) return tell('error', '没有要念的内容。给 text 传要说的话。');
  if (!ctx?.sender || typeof ctx.sender.sendMedia !== 'function') {
    return fail('这个环境没有发送能力（ctx.sender.sendMedia 不存在）。');
  }

  const coreCfg = coreConfig();
  const gate = crossGateState(s, coreCfg);
  if (!gate.open) return fail(`跨会话语音未开启：${gate.reason}`);

  if (!/^(group|private):\d+$/.test(targetChatKey)) {
    return fail('targetChatKey 格式应为 group:群号 或 private:QQ号（先用 get_chats 查，不要自己编）。');
  }
  if (targetChatKey === String(ctx.chatKey || '')) {
    return tell('error', `目标 ${targetChatKey} 就是当前会话 —— 用 say 在当前会话发语音就行，别用 say_to。`);
  }
  if (!targetAllowed(coreCfg, targetChatKey)) {
    return fail(`目标 ${targetChatKey} 不在白名单内，不能发送。`);
  }

  // 单轮配额挂在 ctx 上（每轮新建天然隔离，照抄 send_image 的 ctx.xxxState 范式）
  ctx.ttsCrossState = ctx.ttsCrossState || { sent: 0 };
  const cap = Math.max(0, Math.floor(s.crossMaxPerRun));
  if (ctx.ttsCrossState.sent >= cap) {
    return tell('error', `本次运行已经发了 ${ctx.ttsCrossState.sent} 条跨会话语音，达到上限（设置里可调）。`);
  }

  // 目标冷却：sender 的限频是**按会话**算的，跨会话目标之间不共享配额，
  // 所以这里自己记一份"最近给谁发过"。
  const left = targetCooldownLeftMs(s.crossCooldownSec, targetChatKey);
  if (left > 0) {
    return tell('cooling', `${Math.ceil(left / 1000)} 秒内刚给 ${targetChatKey} 发过语音，这次别重复了。`);
  }

  const { text: spoken, truncated, dropped } = fitText(text, s);
  if (!spoken) return tell('error', '要念的内容太短了，一句话都不剩。');

  let audio;
  try {
    audio = await synthesize(spoken, s);
  } catch (error) {
    log(`跨会话合成失败：${describe(error)}`);
    return fail(`${synthFailMessage(s, error)}。`);
  }

  const secText = oneDecimal(estimateSeconds(spoken, s));
  if (s.dryRun) {
    await cleanupFile(audio.file);
    return tell('dry-run',
      `【演练模式】已合成 ${spoken.length} 字（约 ${secText} 秒，${audio.engine} / ${audio.voice}），`
      + `本该发给 ${targetChatKey}，但**没有发送**。确认无误后把「演练模式」关掉。`
      + edgeFallbackNote(s, audio));
  }

  try {
    await deliver(ctx, audio, s, spoken, targetChatKey);
  } catch (error) {
    await cleanupFile(audio.file);
    log(`跨会话发送失败：${describe(error)}`);
    return fail(`语音发送失败：${humanize(error)}。`);
  }
  await cleanupFile(audio.file);

  ctx.ttsCrossState.sent += 1;
  markTargetSaid(targetChatKey);
  // 跨会话发送必须手动留档：收尾状态判的是 session.sent.length
  // （orchestrator.js:1259），不记就会被算成 noreply，UI 会话卡片也不显示。
  if (Array.isArray(ctx.session?.sent)) {
    ctx.session.sent.push({ type: 'text', text: '[语音]', to: targetChatKey });
    try { ctx.emit?.('session-update', ctx.session.id); } catch { /* 通知失败不影响发送结果 */ }
  }

  const tail = truncated ? `（原文 ${text.length} 字，已截掉末尾 ${dropped} 字）` : '';
  return tell('ok', `已把语音发到 ${targetChatKey}（${secText} 秒，${audio.engine} / ${audio.voice}${tail}）。不要再补文字，直接结束。`
    + edgeFallbackNote(s, audio) + ignoredNote(audio));
}

// ── 合成 ──────────────────────────────────────────────────────────────────

/**
 * 合成语音。engine=sapi 走 PowerShell + System.Speech（离线）；
 * engine=edge 走 `python -m edge_tts`（**必须带 PYTHONPATH**，否则找不到
 * 装在 data/tts-vendor 里的包），装不上或失败就退回 sapi。
 * 返回 { file, engine, voice }，文件由调用方负责删。
 */
async function synthesize(text, s) {
  const out = await ensureCacheDir();
  const base = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const voice = effectiveVoice(s);

  if (s.engine === 'edge') {
    const mp3 = `${out}/${base}.mp3`;
    try {
      await assertVoiceExists(voice);          // 名字拼错就别白跑一趟网络
      const args = ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', mp3];
      // edge 的参数必须写成 --rate=+10% 这种带等号的形式（负值尤其，否则被当成选项）
      const rate = edgeRateArg(s.rate);
      const vol = edgeVolumeArg(s.volume);
      const pitch = edgePitchArg(s.pitch);
      if (rate) args.push(`--rate=${rate}`);
      if (vol) args.push(`--volume=${vol}`);
      if (pitch) args.push(`--pitch=${pitch}`);
      await runProcess('python', args, SYNTH_TIMEOUT_MS, { env: edgeEnv() });
      if (!(await fileOk(mp3, 1024))) throw new Error('edge-tts 没有产出音频');
      await assertNotSilent(mp3, text, s, BYTES_PER_SEC.edge);
      return { file: mp3, engine: 'edge', voice };
    } catch (error) {
      // 文件可能已经写出来了（静音/格式不对时），失败路径必须自己收拾干净 ——
      // 抛给调用方后它拿不到 audio 引用，没法删，tts-cache 会一天天堆文件。
      await cleanupFile(mp3);
      log(`edge 引擎不可用（${describe(error)}），退回 Windows 自带语音`);
      edgeUnavailableReason = describe(error);
    }
  }

  const wav = `${out}/${base}.wav`;
  try {
    await runSapi(text, s, wav);
    if (!(await fileOk(wav, 1024))) throw new Error('合成结束但没有拿到音频文件');
    // 空音频兜底：SAPI 在异常路径下会写出 59KB 的空 wav（前面已用 exit 1 堵住，
    // 这里再按"字节数 vs 预估时长"核一次 —— 明显不成比例就当没合成出来，绝不发静音。
    await assertNotSilent(wav, text, s, BYTES_PER_SEC.sapi);
  } catch (error) {
    await cleanupFile(wav);   // 同上：抛错前自己删，别把半成品留在缓存里
    throw error;
  }
  // sapi 只认 Windows 音色名。它不报错、直接用 s.voice 合成 —— 填了 voiceOther
  // 却被静默忽略，是最容易让人以为"名字写错了"的情况，所以必须说出来。
  return { file: wav, engine: 'sapi', voice: s.voice, ignored: ignoredOtherNote(s) };
}

/** voiceOther 在 sapi 下被忽略时的提示（edge 下不会走到这里）。 */
function ignoredOtherNote(s) {
  if (!String(s.voiceOther ?? '').trim()) return '';
  return `你填的「其它音色」${s.voiceOther} 只在 edge 引擎下生效；当前是 sapi（Windows 自带语音），`
    + `这次用的是「${s.voice}」。想用它请把「TTS 引擎」改成 edge。`;
}

/** 实际使用的音色：voiceOther 优先（逃生口：填 en-US-JennyNeural 之类非中文名）。 */
function effectiveVoice(s) {
  return String(s.voiceOther ?? '').trim() || s.voice;
}

/**
 * 合成失败时给用户的话。⚠️ 选了 edge 却退回 sapi、sapi 又失败时，
 * **必须把 edge 的失败原因一起说出来** —— 那是根因（多半是"音色名不存在"，
 * 后面跟着可用音色清单）。只报 sapi 的错会让人以为该去装 Windows 音色，
 * 完全指错方向（实测踩过：edge 名字写错 → 报"系统里没有 Microsoft Huihui…"）。
 */
function synthFailMessage(s, error) {
  const sapiMsg = humanize(error);
  if (s.engine === 'edge' && edgeUnavailableReason) {
    return `语音合成失败：${edgeUnavailableReason}；退回 Windows 自带语音也没成功：${sapiMsg}`;
  }
  return `语音合成失败：${sapiMsg}`;
}

/** 选了 edge 却退回 sapi 时，把真实原因带上 —— 不然用户以为"换引擎没效果"。 */
function edgeFallbackNote(s, audio) {
  if (s.engine !== 'edge' || audio.engine !== 'sapi') return '';
  return `\n⚠️ 你选的是 edge 引擎，但这次退回 Windows 自带语音了。原因：${edgeUnavailableReason || '未知'}`
    + `\n想用神经音色就先装：${installHint()}`;
}

/** synthesize 里记下的「voiceOther 被 sapi 忽略」提示，附在结果末尾。 */
function ignoredNote(audio) {
  return audio?.ignored ? `\n⚠️ ${audio.ignored}` : '';
}

// ── 音色清单（edge-tts）──────────────────────────────────────────────────

const VOICE_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const VOICE_CACHE_FILE = 'tts-voices.json';

/** 读缓存；过期或没有就现查一次。查不到返回空数组（调用方决定怎么处理）。 */
async function loadVoices({ force = false } = {}) {
  await loadState();
  const file = dataDir ? `${dataDir}\\${VOICE_CACHE_FILE}` : '';
  if (file && !force) {
    try {
      const m = await import('node:fs');
      const raw = JSON.parse((m.default || m).readFileSync(file, 'utf8'));
      const at = Number(raw?.at) || 0;
      if (Array.isArray(raw?.voices) && Date.now() - at < VOICE_CACHE_TTL_MS) return raw.voices;
    } catch { /* 没有缓存 / 半截文件：现查 */ }
  }
  const voices = await queryVoices();
  if (voices.length && file) {
    try {
      const m = await import('node:fs');
      (m.default || m).writeFileSync(file, JSON.stringify({ at: Date.now(), voices }), 'utf8');
    } catch { /* 缓存写不进去不影响主流程 */ }
  }
  return voices;
}

/** 跑 `python -m edge_tts --list-voices` 并解析表格输出。 */
async function queryVoices() {
  await warmCoreConfig();
  const vendor = vendorDir();
  if (!vendor) throw new Error('拿不到数据目录，无法定位 edge-tts');
  const { code, stdout, stderr } = await runProcess('python', ['-m', 'edge_tts', '--list-voices'], 20000, { env: edgeEnv() });
  if (code !== 0) {
    const err = String(stderr || stdout || '').trim();
    if (/No module named/i.test(err) || /找不到/i.test(err)) {
      throw new Error(`edge-tts 没装好（${installHint()}）`);
    }
    throw new Error(err.slice(0, 160) || `edge-tts 退出码 ${code}`);
  }
  return parseVoiceTable(String(stdout || ''));
}

/**
 * 解析 `--list-voices` 的固定宽度表格：
 *   Name    Gender    ContentCategories      VoicePersonalities
 *   zh-CN-XiaoxiaoNeural   Female   News, Novel   Warm
 * 姓名用"以 Neural 结尾且无空格"判定，避免靠列位置切（Gender 可能是 Female/Male 两位对齐）。
 */
/**
 * 音色名合法性：zh-CN-XiaoxiaoNeural / af-ZA-AdriNeural / yue-Hant-HKNeural
 * ⚠️ 名字本身以 Neural 结尾，所以**不能**写成 "...-Neural" 那种前缀式来切：
 *    `(?:-[A-Za-z]+)+` 这种嵌套量词会把结尾的 Neural 一起吃掉，
 *    整行正则实测 322 行一个都匹配不上（0 命中）。改成"整段取名 + 整段校验"，
 *    不依赖任何回溯，实测 322/322 全中。
 */
const VOICE_NAME_RE = /^[a-z]{2,3}(?:-[A-Za-z]+)+Neural$/i;

function parseVoiceTable(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^Name\s+Gender/i.test(t)) continue;    // 表头
    if (/^-{3,}$/.test(t)) continue;            // 分隔线
    // 列之间是 2 个以上空格；列内（如 "News, Novel"）只有 1 个空格，不会被切开
    const parts = t.split(/\s{2,}/);
    const name = (parts[0] || '').trim();
    if (!VOICE_NAME_RE.test(name)) continue;    // 非法名 → 丢弃（顺带吃掉表头/噪声行）
    const gender = /^(male|female)$/i.test((parts[1] || '').trim()) ? parts[1].trim() : '';
    const detail = parts.slice(gender ? 2 : 1).map((s) => s.trim()).filter(Boolean).join(' · ');
    out.push({ name, gender, detail });
  }
  return out;
}

/**
 * edge-tts 安装提示。⚠️ 路径**运行时从 DATA_DIR 拼**，不能写死：
 * 写死既会泄漏使用者的用户名/安装布局，换台机器也一定抄错（压缩包版、
 * 换盘、换用户名 → 路径完全不同）。
 * 拿不到 DATA_DIR 时退回占位符说明，照着装的人自己能对上。
 */
function installHint() {
  const target = vendorDir();
  const where = target || '「QQ Agent 的 data 目录」\\tts-vendor';
  return '请先执行：python -m pip install -i https://mirrors.aliyun.com/pypi/simple/ '
    + `--target "${where}" edge-tts`;
}

function isChineseVoice(v) {
  return /^zh(-|_)/i.test(String(v || ''));
}

function formatVoiceList(voices, all) {
  const list = all ? voices : voices.filter((v) => isChineseVoice(v.name));
  if (!list.length) return '（没查到任何音色）';
  const head = all ? `共 ${list.length} 个音色` : `中文音色 ${list.length} 个（另有 ${voices.length - list.length} 个非中文，用 all=true 查看）`;
  return `${head}\n` + list.map((v) => `- ${v.name}  [${v.gender}] ${v.detail}`).join('\n')
    + '\n把上面的名字原样填进「音色」设置（不要拼多个、不要加空格）。';
}

async function doListVoices(all) {
  const s = readSettings();
  let voices;
  try {
    voices = await loadVoices();
  } catch (error) {
    return fail(`读不到音色清单：${humanize(error)}。${installHint()}`);
  }
  if (!voices.length) {
    return fail(`音色清单是空的。${installHint()}`);
  }
  const zh = voices.filter((v) => isChineseVoice(v.name));
  const cur = effectiveVoice(s);
  const curOk = voices.some((v) => v.name === cur);
  const tail = curOk
    ? `当前「音色」= ${cur}（有效）`
    : `⚠️ 当前「音色」= ${cur || '(空)'} **不在清单里**，多半是名字拼错了 —— 请从上面挑一个填进去。`;
  return tell('ok', `${formatVoiceList(voices, all)}\n${tail}`);
}

/**
 * 合成前校验音色名。缓存里有清单时严格比对 —— 用户把两个名字粘一起
 * （zh-CN-XiaoxiaoNeural / YunxiNeural）这种错必须当场报出来，
 * 否则要么白跑一次网络请求，要么回落到 sapi 却拿 edge 音色名去合成。
 */
async function assertVoiceExists(voice) {
  let voices = [];
  try {
    voices = await loadVoices();
  } catch {
    return;   // 读不到清单就不校验（不因为校验失败而挡住合成）
  }
  if (!voices.length) return;
  if (voices.some((v) => v.name === voice)) return;
  const zh = voices.filter((v) => isChineseVoice(v.name)).map((v) => v.name);
  const near = voices.filter((v) => voice && (v.name.toLowerCase().includes(String(voice).toLowerCase().slice(0, 8))
    || String(voice).toLowerCase().includes(v.name.toLowerCase().slice(0, 8)))).map((v) => v.name);
  const tip = near.length ? `你是不是想用：${near.slice(0, 3).join(' / ')}？`
    : `中文音色可选：${zh.join('、')}`;
  throw new Error(`音色「${voice}」不存在。${tip}`);
}

/**
 * SAPI rate(-10~10) → edge --rate=±N%。
 * SAPI 里 +1 约提速 10%，edge 正好用百分比，1:1 映射。
 */
function edgeRateArg(rate) {
  const n = clampInt(rate, -10, 10);
  return n === 0 ? '' : `${n > 0 ? '+' : ''}${n * 10}%`;
}

/** SAPI volume(0~100，100 为正常) → edge --volume=±N%（edge 的 0% 才是正常音量）。 */
function edgeVolumeArg(volume) {
  const v = clampInt(volume, 0, 100);
  const delta = v - 100;
  return delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}%`;
}

/** 音高（Hz），SAPI 没有这个能力，只有 edge 用得上。 */
function edgePitchArg(pitch) {
  const n = clampInt(pitch, -50, 50);
  return n === 0 ? '' : `${n > 0 ? '+' : ''}${n}Hz`;
}

/**
 * edge-tts 装在 data/tts-vendor，用 --target 装的，**不在 sys.path 里**，
 * 所以必须显式给 PYTHONPATH，否则 `python -m edge_tts` 会报 No module named。
 */
function edgeEnv() {
  const base = { ...process.env };
  const vendor = vendorDir();
  if (!vendor) return base;
  const prev = base.PYTHONPATH || '';
  base.PYTHONPATH = prev ? `${vendor};${prev}` : vendor;   // Windows 用分号
  return base;
}

function vendorDir() {
  if (!dataDir) return '';
  return `${dataDir.replace(/[\\/]+$/, '')}\\${VENDOR_DIR_NAME}`;
}

/** 一次失败记下原因，报错时能告诉用户到底缺什么（而不是干巴巴一句"退回 sapi"）。 */
let edgeUnavailableReason = '';

/**
 * 用 PowerShell 调 System.Speech 合成 wav。
 * 走 -EncodedCommand（UTF-16LE base64）：中文和引号都不用跟命令行转义较劲。
 */
async function runSapi(text, s, outFile) {
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  // ⚠️ 这里必须自己 try/catch + exit 1：**PowerShell 遇到方法调用异常时退出码仍是 0**
  // （实测 SelectVoice 音色不存在 → 退出码 0，而且照样写出一个 59KB 的空 wav）。
  // 只看退出码会把"静音语音"当成合成成功发出去。$ErrorActionPreference='Stop'
  // 让非终止性错误也进 catch，catch 里明确 exit 1。
  const script = [
    "$ErrorActionPreference='Stop'",
    'try {',
    '  Add-Type -AssemblyName System.Speech',
    '  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `  $s.SelectVoice(${q(s.voice)})`,
    `  $s.Rate = ${clampInt(s.rate, -10, 10)}`,
    `  $s.Volume = ${clampInt(s.volume, 0, 100)}`,
    `  $s.SetOutputToWaveFile(${q(outFile)})`,
    `  $s.Speak(${q(text)})`,
    '  $s.SetOutputToNull()',
    '  $s.Dispose()',
    `  if(-not (Test-Path ${q(outFile)})){ Write-Error '没有产出音频文件'; exit 2 }`,
    '  exit 0',
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 1',
    '}'
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { code, stderr, stdout } = await runProcess('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    SYNTH_TIMEOUT_MS);

  if (code !== 0) {
    const err = String(stderr || stdout || '').trim();
    // 音色不存在时 SAPI 的报错很难懂，换成一句能照着改的提示
    if (/voice|音色|SelectVoice|未安装匹配/i.test(err) || /找不到|cannot find/i.test(err)) {
      const voices = await listSapiVoices();
      throw new Error(`系统里没有「${s.voice}」这个音色。可用的：${voices.join('、') || '(一个都没有)'}`);
    }
    throw new Error(err.slice(0, 200) || `PowerShell 退出码 ${code}`);
  }
}

async function listSapiVoices() {
  try {
    const { stdout } = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }'
    ], 10000);
    return String(stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ESM 里没有 require，child_process 只能动态 import；
// 模块有缓存，每次 await 一次几乎零开销，换来的是"不碰核心、不引第三方依赖"。
async function runProcess(cmd, args, timeoutMs = 20000, opts = {}) {
  let spawn;
  try {
    const cp = await import('node:child_process');
    spawn = (cp.default || cp).spawn;
  } catch (error) {
    throw new Error(`拿不到子进程模块：${error?.message || error}`);
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts });
    } catch (error) {
      reject(new Error(`启动 ${cmd} 失败：${error?.message || error}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error(`${cmd} 超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`启动 ${cmd} 失败：${error?.message || error}`));
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * 静音兜底。⚠️ bytesPerSec 必须按引擎给：sapi 是 wav(32000 B/s)，
 * edge 是 mp3(≈6000 B/s)。用错单位会把 edge 的正常音频判成静音。
 * 实测：sapi 的空 wav 恰好约 59KB（≈1.9 秒，与文本长度无关）。
 * 判据：实际时长明显短于预估的 40% → 判定为没念出来，抛错。
 */
async function assertNotSilent(file, text, s, bytesPerSec) {
  let bytes = 0;
  try {
    const m = await import('node:fs');
    bytes = (m.default || m).statSync(file).size;
  } catch { return; /* 读不到大小就算了，上面已经查过文件存在 */ }

  const actualSec = bytes / bytesPerSec;
  const expectSec = estimateSeconds(text, s);
  if (actualSec < expectSec * 0.4) {
    log(`合成结果疑似静音：${bytes} 字节 ≈ ${actualSec.toFixed(1)} 秒，预估 ${expectSec.toFixed(1)} 秒`);
    throw new Error('合成结果是静音（时长对不上），已拦下不发送');
  }
}

async function fileOk(path, minBytes = 1) {
  try {
    const fs = await import('node:fs');
    const st = fs.statSync(path);
    return st.isFile() && st.size >= minBytes;
  } catch {
    return false;
  }
}

async function cleanupFile(path) {
  if (!path) return;
  try {
    const m = await import('node:fs');
    const fs = m.default || m;
    fs.unlinkSync(path);
  } catch { /* 已经没了 / 没权限就算了，缓存目录本来就该是临时的 */ }
}

async function ensureCacheDir() {
  if (cacheDir) return cacheDir;
  await loadState();
  return cacheDir || `${process.env.TEMP || 'C:/Windows/Temp'}`;
}

// ── 截断与时长估算 ────────────────────────────────────────────────────────

/** 超字数/超时长就在最近的标点处断开，截不出标点才硬切。 */
function fitText(text, s) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const byChars = Math.max(1, Math.floor(s.maxChars));
  const bySeconds = Math.max(1, Math.floor(s.maxSeconds * CHARS_PER_SEC * rateFactor(s.rate)));
  const limit = Math.min(byChars, bySeconds);

  if (clean.length <= limit) return { text: clean, truncated: false, dropped: 0 };

  let cut = clean.slice(0, limit);
  const punct = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'),
    cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf('；'), cut.lastIndexOf('. '));
  if (punct > limit * 0.5) cut = cut.slice(0, punct + 1);
  return { text: cut.trim(), truncated: true, dropped: clean.length - cut.trim().length };
}

function rateFactor(rate) {
  // SAPI 的 Rate 每 +1 约提速 10%，与估算对齐
  return Math.max(0.4, 1 + (Number(rate) || 0) / 10);
}

/** 一位小数就够了 —— 5.333333333333333 秒这种数字给模型看纯属浪费 token。 */
function oneDecimal(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

function estimateSeconds(text, s) {
  return Math.max(0.5, text.length / (CHARS_PER_SEC * rateFactor(s.rate)));
}

// ── 状态落盘 ──────────────────────────────────────────────────────────────

/** 冷却：只看同一个会话（换个群就该能立刻发）。 */
function cooldownLeftMs(cooldownSec, chatKey) {
  if (!(cooldownSec > 0) || !state.lastSaidAt) return 0;
  if (state.lastChatKey && state.lastChatKey !== chatKey) return 0;
  const end = state.lastSaidAt + cooldownSec * 1000;
  return end > Date.now() ? end - Date.now() : 0;
}

/** 跨会话：按**目标**记冷却（sender 的限频是按会话算的，跨会话不共享配额）。 */
function targetCooldownLeftMs(cooldownSec, targetChatKey) {
  if (!(cooldownSec > 0)) return 0;
  const at = Number(state.targets?.[targetChatKey]) || 0;
  if (!at) return 0;
  const end = at + cooldownSec * 1000;
  return end > Date.now() ? end - Date.now() : 0;
}

function markTargetSaid(targetChatKey) {
  // 只留最近 20 个目标，防止状态文件无限增长
  const targets = { ...(state.targets || {}), [targetChatKey]: Date.now() };
  const keys = Object.keys(targets).sort((a, b) => targets[b] - targets[a]).slice(0, 20);
  state.targets = Object.fromEntries(keys.map((k) => [k, targets[k]]));
  saveState();
}

function markSaid(chatKey) {
  state.lastSaidAt = Date.now();
  state.lastChatKey = chatKey;
  saveState();
}

/**
 * 音频目录 + 状态文件都放 DATA_DIR（核心 config.js 的真实数据目录）。
 * 绝不能放技能目录：skills/ 被 fs.watch 递归监听（plugin-loader.js:565），
 * 自己写文件 → 触发热重载 → 内存清零，自激循环。
 */
async function loadState() {
  if (stateLoaded) return;
  stateLoaded = true;

  let fs = null;
  let pathMod = null;
  try { const m = await import('node:fs'); fs = m.default || m; } catch { fs = null; }
  try { const m = await import('node:path'); pathMod = m.default || m; } catch { pathMod = null; }

  let dir = '';
  try {
    const { DATA_DIR } = await import('../../src/config.js');
    dir = DATA_DIR;
  } catch (error) {
    try { const os = await import('node:os'); dir = (os.default || os).tmpdir(); } catch { dir = ''; }
  }
  if (!dir || !fs || !pathMod) {
    warn('拿不到可用目录，语音音频只能落系统临时目录（冷却只在内存里记）');
    cacheDir = process.env.TEMP || 'C:/Windows/Temp';
    return;
  }

  cacheDir = pathMod.join(dir, 'tts-cache');
  statePath = pathMod.join(dir, 'tts-say-state.json');
  dataDir = dir;
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch { /* 建不了就用临时目录 */ }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (raw && typeof raw === 'object') {
      state.lastSaidAt = Number(raw.lastSaidAt) || 0;
      state.lastChatKey = String(raw.lastChatKey || '');
      state.targets = (raw.targets && typeof raw.targets === 'object') ? raw.targets : {};
      deliveryMemory = String(raw.delivery || '');
    }
  } catch { /* 新文件 / 半截文件：按默认值继续 */ }
}

function saveState() {
  if (!statePath) return;
  import('node:fs').then((m) => {
    const fs = m.default || m;
    try {
      fs.writeFileSync(statePath, JSON.stringify({
        lastSaidAt: state.lastSaidAt,
        lastChatKey: state.lastChatKey,
        targets: state.targets,
        delivery: deliveryMemory
      }), 'utf8');
    } catch (error) {
      warn(`状态落盘失败（下次重启冷却重置）：${describe(error)}`);
    }
  }).catch(() => { /* ignore */ });
}

// ── 配置与小工具 ──────────────────────────────────────────────────────────

/** 每次执行现读（用户改完设置立刻生效）。脏值一律回退默认，绝不抛错。 */
function readSettings() {
  const c = cfg() || {};
  const num = (v, d, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(max, Math.max(min, n));
  };
  return {
    engine: c.engine === 'edge' ? 'edge' : 'sapi',
    voice: String(c.voice ?? '').trim() || 'Microsoft Huihui Desktop',
    voiceOther: String(c.voiceOther ?? '').trim(),
    rate: num(c.rate, 0, -10, 10),
    pitch: num(c.pitch, 0, -50, 50),
    volume: num(c.volume, 100, 0, 100),
    maxChars: num(c.maxChars, 300, 1, 5000),
    maxSeconds: num(c.maxSeconds, 60, 1, 600),
    cooldownSec: num(c.cooldownSec, 60, 0, 86400),
    delivery: c.delivery === 'file' ? 'file' : 'record',
    triggerKeywords: String(c.triggerKeywords ?? '').trim() || DEFAULT_KEYWORDS,
    // 跨会话：默认**关**。两道开关（core 的 crossChatSend + 这个）都开才允许转达。
    crossEnabled: c.crossEnabled === true,
    crossKeywords: String(c.crossKeywords ?? '').trim() || DEFAULT_CROSS_KEYWORDS,
    crossMaxPerRun: num(c.crossMaxPerRun, 2, 0, 20),
    crossCooldownSec: num(c.crossCooldownSec, 300, 0, 86400),
    dryRun: c.dryRun !== false
  };
}

function tell(status, text) {
  return { content: `status: ${status}\n${text}` };
}

/** 失败一律走 isError（不抛错）—— 抛错会被上层兜成通用错误，模型拿不到有用信息。 */
function fail(message) {
  return { content: message, isError: true };
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function hashLite(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function describe(error) {
  if (!error) return '未知错误';
  return String(error?.message || error);
}

/** 给模型看的错误文案：去掉 PowerShell 之类的内部噪声。 */
function humanize(error) {
  const text = describe(error);
  if (/静音/.test(text)) return '合成结果是静音，已拦下（不会发出去）';
  if (/超时/.test(text)) return '合成超时了（文本可能太长）';
  // 音色错误后面跟着"可选：xxx / 你是不是想用"这类可照抄的清单，必须原样透出
  if (/音色/.test(text) && /(可选|是不是想用|不在清单)/.test(text)) return text;
  if (/edge-tts 没装好|读不到音色清单/.test(text)) return text;
  if (/音色/.test(text) && /可用的：/.test(text)) return text;
  if (/音色|voice/i.test(text)) return '音色不对或系统里没装';
  if (/系统找不到指定的文件|不是内部或外部命令|spawn .* ENOENT/i.test(text)) return '调不起系统语音引擎';
  if (/拒绝访问|denied/i.test(text)) return '系统拒绝了这次调用';
  return '合成过程出错';
}
