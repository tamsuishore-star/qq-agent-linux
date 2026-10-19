// 设置页（V1.1.0）：按旧版设置内容重组为分组卡片。
// 只编辑安全的非敏感字段；密钥字段留空表示不修改。
(() => {
  'use strict';

  const { api, toast, esc } = window.TS;
  const $ = (s, r = document) => r.querySelector(s);

  const MASK = (v) => typeof v === 'string' && v.includes('******');
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  let cfg = null;

  function field(label, inner) {
    return `<div class="field"><label>${esc(label)}</label>${inner}</div>`;
  }

  function card(id, title, desc, body, actions = '', editable = true) {
    return `<section class="setting-card" data-card="${id}">
      <h3>${esc(title)}</h3>
      <div class="desc">${esc(desc)}</div>
      ${body}
      <div class="setting-actions">
        ${editable ? `<button class="btn primary" data-save="${id}" type="button">保存</button>` : ''}
        ${actions}
        <span class="status" data-status="${id}"></span>
      </div>
    </section>`;
  }

  function render() {
    api('/api/config').then((data) => {
      cfg = data;
      const apiCfg = data.api || {};
      const ws = data.webSearch || {};
      const persona = data.persona || {};
      const allow = data.allow || {};
      const mute = data.commandMute || {};
      const onebot = data.snowluma || {};

      const modelBody = [
        field('Base URL', `<input id="set-baseurl" value="${esc(apiCfg.baseUrl || '')}" placeholder="https://api.deepseek.com" />`),
        field('模型', `<input id="set-model" value="${esc(apiCfg.model || '')}" placeholder="deepseek-chat" />`),
        field('API Key（留空表示不修改）', `<input id="set-apikey" type="password" placeholder="${MASK(apiCfg.apiKey) || apiCfg.apiKey ? '已配置，输入新值可替换' : 'sk-...'}" autocomplete="off" />`)
      ].join('');

      const searchBody = [
        field('搜索服务', `<select id="set-search-enabled">
          <option value="1" ${ws.enabled ? 'selected' : ''}>启用</option>
          <option value="0" ${ws.enabled ? '' : 'selected'}>关闭</option></select>`),
        field('搜索地址', `<input id="set-search-url" value="${esc(ws.searchUrl || '')}" placeholder="https://cn.bing.com/search" />`)
      ].join('');

      const memoryBody = field('长期记忆', `<select id="set-memory">
        <option value="1" ${data.memory?.enabled !== false ? 'selected' : ''}>启用</option>
        <option value="0" ${data.memory?.enabled === false ? 'selected' : ''}>关闭</option></select>`);

      const personaBody = [
        field('机器人名称', `<input id="set-botname" value="${esc(persona.botName || '')}" />`),
        field('自称', `<input id="set-selfnick" value="${esc(persona.selfNickname || '')}" />`),
        field('参与度（0–4）', `<input id="set-part" type="number" min="0" max="4" value="${num(persona.participation, 3)}" />`),
        field('角色卡（roleText）', `<textarea id="set-roletext" rows="6">${esc(persona.roleText || '')}</textarea>`)
      ].join('');

      const allowGroups = Array.isArray(allow.groups) ? allow.groups : [];
      const allowPrivate = Array.isArray(allow.private) ? allow.private : [];
      const whitelistBody = `
        <div class="field"><label>群白名单（${allowGroups.length} 个）</label>
          <div class="mod-desc">${esc(allowGroups.join('、') || '未配置（启用全部）')}</div></div>
        <div class="field"><label>私聊白名单（${allowPrivate.length} 个）</label>
          <div class="mod-desc">${esc(allowPrivate.join('、') || '未配置（启用全部）')}</div></div>
        <p class="hint">白名单涉及数组替换，编辑仍在经典控制台完成，避免误覆盖。</p>`;

      const chatBody = [
        field('聚批延迟 wakeDelayMs', `<input id="set-wake" type="number" min="0" max="10000" value="${num(data.wakeDelayMs, 2000)}" />`),
        field('冷静窗口 drainDelayMs', `<input id="set-drain" type="number" min="0" max="10000" value="${num(data.drainDelayMs, 1200)}" />`),
        field('最大并发 maxConcurrentRuns', `<input id="set-conc" type="number" min="1" max="8" value="${num(data.maxConcurrentRuns, 2)}" />`),
        field('静默命令 /退出（分钟）', `<input id="set-mute" type="number" min="1" max="1440" value="${num(mute.durationMin, 30)}" />`)
      ].join('');

      const onebotBody = [
        field('OneBot WebSocket', `<input id="set-ws" value="${esc(onebot.wsUrl || '')}" placeholder="ws://127.0.0.1:3001" />`),
        field('OneBot HTTP', `<input id="set-http" value="${esc(onebot.httpUrl || '')}" placeholder="http://127.0.0.1:3000" />`),
        field('访问令牌（留空表示不修改）', `<input id="set-token" type="password" placeholder="${MASK(onebot.accessToken) ? '已配置，输入新值可替换' : '与 NapCat 的 Token 一致'}" autocomplete="off" />`),
        `<p class="hint">Linux 下 autoLaunch 固定为 false；QQ 由 NapCat 容器管理。</p>`
      ].join('');

      const modules = window.TS.state.modules || [];
      const toolsBody = `<div class="field"><label>当前模块</label>
        <div class="mod-desc">共 ${modules.length} 个，启用 ${modules.filter((s) => s.enabled).length} 个</div></div>
        <p class="hint">启用、禁用与卸载请在「能力」页操作。</p>`;

      const desktopBody = `<p class="hint">SnowLuma / 便携 QQ 桌面端仅适用于 Windows 版，本机为 Linux + NapCat，不提供此入口。相关后端代码保留给未来 Windows 版本。</p>`;

      const classicBody = `<p class="hint">旧版控制台仍完整可用，包含模型提供商、搜索服务、白名单、人设广场、工具与技能等全部设置。</p>
        <p><a class="btn ghost" href="/" target="_blank" rel="noopener">打开经典控制台</a></p>`;

      $('#settings-root').innerHTML = [
        card('model', '模型 API', 'AI 接口地址、模型与密钥。密钥留空表示不修改。', modelBody),
        card('search', '搜索服务', '联网搜索开关与搜索地址。', searchBody),
        card('memory', '记忆', '长期记忆总开关；详细记忆管理在「记忆」页（经典控制台）。', memoryBody),
        card('persona', '人设', '机器人名称、自称、参与度与角色卡。', personaBody),
        card('whitelist', '聊天白名单', '允许机器人工作的群与私聊。', whitelistBody, '<a class="btn ghost" href="/" target="_blank" rel="noopener">经典控制台编辑</a>', false),
        card('chat', '聊天设置', '聚批延迟、冷静窗口、并发与静默命令时长。', chatBody),
        card('onebot', 'OneBot / NapCat', 'QQ 接入地址与访问令牌。', onebotBody),
        card('tools', '工具与技能', '技能、插件与工具的启停和卸载。', toolsBody, '<a class="btn ghost" href="#" data-goto="modules">前往能力页</a>', false),
        card('desktop', '桌面端', 'Windows 专用能力说明。', desktopBody, '', false),
        card('classic', '经典控制台', '尚未迁移的设置入口。', classicBody, '', false)
      ].join('');

      $('#settings-root').onclick = onClick;
    }).catch((e) => {
      $('#settings-root').innerHTML = `<div class="empty">设置加载失败：${esc(e.message)}</div>`;
    });
  }

  function status(id, text, ok = true) {
    const el = document.querySelector(`[data-status="${id}"]`);
    if (el) { el.textContent = text; el.style.color = ok ? 'var(--ok)' : 'var(--danger)'; }
  }

  async function save(id) {
    let patch = null;
    if (id === 'model') {
      patch = { api: { baseUrl: $('#set-baseurl').value.trim(), model: $('#set-model').value.trim() } };
      const key = $('#set-apikey').value.trim();
      if (key) patch.api.apiKey = key;
    } else if (id === 'search') {
      patch = { webSearch: { enabled: $('#set-search-enabled').value === '1', searchUrl: $('#set-search-url').value.trim() } };
    } else if (id === 'memory') {
      patch = { memory: { enabled: $('#set-memory').value === '1' } };
    } else if (id === 'persona') {
      patch = { persona: {
        botName: $('#set-botname').value.trim(),
        selfNickname: $('#set-selfnick').value.trim(),
        participation: num($('#set-part').value, 3),
        roleText: $('#set-roletext').value
      } };
    } else if (id === 'chat') {
      patch = {
        wakeDelayMs: num($('#set-wake').value, 2000),
        drainDelayMs: num($('#set-drain').value, 1200),
        maxConcurrentRuns: num($('#set-conc').value, 2),
        commandMute: { durationMin: num($('#set-mute').value, 30) }
      };
    } else if (id === 'onebot') {
      patch = { snowluma: {
        wsUrl: $('#set-ws').value.trim(),
        httpUrl: $('#set-http').value.trim(),
        autoLaunch: false
      } };
      const token = $('#set-token').value.trim();
      if (token) { patch.snowluma.accessToken = token; patch.snowluma.httpAccessToken = token; }
    }
    if (!patch) return;
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify(patch) });
      status(id, '已保存', true);
      toast('设置已保存');
    } catch (e) {
      status(id, '保存失败', false);
      toast(`保存失败：${e.message}`, 'err');
    }
  }

  function onClick(e) {
    const saveBtn = e.target.closest('[data-save]');
    if (saveBtn) { save(saveBtn.dataset.save); return; }
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      e.preventDefault();
      document.querySelector(`.nav-item[data-page="${goto.dataset.goto}"]`)?.click();
    }
  }

  window.TS_SETTINGS = { render };
})();
