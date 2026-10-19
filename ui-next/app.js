// TamsuiShore QQ Agent · iOS 海洋风工作台（V1.1.0）
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { page: 'overview', modules: [], builtin: new Set(), installed: {}, logs: [], paused: false, overview: null, status: null, usage: null, recentSessions: [], kind: 'all', q: '', filter: 'all', logLevel: 'all', logQ: '' };

  async function api(path, options = {}) {
    const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok || data.ok === false) { const e = new Error(data.error || `HTTP ${res.status}`); e.code = data.code; throw e; }
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
    const d = typeof v === 'number' ? new Date(v > 1e12 ? v : v > 1e9 ? v * 1000 : v) : new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    try { localStorage.setItem('ts-theme', t); } catch { /* ignore */ }
  }
  function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('ts-theme') || 'dark'; } catch { /* ignore */ }
    applyTheme(saved);
    $('#theme-btn').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
  }

  let toastTimer = null;
  function toast(msg, type = 'ok') {
    const el = $('#toast'); el.textContent = msg; el.className = `toast ${type}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function confirmAction({ title, text, detail = '' }) {
    return new Promise((resolve) => {
      const dlg = $('#confirm-dialog');
      $('#confirm-title').textContent = title; $('#confirm-text').textContent = text;
      const det = $('#confirm-detail'); det.textContent = detail; det.classList.toggle('hidden', !detail);
      const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
      dlg.addEventListener('close', onClose); dlg.returnValue = ''; dlg.showModal();
    });
  }

  function openSheet(title, html) {
    $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html;
    $('#sheet').classList.remove('hidden'); $('#sheet-mask').classList.remove('hidden');
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheet-mask').classList.add('hidden'); }

  function barChart(items, { unit = '' } = {}) {
    if (!items.length) return '<div class="empty">暂无数据</div>';
    const w = 620, h = 160, padL = 8, padR = 8, padB = 24, padT = 14;
    const max = Math.max(...items.map((i) => Number(i.value) || 0), 1);
    const innerW = w - padL - padR; const bw = innerW / items.length;
    const bars = items.map((it, i) => {
      const v = Number(it.value) || 0;
      const bh = Math.max(2, (v / max) * (h - padT - padB));
      const x = padL + i * bw + bw * 0.2; const y = h - padB - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="url(#waveGrad)" opacity="${v ? 0.9 : 0.25}"></rect>
        <text x="${(x + bw * 0.3).toFixed(1)}" y="${h - 8}" text-anchor="middle" fill="var(--tx-3)" font-size="10">${esc(it.label)}</text>
        <title>${esc(it.label)}：${fmtNum(v)}${esc(unit)}</title>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
  }

  function barRows(items, { unit = '' } = {}) {
    if (!items.length) return '<div class="empty">暂无数据</div>';
    const max = Math.max(...items.map((i) => Number(i.value) || 0), 1);
    return items.map((it) => {
      const v = Number(it.value) || 0;
      return `<div class="bar-row"><span class="name" title="${esc(it.label)}">${esc(it.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, (v / max) * 100).toFixed(1)}%"></span></span>
        <span class="num">${fmtNum(v)}${esc(unit)}</span></div>`;
    }).join('');
  }

  function ring(pct, label, sub) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0)); const c = 2 * Math.PI * 46; const dash = (p / 100) * c;
    return `<svg viewBox="0 0 110 110">
      <circle cx="55" cy="55" r="46" fill="none" stroke="var(--card-2)" stroke-width="9"></circle>
      <circle cx="55" cy="55" r="46" fill="none" stroke="url(#waveGrad)" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" transform="rotate(-90 55 55)"></circle>
      <text x="55" y="53" text-anchor="middle" fill="var(--tx)" font-size="19" font-weight="700">${Math.round(p)}%</text>
      <text x="55" y="70" text-anchor="middle" fill="var(--tx-3)" font-size="9">${esc(label)}</text>
    </svg><div class="ring-meta"><b>${esc(sub || '')}</b><span>${esc(label)}</span></div>`;
  }

  const TITLES = { overview: '总览', sessions: '会话', chats: '存档', memory: '记忆', usage: '用量', modules: '能力', logs: '日志', settings: '设置', about: '关于' };
  function setPage(page) {
    state.page = page;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `page-${page}`));
    document.title = `${TITLES[page] || page} · TamsuiShore QQ Agent`;
    if (page === 'overview') loadOverview();
    else if (page === 'usage') loadUsage();
    else if (page === 'modules') loadModules();
    else if (page === 'logs') loadLogs();
    else if (page === 'settings') window.TS_SETTINGS?.render();
    else if (page === 'about') loadAbout();
    else if (window.TS_PAGES?.[page]) window.TS_PAGES[page]();
  }

  function renderOverview() {
    const { status, overview, modules, logs, usage } = state;
    const ob = status?.onebot || {}; const ok = ob.connected === true;
    $('#sb-dot').className = `dot ${ok ? 'on' : 'err'}`;
    $('#sb-tag').textContent = ok ? '在线' : '离线';
    $('#sb-title').textContent = ok ? '机器人运行中' : 'QQ 未连接';
    $('#sb-sub').textContent = ok ? [ob.self?.nickname, ob.self?.userId].filter(Boolean).join(' · ') || '账号在线' : (ob.diagnosis || ob.error || '等待 OneBot 连接');
    $('#hero-account').textContent = `账号 ${ob.self?.userId || '-'}`;
    $('#hero-model').textContent = `模型 ${overview?.model || '-'}`;
    $('#conn-dot').className = `dot ${ok ? 'on' : 'err'}`;
    $('#conn-text').textContent = ok ? 'OneBot 已连接' : 'OneBot 未连接';
    $('#model-chip').textContent = `模型 ${overview?.model || '-'}`;
    $('#uptime-chip').textContent = `已运行 ${fmtDuration(overview?.uptimeSec)}`;

    const enabled = modules.filter((s) => s.enabled).length;
    const broken = modules.filter((s) => !s.loaded).length;
    const us = status?.usage || {};
    const metrics = [
      { label: '模块', value: `${enabled}`, small: `/ ${modules.length}`, sub: broken ? `${broken} 个异常` : '全部加载正常' },
      { label: '今日 Token', value: fmtNum(us.totalTokens || 0), small: '', sub: `输入 ${fmtNum(us.promptTokens || 0)} · 输出 ${fmtNum(us.completionTokens || 0)}` },
      { label: '进程内存', value: overview ? fmtBytes(overview.memory.rss) : '-', small: '', sub: overview ? `堆 ${fmtBytes(overview.memory.heapUsed)}` : '' },
      { label: '系统可用', value: overview ? fmtBytes(overview.system.freemem) : '-', small: '', sub: overview ? `共 ${fmtBytes(overview.system.totalmem)} · ${overview.system.cpus} 核` : '' }
    ];
    $('#metric-grid').innerHTML = metrics.map((m) => `<div class="card metric">
      <div class="label">${esc(m.label)}</div>
      <div class="value">${esc(m.value)}<small>${esc(m.small)}</small></div>
      <div class="sub" title="${esc(m.sub)}">${esc(m.sub)}</div></div>`).join('');

    const days = (usage?.days || []).slice(-7).map((d) => ({ label: String(d.day).slice(5), value: d.totalTokens || 0 }));
    $('#token-chart').innerHTML = barChart(days, { unit: ' tokens' });
    $('#chart-total').textContent = usage ? `合计 ${fmtNum(usage.totals?.totalTokens || 0)}` : '';

    const active = modules.filter((s) => s.active).length;
    $('#ring-wrap').innerHTML = ring(modules.length ? (active / modules.length) * 100 : 0, '模块生效率', `${active}/${modules.length}`);

    const issues = modules.filter((s) => !s.loaded || (s.enabled && !s.active));
    $('#health-list').innerHTML = issues.length
      ? issues.slice(0, 4).map((s) => `<div class="row"><span class="dot ${s.loaded ? 'warn' : 'err'}"></span>
        <div class="grow"><div class="title">${esc(s.name || s.id)}</div><div class="sub">${esc(s.loadError || s.reason || '依赖未就绪')}</div></div></div>`).join('')
      : '<div class="row"><span class="dot on"></span><div class="grow"><div class="title">全部模块正常</div><div class="sub">没有需要处理的问题</div></div></div>';

    $('#recent-sessions').innerHTML = (state.recentSessions || []).length
      ? state.recentSessions.slice(0, 5).map((s) => `<div class="row clickable" data-session="${esc(s.id)}">
        <span class="dot ${s.status === 'error' ? 'err' : s.status === 'running' ? 'warn' : 'on'}"></span>
        <div class="grow"><div class="title">${esc(s.chatKey || s.id)}</div><div class="sub">${esc(s.trigger?.text || s.outcome || '')}</div></div>
        <span class="side">${esc(fmtTime(s.startedAt))}</span></div>`).join('')
      : '<div class="empty">暂无会话</div>';

    const errs = logs.filter((l) => ['error', 'warn'].includes(String(l.level || '').toLowerCase())).slice(-5).reverse();
    $('#err-count').textContent = errs.length ? `${errs.length} 条` : '无';
    $('#err-list').innerHTML = errs.length
      ? errs.map((l) => `<div class="row"><span class="dot ${String(l.level).toLowerCase() === 'error' ? 'err' : 'warn'}"></span>
        <div class="grow"><div class="title">${esc(String(l.text ?? l.msg ?? l.message ?? '').slice(0, 80) || '(无消息)')}</div>
        <div class="sub">${esc(fmtTime(l.ts ?? l.time))} · ${esc(l.module || '')}</div></div></div>`).join('')
      : '<div class="empty">最近没有错误</div>';

    state.paused = Boolean(status?.paused);
    $('#pause-btn').textContent = state.paused ? '恢复' : '暂停';
  }

  async function loadOverview() {
    try {
      const [status, overview, mods, logs, usage, sessions] = await Promise.all([
        api('/api/status').catch(() => null), api('/api/overview').catch(() => null),
        api('/api/modules').catch(() => null), api('/api/logs?limit=120').catch(() => null),
        api('/api/usage/stats?range=7').catch(() => null), api('/api/sessions?limit=5').catch(() => null)
      ]);
      state.status = status; state.overview = overview; state.usage = usage;
      if (mods) { state.modules = mods.modules || []; state.builtin = new Set(mods.builtin || []); state.installed = mods.installed || {}; }
      state.logs = logs?.logs || [];
      state.recentSessions = sessions?.sessions || [];
      renderOverview();
    } catch (e) { toast(`总览加载失败：${e.message}`, 'err'); }
  }

  const KIND = { skill: '技能', plugin: '插件' };
  function moduleStatus(s) {
    if (!s.loaded) return { cls: 'err', text: '失败' };
    if (!s.enabled) return { cls: 'off', text: '已禁用' };
    if (s.active) return { cls: 'ok', text: '生效' };
    return { cls: 'warn', text: '依赖' };
  }
  const sourceOf = (s) => state.installed[s.id] ? '用户' : state.builtin.has(s.id) ? '内置' : '未知';
  function renderModules() {
    const q = state.q.trim().toLowerCase();
    const list = state.modules.filter((s) => {
      if (state.kind !== 'all' && (s.kind || 'skill') !== state.kind) return false;
      if (state.filter === 'on' && !s.enabled) return false;
      if (state.filter === 'off' && s.enabled) return false;
      if (state.filter === 'error' && s.loaded) return false;
      if (q && ![s.id, s.name, s.description, s.category].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    $('#module-count').textContent = `${list.length} / ${state.modules.length}`;
    $('#module-empty').classList.toggle('hidden', list.length > 0);
    $('#module-rows').innerHTML = list.map((s) => {
      const st = moduleStatus(s);
      const removable = Boolean(state.installed[s.id]) && !state.builtin.has(s.id);
      return `<tr data-id="${esc(s.id)}" data-kind="${esc(s.kind || 'skill')}">
        <td class="name-cell"><div class="mod-title">${esc(s.name || s.id)}</div><div class="mod-desc" title="${esc(s.description || '')}">${esc(s.description || '（没有简介）')}</div></td>
        <td>${esc(KIND[s.kind] || s.kind || '技能')}</td><td>v${esc(s.version || '-')}</td><td>${esc(sourceOf(s))}</td>
        <td><span class="pill ${st.cls}">${esc(st.text)}</span></td>
        <td><div class="cell-actions">
          <button class="btn sm ghost" data-act="toggle" ${s.loaded ? '' : 'disabled'}>${s.enabled ? '禁用' : '启用'}</button>
          ${removable ? '<button class="btn sm danger" data-act="uninstall">卸载</button>' : '<span class="pill off">内置</span>'}
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
    try { await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ enabled: next }) }); toast(`${next ? '已启用' : '已禁用'}：${id}`); await loadModules(); }
    catch (e) { toast(`切换失败：${e.message}`, 'err'); }
  }
  async function uninstall(id, kind) {
    const t = state.modules.find((s) => s.id === id);
    const ok = await confirmAction({ title: '卸载模块', text: `确认卸载「${t?.name || id}」？`, detail: `类型：${KIND[kind] || kind}\n步骤：停用 → 移入 data/.trash/ → 清理配置\n可恢复：是` });
    if (!ok) return;
    try { await api(`/api/modules/${kind}/${encodeURIComponent(id)}?mode=uninstall`, { method: 'DELETE' }); toast(`已卸载：${id}`); await loadModules(); }
    catch (e) { toast(`卸载失败：${e.message}`, 'err'); }
  }

  const logFields = (l) => ({ level: String(l.level || 'info').toLowerCase(), module: l.module || l.skill || '', text: String(l.text ?? l.msg ?? l.message ?? (typeof l === 'string' ? l : '')), time: l.ts ?? l.time ?? l.timestamp });
  function renderLogs() {
    const rows = state.logs.filter((l) => {
      const f = logFields(l);
      if (state.logLevel !== 'all' && f.level !== state.logLevel) return false;
      if (state.logQ && !`${f.text} ${f.module}`.toLowerCase().includes(state.logQ.toLowerCase())) return false;
      return true;
    });
    $('#log-count').textContent = `${rows.length} 条`;
    $('#log-list').innerHTML = rows.length ? rows.map((l) => {
      const f = logFields(l);
      return `<div class="log-line"><span class="log-time">${esc(fmtTime(f.time))}</span>
        <span class="log-level ${esc(f.level)}">${esc(f.level)}</span>
        <span class="log-module" title="${esc(f.module)}">${esc(f.module || '-')}</span>
        <span class="log-msg">${esc(f.text || '(结构化日志)')}</span>
        <button class="log-more" type="button" title="展开原始日志">⋯</button>
        <pre class="log-raw hidden">${esc(JSON.stringify(l, null, 2))}</pre></div>`;
    }).join('') : '<div class="empty">没有匹配的日志</div>';
  }
  async function loadLogs() {
    try { const d = await api('/api/logs?limit=200'); state.logs = d.logs || []; renderLogs(); }
    catch (e) { toast(`日志加载失败：${e.message}`, 'err'); }
  }

  async function loadUsage() {
    try {
      const d = await api('/api/usage/stats?range=7'); state.usage = d;
      const t = d.totals || {};
      const cards = [
        { label: '总 Token', value: fmtNum(t.totalTokens || 0), sub: `输入 ${fmtNum(t.promptTokens || 0)} · 输出 ${fmtNum(t.completionTokens || 0)}` },
        { label: '花费', value: `¥${Number(t.cost || 0).toFixed(2)}`, sub: `缓存命中 ${(Number(t.cacheHitRate || 0) * 100).toFixed(0)}%` },
        { label: '运行次数', value: fmtNum(t.runs || 0), sub: `精确调用 ${fmtNum(t.exactCalls || 0)}` },
        { label: '联网搜索', value: fmtNum(d.searchCount || 0), sub: '近 7 天' }
      ];
      $('#usage-cards').innerHTML = cards.map((c) => `<div class="card metric"><div class="label">${esc(c.label)}</div><div class="value">${esc(c.value)}</div><div class="sub">${esc(c.sub)}</div></div>`).join('');
      $('#usage-range').textContent = d.rangeLabel || '';
      const days = (d.days || []).slice(-7).map((x) => ({ label: String(x.day).slice(5), value: x.totalTokens || 0 }));
      $('#usage-chart').innerHTML = barChart(days, { unit: ' tokens' });
      const tools = Object.entries(d.toolCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ label: k, value: v }));
      $('#tool-bars').innerHTML = barRows(tools, { unit: ' 次' });
      const chats = (d.chats || []).slice(0, 8).map((c) => ({ label: c.key, value: c.totalTokens || 0 }));
      $('#chat-usage').innerHTML = barRows(chats, { unit: ' tk' });
    } catch (e) { toast(`用量加载失败：${e.message}`, 'err'); }
  }

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
      toast(state.paused ? '已恢复' : '已暂停'); await loadOverview();
    } catch (e) { toast(`操作失败：${e.message}`, 'err'); }
  }

  function init() {
    initTheme();
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));
    $('#refresh-btn').addEventListener('click', () => setPage(state.page));
    $('#pause-btn').addEventListener('click', togglePause);
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.goto)));
    $('#sheet-close').addEventListener('click', closeSheet);
    $('#sheet-mask').addEventListener('click', closeSheet);

    $('#kind-seg').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      state.kind = b.dataset.kind; $$('.seg-btn').forEach((x) => x.classList.toggle('active', x === b)); renderModules();
    });
    $('#module-search').addEventListener('input', (e) => { state.q = e.target.value; renderModules(); });
    $('#module-status').addEventListener('change', (e) => { state.filter = e.target.value; renderModules(); });
    $('#reset-filter').addEventListener('click', () => {
      state.kind = 'all'; state.q = ''; state.filter = 'all';
      $('#module-search').value = ''; $('#module-status').value = 'all';
      $$('.seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.kind === 'all')); renderModules();
    });
    $('#module-rows').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const tr = btn.closest('tr');
      if (btn.dataset.act === 'toggle') { const m = state.modules.find((s) => s.id === tr.dataset.id); toggleModule(tr.dataset.id, !m?.enabled); }
      else uninstall(tr.dataset.id, tr.dataset.kind);
    });
    $('#log-level').addEventListener('change', (e) => { state.logLevel = e.target.value; renderLogs(); });
    $('#log-search').addEventListener('input', (e) => { state.logQ = e.target.value; renderLogs(); });
    $('#log-refresh').addEventListener('click', loadLogs);
    $('#log-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.log-more'); if (!btn) return;
      const line = btn.closest('.log-line'); line.classList.toggle('open'); line.querySelector('.log-raw').classList.toggle('hidden');
    });
    let auto = null;
    $('#log-auto').addEventListener('change', (e) => { clearInterval(auto); auto = null; if (e.target.checked) auto = setInterval(loadLogs, 5000); });

    setPage('overview');
    setInterval(() => { if (state.page === 'overview') loadOverview(); }, 15000);
  }

  window.TS = { api, toast, esc, fmtBytes, fmtDuration, fmtNum, fmtTime, state, openSheet, closeSheet, setPage, confirmAction, barRows };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
