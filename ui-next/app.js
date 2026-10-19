// TamsuiShore QQ Agent · 新版工作台 v1.1.0
// 纯原生 JS；所有数据来自真实接口。
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { page: 'overview', kind: 'all', q: '', status: 'all', modules: [], builtin: new Set(), installed: {}, logs: [], logLevel: 'all', logQ: '', paused: false, overview: null, status: null };

  async function api(path, options = {}) {
    const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.code = data.code; err.status = res.status;
      throw err;
    }
    return data;
  }

  const fmtBytes = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '-';
    const u = ['B', 'KB', 'MB', 'GB']; let v = n, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  };
  const fmtNum = (n) => Number.isFinite(n) ? n.toLocaleString('zh-CN') : '-';
  const fmtDuration = (sec) => {
    if (!Number.isFinite(sec)) return '-';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d} 天 ${h} 小时`;
    if (h) return `${h} 小时 ${m} 分`;
    return `${m} 分钟`;
  };
  const fmtTime = (v) => {
    if (v == null || v === '') return '-';
    if (typeof v === 'number') {
      const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : v;
      return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleTimeString('zh-CN', { hour12: false });
  };

  // 主题
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    try { localStorage.setItem('ts-theme', t); } catch { /* ignore */ }
  }
  function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('ts-theme') || 'dark'; } catch { /* ignore */ }
    applyTheme(saved);
    $('#theme-btn')?.addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    });
  }

  // Toast / 确认框
  let toastTimer = null;
  function toast(msg, type = 'ok') {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }
  function confirmAction({ title, text, detail = '' }) {
    return new Promise((resolve) => {
      const dlg = $('#confirm-dialog');
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      const det = $('#confirm-detail');
      det.textContent = detail; det.classList.toggle('hidden', !detail);
      const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
      dlg.addEventListener('close', onClose);
      dlg.returnValue = '';
      dlg.showModal();
    });
  }

  // 导航
  const TITLES = { overview: '总览', modules: '能力', logs: '日志', settings: '设置', about: '关于' };
  const SUBS = { overview: '运行状态与健康检查', modules: '技能与插件管理', logs: '运行日志与诊断', settings: '模型、人设与服务配置', about: '版本、环境与来源' };
  function setPage(page) {
    state.page = page;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `page-${page}`));
    $('#page-title').textContent = TITLES[page] || page;
    $('#page-sub').textContent = SUBS[page] || '';
    if (page === 'overview') loadOverview();
    if (page === 'modules') loadModules();
    if (page === 'logs') loadLogs();
    if (page === 'settings') window.TS_SETTINGS?.render();
    if (page === 'about') loadAbout();
  }

  // 总览
  const prettyWhy = (s) => s.loadError || s.reason || (s.missingRequires || []).map((r) => `缺少能力：${r}`).join('、') || '依赖未就绪';
  function renderOverview() {
    const { status, overview, modules, logs } = state;
    const ob = status?.onebot || {};
    const ok = ob.connected === true;
    $('#sb-dot').className = `dot big ${ok ? 'on' : 'err'}`;
    $('#sb-title').textContent = ok ? '机器人运行中' : 'QQ 未连接';
    $('#sb-sub').textContent = ok
      ? [ob.self?.nickname, ob.self?.userId].filter(Boolean).join(' · ') || '账号在线'
      : (ob.diagnosis || ob.error || '等待 OneBot 连接');
    $('#run-account').textContent = ob.self?.userId || '-';
    $('#run-pid').textContent = overview?.pid ?? '-';
    $('#run-node').textContent = overview?.node || '-';
    $('#run-model').textContent = overview?.model || '-';
    $('#conn-dot').className = `dot ${ok ? 'on' : 'err'}`;
    $('#conn-text').textContent = ok ? 'OneBot 已连接' : 'OneBot 未连接';
    $('#model-chip').textContent = `模型 ${overview?.model || '-'}`;
    $('#uptime-chip').textContent = `已运行 ${fmtDuration(overview?.uptimeSec)}`;

    const enabled = modules.filter((s) => s.enabled).length;
    const broken = modules.filter((s) => !s.loaded).length;
    const usage = status?.usage || {};
    const cards = [
      { label: '模块', value: `${enabled}`, unit: `/ ${modules.length}`, sub: broken ? `${broken} 个异常` : '全部加载正常' },
      { label: '今日 Token', value: fmtNum(usage.totalTokens || 0), unit: '', sub: `输入 ${fmtNum(usage.promptTokens || 0)} · 输出 ${fmtNum(usage.completionTokens || 0)}` },
      { label: '进程内存', value: overview ? fmtBytes(overview.memory.rss) : '-', unit: '', sub: overview ? `堆 ${fmtBytes(overview.memory.heapUsed)}` : '' },
      { label: '系统可用', value: overview ? fmtBytes(overview.system.freemem) : '-', unit: '', sub: overview ? `共 ${fmtBytes(overview.system.totalmem)} · ${overview.system.cpus} 核` : '' }
    ];
    $('#metric-strip').innerHTML = cards.map((c) => `
      <div class="metric"><div class="label">${esc(c.label)}</div>
        <div class="value">${esc(c.value)}<span class="unit">${esc(c.unit)}</span></div>
        <div class="sub" title="${esc(c.sub)}">${esc(c.sub)}</div></div>`).join('');

    const issues = modules.filter((s) => !s.loaded || (s.enabled && !s.active));
    $('#health-count').textContent = issues.length ? `${issues.length} 项需关注` : `${modules.length} 项全部正常`;
    $('#health-list').innerHTML = issues.length
      ? issues.map((s) => `<div class="list-row">
          <span class="dot ${s.loaded ? 'warn' : 'err'}"></span>
          <div class="grow"><div class="name">${esc(s.name || s.id)}</div><div class="why" title="${esc(prettyWhy(s))}">${esc(prettyWhy(s))}</div></div>
          <span class="pill ${s.loaded ? 'warn' : 'err'}">${s.loaded ? '依赖' : '失败'}</span>
        </div>`).join('')
      : '<div class="list-row"><span class="dot on"></span><div class="grow"><div class="name">所有模块加载正常</div><div class="why">没有需要处理的问题</div></div></div>';

    const errs = logs.filter((l) => ['error', 'warn'].includes(String(l.level || '').toLowerCase())).slice(-5).reverse();
    $('#err-count').textContent = errs.length ? `${errs.length} 条` : '无';
    $('#err-list').innerHTML = errs.length
      ? errs.map((l) => `<div class="list-row"><span class="dot ${String(l.level).toLowerCase() === 'error' ? 'err' : 'warn'}"></span>
          <div class="grow"><div class="name">${esc(String(l.text ?? l.msg ?? l.message ?? '').slice(0, 80) || '(无消息)')}</div>
          <div class="why">${esc(fmtTime(l.time ?? l.ts ?? l.timestamp))} · ${esc(l.module || l.skill || '')}</div></div></div>`).join('')
      : '<div class="list-row"><span class="dot on"></span><div class="grow"><div class="name">最近没有错误</div></div></div>';

    state.paused = Boolean(status?.paused);
    $('#pause-btn').textContent = state.paused ? '恢复' : '暂停';
  }

  async function loadOverview() {
    try {
      const [status, overview, mods, logs] = await Promise.all([
        api('/api/status').catch(() => null),
        api('/api/overview').catch(() => null),
        api('/api/modules').catch(() => null),
        api('/api/logs?limit=120').catch(() => null)
      ]);
      state.status = status; state.overview = overview;
      if (mods) { state.modules = mods.modules || []; state.builtin = new Set(mods.builtin || []); state.installed = mods.installed || {}; }
      state.logs = logs?.logs || [];
      renderOverview();
    } catch (e) { toast(`总览加载失败：${e.message}`, 'err'); }
  }

  // 能力
  const KIND = { skill: '技能', plugin: '插件' };
  function statusOf(s) {
    if (!s.loaded) return { cls: 'err', text: '失败' };
    if (!s.enabled) return { cls: 'off', text: '已禁用' };
    if (s.active) return { cls: 'ok', text: '生效' };
    return { cls: 'warn', text: '依赖' };
  }
  function sourceOf(s) {
    if (state.installed[s.id]) return '用户';
    if (state.builtin.has(s.id)) return '内置';
    return '未知';
  }
  function renderModules() {
    const q = state.q.trim().toLowerCase();
    const list = state.modules.filter((s) => {
      if (state.kind !== 'all' && (s.kind || 'skill') !== state.kind) return false;
      if (state.status === 'on' && !s.enabled) return false;
      if (state.status === 'off' && s.enabled) return false;
      if (state.status === 'error' && s.loaded) return false;
      if (q && ![s.id, s.name, s.description, s.category].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    $('#module-count').textContent = `${list.length} / ${state.modules.length}`;
    $('#module-empty').classList.toggle('hidden', list.length > 0);
    $('#module-rows').innerHTML = list.map((s) => {
      const st = statusOf(s);
      const removable = Boolean(state.installed[s.id]) && !state.builtin.has(s.id);
      return `<tr data-id="${esc(s.id)}" data-kind="${esc(s.kind || 'skill')}">
        <td class="name-cell"><div class="mod-title">${esc(s.name || s.id)}</div>
          <div class="mod-desc" title="${esc(s.description || '')}">${esc(s.description || '（没有简介）')}</div></td>
        <td>${esc(KIND[s.kind] || s.kind || '技能')}</td>
        <td>v${esc(s.version || '-')}</td>
        <td>${esc(sourceOf(s))}</td>
        <td><span class="pill ${st.cls}">${esc(st.text)}</span></td>
        <td><div class="cell-actions">
          <button class="btn sm ghost" data-act="toggle" ${s.loaded ? '' : 'disabled'}>${s.enabled ? '禁用' : '启用'}</button>
          ${removable ? '<button class="btn sm danger" data-act="uninstall">卸载</button>' : '<span class="pill off" title="内置模块仅可禁用">内置</span>'}
        </div></td></tr>`;
    }).join('');
  }
  async function loadModules() {
    try {
      const d = await api('/api/modules');
      state.modules = d.modules || []; state.builtin = new Set(d.builtin || []); state.installed = d.installed || {};
      renderModules();
    } catch (e) { toast(`模块加载失败：${e.message}`, 'err'); }
  }
  async function toggleModule(id, next) {
    try {
      await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ enabled: next }) });
      toast(`${next ? '已启用' : '已禁用'}：${id}`);
      await loadModules();
    } catch (e) { toast(`切换失败：${e.message}`, 'err'); }
  }
  async function uninstall(id, kind) {
    const t = state.modules.find((s) => s.id === id);
    const ok = await confirmAction({
      title: '卸载模块', text: `确认卸载「${t?.name || id}」？`,
      detail: `类型：${KIND[kind] || kind}\n步骤：停用 → 目录移入 data/.trash/ → 清理配置\n可恢复：是（回收站保留原目录）`
    });
    if (!ok) return;
    try {
      await api(`/api/modules/${kind}/${encodeURIComponent(id)}?mode=uninstall`, { method: 'DELETE' });
      toast(`已卸载：${id}`); await loadModules();
    } catch (e) { toast(`卸载失败：${e.message}`, 'err'); }
  }

  // 日志
  function logFields(l) {
    const level = String(l.level || l.lvl || 'info').toLowerCase();
    const module = l.module || l.skill || l.scope || l.name || '';
    const message = l.text ?? l.msg ?? l.message ?? (typeof l === 'string' ? l : '');
    const time = l.time ?? l.ts ?? l.timestamp ?? l.date ?? '';
    return { level, module, message: String(message || ''), time };
  }
  function renderLogs() {
    const rows = state.logs.filter((l) => {
      const f = logFields(l);
      if (state.logLevel !== 'all' && f.level !== state.logLevel) return false;
      if (state.logQ && !`${f.message} ${f.module}`.toLowerCase().includes(state.logQ.toLowerCase())) return false;
      return true;
    });
    $('#log-count').textContent = `${rows.length} 条`;
    if (!rows.length) { $('#log-list').innerHTML = '<div class="empty">没有匹配的日志</div>'; return; }
    $('#log-list').innerHTML = rows.map((l, i) => {
      const f = logFields(l);
      const raw = JSON.stringify(l, null, 2);
      const fallback = f.message || '(结构化日志，点击展开)';
      return `<div class="log-line" data-i="${i}">
        <span class="log-time">${esc(fmtTime(f.time))}</span>
        <span class="log-level ${esc(f.level)}">${esc(f.level)}</span>
        <span class="log-module" title="${esc(f.module)}">${esc(f.module || '-')}</span>
        <span class="log-msg" title="${esc(f.message)}">${esc(fallback)}</span>
        <button class="log-more" type="button" title="展开原始日志">⋯</button>
        <pre class="log-raw hidden">${esc(raw)}</pre>
      </div>`;
    }).join('');
  }
  async function loadLogs() {
    try {
      const d = await api('/api/logs?limit=200');
      state.logs = Array.isArray(d.logs) ? d.logs : [];
      renderLogs();
    } catch (e) { toast(`日志加载失败：${e.message}`, 'err'); }
  }

  // 关于
  async function loadAbout() {
    const ov = state.overview || (await api('/api/overview').catch(() => null));
    const ver = await api('/api/version').catch(() => null);
    const mods = await api('/api/modules').catch(() => null);
    if (mods) { state.modules = mods.modules || []; state.builtin = new Set(mods.builtin || []); state.installed = mods.installed || {}; }
    $('#about-version').textContent = ver?.version || '-';
    $('#about-node').textContent = ov?.node || '-';
    $('#about-pid').textContent = ov?.pid ?? '-';
    $('#about-uptime').textContent = fmtDuration(ov?.uptimeSec);
    $('#about-mem').textContent = ov ? fmtBytes(ov.memory.rss) : '-';
    $('#about-total').textContent = `${state.modules.length} 个`;
    $('#about-builtin').textContent = `${state.builtin.size} 个`;
    $('#about-installed').textContent = `${Object.keys(state.installed).length} 个`;
    $('#about-broken').textContent = `${state.modules.filter((s) => !s.loaded).length} 个`;
  }

  async function togglePause() {
    try {
      if (state.paused) await api('/api/pause', { method: 'DELETE' });
      else await api('/api/pause', { method: 'POST', body: JSON.stringify({ paused: true }) });
      toast(state.paused ? '已恢复' : '已暂停');
      await loadOverview();
    } catch (e) { toast(`操作失败：${e.message}`, 'err'); }
  }

  function init() {
    initTheme();
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));
    $('#refresh-btn').addEventListener('click', () => {
      if (state.page === 'settings') window.TS_SETTINGS?.render();
      else setPage(state.page);
    });
    $('#pause-btn').addEventListener('click', togglePause);
    $$('.quick [data-quick]').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.quick)));

    $('#kind-seg').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      state.kind = b.dataset.kind;
      $$('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      renderModules();
    });
    $('#module-search').addEventListener('input', (e) => { state.q = e.target.value; renderModules(); });
    $('#module-status').addEventListener('change', (e) => { state.status = e.target.value; renderModules(); });
    $('#reset-filter').addEventListener('click', () => {
      state.kind = 'all'; state.q = ''; state.status = 'all';
      $('#module-search').value = ''; $('#module-status').value = 'all';
      $$('.seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.kind === 'all'));
      renderModules();
    });
    $('#module-rows').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const tr = btn.closest('tr'); if (!tr) return;
      if (btn.dataset.act === 'toggle') {
        const mod = state.modules.find((s) => s.id === tr.dataset.id);
        toggleModule(tr.dataset.id, !mod?.enabled);
      } else if (btn.dataset.act === 'uninstall') {
        uninstall(tr.dataset.id, tr.dataset.kind);
      }
    });
    $('#log-level').addEventListener('change', (e) => { state.logLevel = e.target.value; renderLogs(); });
    $('#log-search').addEventListener('input', (e) => { state.logQ = e.target.value; renderLogs(); });
    $('#log-refresh').addEventListener('click', loadLogs);
    $('#log-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.log-more'); if (!btn) return;
      const line = btn.closest('.log-line');
      line.classList.toggle('open');
      line.querySelector('.log-raw').classList.toggle('hidden');
    });
    let auto = null;
    $('#log-auto').addEventListener('change', (e) => {
      clearInterval(auto); auto = null;
      if (e.target.checked) auto = setInterval(loadLogs, 5000);
    });

    setPage('overview');
    setInterval(() => { if (state.page === 'overview') loadOverview(); }, 15000);
  }

  window.TS = { api, toast, esc, fmtBytes, fmtDuration, fmtNum, state, loadModules };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

