// 设置页（V1.1.0 · P1）：按原版 12 个分组重建，字段与保存语义对齐。
// 真实接口：GET/POST /api/config；密钥字段留空 = 不修改。
(() => {
  'use strict';
  const { api, toast, esc } = window.TS;
  const $ = (s, r = document) => r.querySelector(s);
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const splitList = (v) => String(v || '').split(/[\n,，、]+/).map((x) => x.trim()).filter(Boolean);
  const isMasked = (v) => typeof v === 'string' && v.includes('******');

  let providers = [];

  const F = (label, inner, hint = '') => `<div class="field"><label>${esc(label)}</label>${inner}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
  const input = (id, value, type = 'text', extra = '') => `<input id="${id}" type="${type}" value="${esc(value ?? '')}" ${extra} />`;
  const area = (id, value, rows = 4) => `<textarea id="${id}" rows="${rows}">${esc(value ?? '')}</textarea>`;
  const select = (id, options, value) => `<select id="${id}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const check = (id, checked, label) => `<label class="check" style="margin-bottom:8px"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /> ${esc(label)}</label>`;

  function card(id, title, desc, body, { save = true, extra = '' } = {}) {
    return `<section class="setting-card" data-card="${id}">
      <h3>${esc(title)}</h3><div class="desc">${esc(desc)}</div>
      ${body}
      <div class="setting-actions">
        ${save ? `<button class="btn primary" data-save="${id}" type="button">保存</button>` : ''}
        ${extra}<span class="status" data-status="${id}"></span>
      </div></section>`;
  }

  function render() {
    Promise.all([
      api('/api/config'),
      api('/api/providers').catch(() => ({ providers: [] })),
      api('/api/version').catch(() => null)
    ]).then(([data, prov, ver]) => {
      providers = prov.providers || [];
      const a = data.api || {}, ws = data.webSearch || {}, mem = data.memory || {};
      const per = data.persona || {}, allow = data.allow || {}, send = data.send || {};
      const mute = data.commandMute || {}, pro = data.proactive || {}, ob = data.snowluma || {};
      const ui = data.ui || {}, server = data.server || {}, tools = data.tools || {}, cats = tools.categories || {};
      const provOptions = (providers.length ? providers.map((p) => [p.id, p.displayName || p.name || p.id]) : [[a.provider || 'custom', a.provider || 'custom']]);
      const searchProv = [['bing', 'Bing 网页'], ['deepseek', 'DeepSeek'], ['zhipu', '智谱'], ['bocha', '博查'], ['baidu', '百度千帆'], ['metaso', '秘塔'], ['custom', '自定义']];
      const secretHint = (v) => isMasked(v) ? '已配置；留空表示不修改' : '未配置';

      const modelBody = [
        F('模型供应商', select('s_provider', provOptions, a.provider)),
        F('默认模型', input('s_model', a.model)),
        F('API Base URL', input('s_baseurl', a.baseUrl)),
        F('API Key', input('s_apikey', '', 'password', `placeholder="${secretHint(a.apiKey)}" autocomplete="off"`)),
        F('视觉模型', input('s_vision', a.visionModel), '留空则不做图片理解'),
        F('备选模型（每行一个）', area('s_fallback', (a.fallbackModels || []).join('\n'), 3), '主模型失败时按顺序尝试'),
        F('temperature', input('s_temp', a.temperature ?? 0.7, 'number', 'step="0.1" min="0" max="2"')),
        F('最大轮数 maxRounds', input('s_rounds', a.maxRounds ?? 8, 'number', 'min="1" max="50"')),
        F('超时（毫秒）', input('s_timeout', a.timeoutMs ?? 60000, 'number', 'min="1000"'))
      ].join('');

      const costBody = [
        F('输入单价（元 / 百万 Token）', input('s_price_in', a.priceInputPerM ?? 0, 'number', 'step="0.01"')),
        F('输出单价（元 / 百万 Token）', input('s_price_out', a.priceOutputPerM ?? 0, 'number', 'step="0.01"')),
        F('缓存命中单价（元 / 百万 Token）', input('s_price_cached', a.priceCachedPerM ?? 0, 'number', 'step="0.01"')),
        check('s_use_official', a.useOfficialPrice !== false, '使用远程官方价格表（失败时回退本地单价）')
      ].join('');

      const searchBody = [
        check('s_search_enabled', ws.enabled !== false, '启用联网搜索'),
        F('搜索提供方', select('s_search_provider', searchProv, ws.provider || 'bing')),
        F('搜索地址（Bing 兼容）', input('s_search_url', ws.searchUrl || '')),
        F('最大结果数', input('s_search_max', ws.maxResults ?? 10, 'number', 'min="1" max="30"')),
        F('DeepSeek API Key', input('s_ds_key', '', 'password', `placeholder="${secretHint(ws.deepseek?.apiKey)}"`)),
        F('DeepSeek 模型', input('s_ds_model', ws.deepseek?.model || 'deepseek-chat')),
        F('智谱 API Key', input('s_zp_key', '', 'password', `placeholder="${secretHint(ws.zhipu?.apiKey)}"`)),
        F('博查 API Key', input('s_bocha_key', '', 'password', `placeholder="${secretHint(ws.bocha?.apiKey)}"`)),
        F('百度千帆 API Key', input('s_baidu_key', '', 'password', `placeholder="${secretHint(ws.baidu?.apiKey)}"`)),
        F('秘塔 API Key', input('s_metaso_key', '', 'password', `placeholder="${secretHint(ws.metaso?.apiKey)}"`))
      ].join('');

      const memoryBody = [
        check('s_mem_consolidate', mem.consolidateEnabled !== false, '启用自动记忆整理'),
        F('整理间隔（分钟）', input('s_mem_interval', Math.round((mem.consolidateMinIntervalMs ?? 1800000) / 60000), 'number', 'min="1"')),
        check('s_mem_usechat', mem.useChatModel !== false, '使用聊天模型整理'),
        F('整理供应商', input('s_mem_provider', mem.provider || '')),
        F('整理模型', input('s_mem_model', mem.model || ''))
      ].join('');

      const personaBody = [
        check('s_persona_unified', data.personaUnified !== false, '全局统一人设'),
        F('机器人名称', input('s_botname', per.botName)),
        F('自称', input('s_selfnick', per.selfNickname)),
        F('参与度（0–4）', input('s_part', per.participation ?? 3, 'number', 'min="0" max="4"')),
        F('角色卡 roleText', area('s_roletext', per.roleText, 6)),
        F('自定义规则 customRules', area('s_customrules', per.customRules, 3)),
        F('系统提示词覆盖 systemPromptOverride', area('s_sysprompt', per.systemPromptOverride, 3), '留空使用默认')
      ].join('');

      const whitelistBody = [
        F('群白名单（每行一个群号）', area('s_groups', (allow.groups || []).join('\n'), 4)),
        F('私聊白名单（每行一个 QQ）', area('s_private', (allow.private || []).join('\n'), 4)),
        check('s_allow_empty', data.allowAllWhenEmpty !== false, '白名单为空时允许全部')
      ].join('');

      const chatBody = [
        F('唤醒延迟 wakeDelayMs', input('s_wake', data.wakeDelayMs ?? 2000, 'number', 'min="0"')),
        F('冷静窗口 drainDelayMs', input('s_drain', data.drainDelayMs ?? 1200, 'number', 'min="0"')),
        F('最大并发 maxConcurrentRuns', input('s_conc', data.maxConcurrentRuns ?? 2, 'number', 'min="1" max="8"')),
        F('失败重试次数', input('s_retry', data.sessionRetryAttempts ?? 1, 'number', 'min="0" max="5"')),
        F('发送最小间隔（毫秒）', input('s_mingap', send.minGapMs ?? 800, 'number', 'min="0"')),
        F('发送最大间隔（毫秒）', input('s_maxgap', send.maxGapMs ?? 2200, 'number', 'min="0"')),
        F('每分钟上限', input('s_permin', send.maxPerMinute ?? 12, 'number', 'min="1"')),
        F('每小时上限', input('s_perhour', send.maxPerHour ?? 120, 'number', 'min="1"')),
        check('s_mute_enabled', mute.enabled !== false, '启用静默命令'),
        F('静默命令', input('s_mute_cmd', mute.command || '/退出')),
        F('静默时长（分钟）', input('s_mute_min', mute.durationMin ?? 30, 'number', 'min="1"')),
        check('s_pro_enabled', Boolean(pro.enabled), '启用主动发言'),
        F('主动发言概率（0–1）', input('s_pro_p', pro.probability ?? 0.05, 'number', 'step="0.01" min="0" max="1"')),
        F('检查最短间隔（分钟）', input('s_pro_min', Math.round((pro.checkIntervalMinMs ?? 600000) / 60000), 'number', 'min="1"')),
        F('检查最长间隔（分钟）', input('s_pro_max', Math.round((pro.checkIntervalMaxMs ?? 1800000) / 60000), 'number', 'min="1"'))
      ].join('');

      const onebotBody = [
        F('OneBot WebSocket', input('s_ws', ob.wsUrl || '')),
        F('OneBot HTTP', input('s_http', ob.httpUrl || '')),
        F('WS Token', input('s_token', '', 'password', `placeholder="${secretHint(ob.accessToken)}"`)),
        F('HTTP Token', input('s_httptoken', '', 'password', `placeholder="${secretHint(ob.httpAccessToken)}"`)),
        F('SnowLuma 目录（Linux 不适用）', input('s_obdir', ob.dir || '', 'text', 'disabled'))
      ].join('');

      const uiBody = [
        F('主题', select('s_theme', [['dark', '深色'], ['light', '浅色']], ui.theme || 'dark')),
        check('s_showvision', Boolean(ui.showVision), '显示视觉扫描结果'),
        F('刷新间隔（毫秒）', input('s_refresh', ui.refreshMs ?? 10000, 'number', 'min="2000"'))
      ].join('');

      const desktopBody = [
        check('s_autostart', Boolean(server.autoStart), '开机自启（Linux 映射为 systemd enabled）'),
        check('s_closetray', Boolean(server.closeToTray), '关闭到托盘（Windows 专属，Linux 无托盘）'),
        '<p class="hint">Linux 下自启由 systemd 管理：<code>systemctl enable qq-agent</code>；NapCat 由 Docker restart 策略管理。</p>'
      ].join('');

      const toolsBody = [
        check('s_tools_enabled', tools.enabled !== false, '启用模型工具'),
        check('s_cat_msg', cats.messaging !== false, '消息类'),
        check('s_cat_sticker', cats.sticker !== false, '表情类'),
        check('s_cat_query', cats.query !== false, '查询类'),
        check('s_cat_memory', cats.memory !== false, '记忆类'),
        check('s_cat_web', cats.web !== false, '联网类'),
        check('s_cat_knowledge', cats.knowledge !== false, '知识库'),
        check('s_cat_media', cats.media !== false, '媒体类'),
        check('s_cat_system', cats.system !== false, '系统类'),
        '<p class="hint">单项工具覆盖在经典控制台的「工具与技能」中设置。</p>'
      ].join('');

      const dataBody = `<div class="field"><label>数据目录</label><div class="mod-desc">${esc(data.dataDir || '（后端未返回）')}</div></div>
        <p class="hint">数据管理（打开目录/重置）在 Linux 下通过 SSH 操作；重置数据入口保留在经典控制台，避免误删。</p>`;
      const updateBody = `<div class="field"><label>当前版本</label><div class="mod-desc">${esc(ver?.version || '-')}</div></div>
        <button class="btn ghost" id="s_check_update" type="button">检查更新</button><div id="s_update_hint" class="hint"></div>`;

      $('#settings-root').innerHTML = [
        card('model', '模型 API', '供应商、模型、密钥、视觉模型与备选模型。', modelBody),
        card('cost', '成本核算', '本地单价用于估算；与官方价格表二选一。', costBody),
        card('search', '搜索服务', '联网搜索与各供应商密钥。', searchBody),
        card('memory', '记忆整理', '自动整理策略与整理模型。', memoryBody),
        card('persona', '人设', '名称、自称、角色卡与提示词覆盖。', personaBody),
        card('whitelist', '聊天白名单', '群号/QQ 每行一个；空名单策略。', whitelistBody),
        card('chat', '聊天设置', '节奏、并发、发送限流、静默与主动发言。', chatBody),
        card('onebot', 'OneBot / NapCat', 'QQ 接入地址与令牌。', onebotBody),
        card('ui', '界面', '主题、视觉结果、刷新间隔。', uiBody),
        card('desktop', '桌面端', 'Windows 专属项在 Linux 下的映射。', desktopBody),
        card('tools', '工具与技能', '工具总开关与分类。', toolsBody, { extra: '<a class="btn ghost" href="#" data-goto="modules">能力页</a>' }),
        card('data', '数据管理', '数据目录与重置说明。', dataBody, { save: false, extra: '<a class="btn ghost" href="/" target="_blank" rel="noopener">经典控制台</a>' }),
        card('update', '版本更新', '当前版本与检查更新。', updateBody, { save: false })
      ].join('');

      $('#settings-root').onclick = onClick;
      const cu = $('#s_check_update');
      if (cu) cu.addEventListener('click', async () => {
        const hint = $('#s_update_hint'); hint.textContent = '检查中…';
        try {
          const r = await api('/api/update-check');
          hint.textContent = r.updateAvailable ? `发现新版本：${r.latest || ''}` : '已是最新版本';
        } catch (e) { hint.textContent = `检查失败：${e.message}`; }
      });
    }).catch((e) => {
      $('#settings-root').innerHTML = `<div class="empty">设置加载失败：${esc(e.message)}</div>`;
    });
  }

  function status(id, text, ok = true) {
    const el = document.querySelector(`[data-status="${id}"]`);
    if (el) { el.textContent = text; el.style.color = ok ? 'var(--ok)' : 'var(--danger)'; }
  }

  function patchFor(id) {
    const v = (x) => document.getElementById(x)?.value ?? '';
    const c = (x) => Boolean(document.getElementById(x)?.checked);
    if (id === 'model') {
      const p = { api: {
        provider: v('s_provider'), model: v('s_model').trim(), baseUrl: v('s_baseurl').trim(),
        visionModel: v('s_vision').trim(), fallbackModels: splitList(v('s_fallback')),
        temperature: num(v('s_temp'), 0.7), maxRounds: num(v('s_rounds'), 8), timeoutMs: num(v('s_timeout'), 60000)
      } };
      const key = v('s_apikey').trim();
      if (key) p.api.apiKey = key;
      return p;
    }
    if (id === 'cost') return { api: {
      priceInputPerM: num(v('s_price_in'), 0), priceOutputPerM: num(v('s_price_out'), 0),
      priceCachedPerM: num(v('s_price_cached'), 0), useOfficialPrice: c('s_use_official')
    } };
    if (id === 'search') {
      const p = { webSearch: {
        enabled: c('s_search_enabled'), provider: v('s_search_provider'),
        searchUrl: v('s_search_url').trim(), maxResults: num(v('s_search_max'), 10)
      } };
      const map = [['s_ds_key', 'deepseek'], ['s_zp_key', 'zhipu'], ['s_bocha_key', 'bocha'], ['s_baidu_key', 'baidu'], ['s_metaso_key', 'metaso']];
      for (const [field, key] of map) { const val = v(field).trim(); if (val) p.webSearch[key] = { apiKey: val }; }
      const dsModel = v('s_ds_model').trim();
      if (dsModel) p.webSearch.deepseek = { ...(p.webSearch.deepseek || {}), model: dsModel };
      return p;
    }
    if (id === 'memory') return { memory: {
      consolidateEnabled: c('s_mem_consolidate'),
      consolidateMinIntervalMs: num(v('s_mem_interval'), 30) * 60000,
      useChatModel: c('s_mem_usechat'), provider: v('s_mem_provider').trim(), model: v('s_mem_model').trim()
    } };
    if (id === 'persona') return {
      personaUnified: c('s_persona_unified'),
      persona: { botName: v('s_botname').trim(), selfNickname: v('s_selfnick').trim(),
        participation: String(num(v('s_part'), 3)), roleText: v('s_roletext'),
        customRules: v('s_customrules'), systemPromptOverride: v('s_sysprompt') }
    };
    if (id === 'whitelist') return {
      allow: { groups: splitList(v('s_groups')), private: splitList(v('s_private')) },
      allowAllWhenEmpty: c('s_allow_empty')
    };
    if (id === 'chat') return {
      wakeDelayMs: num(v('s_wake'), 2000), drainDelayMs: num(v('s_drain'), 1200),
      maxConcurrentRuns: num(v('s_conc'), 2), sessionRetryAttempts: num(v('s_retry'), 1),
      send: { minGapMs: num(v('s_mingap'), 800), maxGapMs: num(v('s_maxgap'), 2200), maxPerMinute: num(v('s_permin'), 12), maxPerHour: num(v('s_perhour'), 120) },
      commandMute: { enabled: c('s_mute_enabled'), command: v('s_mute_cmd').trim(), durationMin: num(v('s_mute_min'), 30) },
      proactive: { enabled: c('s_pro_enabled'), probability: num(v('s_pro_p'), 0.05),
        checkIntervalMinMs: num(v('s_pro_min'), 10) * 60000, checkIntervalMaxMs: num(v('s_pro_max'), 30) * 60000 }
    };
    if (id === 'onebot') {
      const p = { snowluma: { wsUrl: v('s_ws').trim(), httpUrl: v('s_http').trim() } };
      const t = v('s_token').trim(); if (t) p.snowluma.accessToken = t;
      const ht = v('s_httptoken').trim(); if (ht) p.snowluma.httpAccessToken = ht;
      return p;
    }
    if (id === 'ui') return { ui: { theme: v('s_theme'), showVision: c('s_showvision'), refreshMs: num(v('s_refresh'), 10000) } };
    if (id === 'desktop') return { server: { autoStart: c('s_autostart'), closeToTray: c('s_closetray') } };
    if (id === 'tools') return { tools: {
      enabled: c('s_tools_enabled'),
      categories: { messaging: c('s_cat_msg'), sticker: c('s_cat_sticker'), query: c('s_cat_query'), memory: c('s_cat_memory'),
        web: c('s_cat_web'), knowledge: c('s_cat_knowledge'), media: c('s_cat_media'), system: c('s_cat_system') }
    } };
    return null;
  }

  async function save(id) {
    const patch = patchFor(id);
    if (!patch) return;
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify(patch) });
      status(id, '已保存', true); toast('设置已保存');
    } catch (e) { status(id, '保存失败', false); toast(`保存失败：${e.message}`, 'err'); }
  }

  function onClick(e) {
    const btn = e.target.closest('[data-save]');
    if (btn) { save(btn.dataset.save); return; }
    const goto = e.target.closest('[data-goto]');
    if (goto) { e.preventDefault(); document.querySelector(`.nav-item[data-page="${goto.dataset.goto}"]`)?.click(); }
  }

  window.TS_SETTINGS = { render };
})();
