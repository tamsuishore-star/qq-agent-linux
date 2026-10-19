// TamsuiShore QQ Agent · 新版工作台（V1.1.0 预览 /next）
// 纯原生 JS，无构建工具；所有数据来自后端真实接口。
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    page: 'overview',
    kind: 'all',
    q: '',
    statusFilter: 'all',
    modules: [],
    builtin: new Set(),
    installed: {},
    logs: [],
    logLevel: 'all',
    autoTimer: null,
    paused: false
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...options
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const fmtBytes = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '-';
    const u = ['B', 'KB', 'MB', 'GB'];
    let v = n, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  };
  const fmtDuration = (sec) => {
    if (!Number.isFinite(sec)) return '-';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d} 天 ${h} 小时`;
    if (h) return `${h} 小时 ${m} 分`;
    return `${m} 分钟`;
  };
  const fmtTime = (v) => {
    try { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v ?? '') : d.toLocaleString('zh-CN', { hour12: false }); }
    catch { return String(v ?? ''); }
  };

  // ── 主题 ──
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    try { localStorage.setItem('ts-theme', theme); } catch { /* ignore */ }
  }
  function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('ts-theme') || 'dark'; } catch { /* ignore */ }
    applyTheme(saved);
    $('#theme-btn')?.addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    });
  }

  // ── Toast / Confirm ──
  let toastTimer = null;
  function toast(message, type = 'ok') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function confirmAction({ title, text, detail = '' }) {
    return new Promise((resolve) => {
      const dlg = $('#confirm-dialog');
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      const det = $('#confirm-detail');
      det.textContent = detail;
      det.classList.toggle('hidden', !detail);
      const onClose = () => {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'ok');
      };
      dlg.addEventListener('close', onClose);
      dlg.returnValue = '';
      dlg.showModal();
    });
  }

  // ── 导航 ──
  const TITLES = { overview: '总览', modules: '能力', logs: '日志', about: '关于' };
  function setPage(page) {
    state.page = page;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `page-${page}`));
    $('#page-title').textContent = TITLES[page] || page;
    if (page === 'modules') loadModules();
    if (page === 'logs') loadLogs();
    if (page === 'about') loadAbout();
    if (page === 'overview') loadOverview();
  }

  // ── 总览 ──
  function renderOverview(status, overview, modules) {
    const ob = status?.onebot || {};
    const dot = $('#sb-dot');
    const ok = ob.connected === true;
    dot.className = `dot big ${ok ? 'on' : 'err'}`;
    $('#sb-title').textContent = ok ? '机器人运行中' : (ob.firstConnect === false && ob.diagnosis ? 'QQ 未连接' : '连接异常');
    $('#sb-sub').textContent = ok
      ? `${ob.self?.nickname || ''} ${ob.self?.userId || ''}`.trim()
      : (ob.diagnosis || ob.error || '等待 OneBot 连接');
    $('#sb-meta').innerHTML = overview
      ? `PID ${esc(overview.pid)} · Node ${esc(overview.node)}<br>已运行 ${esc(fmtDuration(overview.uptimeSec))}`
      : '进程指标不可用';

    $('#conn-dot').className = `dot ${ok ? 'on' : 'err'}`;
    $('#conn-text').textContent = ok ? 'OneBot 已连接' : 'OneBot 未连接';
    $('#model-chip').textContent = `模型 ${overview?.model || '-'}`;

    const sk = modules || [];
    const enabled = sk.filter((s) => s.enabled).length;
    const broken = sk.filter((s) => !s.loaded).length;
    const usage = status?.usage || {};

    const cards = [
      { label: '模块', value: `${enabled} / ${sk.length}`, sub: broken ? `${broken} 个异常` : '全部正常' },
      { label: '今日用量', value: `${usage.totalTokens ?? 0}`, sub: `输入 ${usage.promptTokens ?? 0} · 输出 ${usage.completionTokens ?? 0}` },
      { label: '进程内存', value: overview ? fmtBytes(overview.memory.rss) : '-', sub: overview ? `堆 ${fmtBytes(overview.memory.heapUsed)}` : '' },
      { label: '系统可用', value: overview ? fmtBytes(overview.system.freemem) : '-', sub: overview ? `共 ${fmtBytes(overview.system.totalmem)} · ${overview.system.cpus} 核` : '' },
      { label: '系统负载', value: overview ? overview.system.load1.toFixed(2) : '-', sub: overview ? `${overview.system.load5.toFixed(2)} / ${overview.system.load15.toFixed(2)}` : '' }
    ];
    $('#stat-grid').innerHTML = cards.map((c) => `
      <div class="stat-card">
        <div class="stat-label">${esc(c.label)}</div>
        <div class="stat-value">${esc(c.value)}</div>
        <div class="stat-sub">${esc(c.sub)}</div>
      </div>`).join('');

    const issues = sk.filter((s) => !s.loaded || (s.enabled && !s.active));
    $('#health-count').textContent = issues.length ? `${issues.length} 个需要关注` : '全部正常';
    $('#health-list').innerHTML = issues.length
      ? issues.map((s) => `
        <div class="list-row">
          <span class="dot ${s.loaded ? 'warn' : 'err'}"></span>
          <div class="grow">
            <div class="name">${esc(s.name || s.id)}</div>
            <div class="why">${esc(s.loadError || s.reason || '依赖未就绪')}</div>
          </div>
          <span class="pill ${s.loaded ? 'warn' : 'err'}">${s.loaded ? '依赖' : '加载失败'}</span>
        </div>`).join('')
      : '<div class="empty">没有发现异常模块</div>';

    state.paused = Boolean(status?.paused);
    const pauseBtn = $('#pause-btn');
    if (pauseBtn) pauseBtn.textContent = state.paused ? '恢复' : '暂停';
  }

  async function loadOverview() {
    try {
      const [status, overview, modules] = await Promise.all([
        api('/api/status').catch(() => null),
        api('/api/overview').catch(() => null),
        api('/api/modules').catch(() => null)
      ]);
      if (modules) {
        state.modules = modules.modules || [];
        state.builtin = new Set(modules.builtin || []);
        state.installed = modules.installed || {};
      }
      renderOverview(status, overview, state.modules);
    } catch (e) {
      toast(`总览加载失败：${e.message}`, 'err');
    }
  }

  // ── 能力 ──
  const KIND_LABEL = { skill: '技能', plugin: '插件' };
  function moduleStatus(s) {
    if (!s.loaded) return { cls: 'err', text: '加载失败' };
    if (!s.enabled) return { cls: 'off', text: '已禁用' };
    if (s.active) return { cls: 'ok', text: '生效中' };
    return { cls: 'warn', text: '依赖未就绪' };
  }
  function sourceOf(s) {
    if (state.installed[s.id]) return '用户安装';
    if (state.builtin.has(s.id)) return '内置';
    return '未知';
  }

  function renderModules() {
    const q = state.q.trim().toLowerCase();
    const list = state.modules.filter((s) => {
      if (state.kind !== 'all' && (s.kind || 'skill') !== state.kind) return false;
      if (state.statusFilter === 'on' && !s.enabled) return false;
      if (state.statusFilter === 'off' && s.enabled) return false;
      if (state.statusFilter === 'error' && s.loaded) return false;
      if (q && ![s.id, s.name, s.description, s.category].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    $('#module-count').textContent = `${list.length} / ${state.modules.length}`;
    $('#module-empty').classList.toggle('hidden', list.length > 0);

    $('#module-rows').innerHTML = list.map((s) => {
      const st = moduleStatus(s);
      const kind = KIND_LABEL[s.kind] || s.kind || '技能';
      const removable = Boolean(state.installed[s.id]) && !state.builtin.has(s.id);
      return `
        <tr data-id="${esc(s.id)}" data-kind="${esc(s.kind || 'skill')}">
          <td>
            <div class="mod-name">
              <span>${esc(s.name || s.id)}</span>
              <small>${esc(s.id)} · ${esc((s.description || '').slice(0, 60))}</small>
            </div>
          </td>
          <td>${esc(kind)}</td>
          <td>v${esc(s.version || '-')}</td>
          <td>${esc(sourceOf(s))}</td>
          <td><span class="pill ${st.cls}">${esc(st.text)}</span></td>
          <td>
            <div class="actions">
              <button class="btn ghost sm" data-act="toggle" ${s.loaded ? '' : 'disabled'}>${s.enabled ? '禁用' : '启用'}</button>
              <button class="btn danger sm" data-act="uninstall" ${removable ? '' : 'disabled'} title="${removable ? '卸载并移入回收站' : (state.builtin.has(s.id) ? '内置模块仅可禁用' : '未登记为用户安装')}">卸载</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  async function loadModules() {
    try {
      const data = await api('/api/modules');
      state.modules = data.modules || [];
      state.builtin = new Set(data.builtin || []);
      state.installed = data.installed || {};
      renderModules();
    } catch (e) {
      toast(`模块列表加载失败：${e.message}`, 'err');
    }
  }

  async function toggleModule(id, nextEnabled) {
    try {
      await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ enabled: nextEnabled }) });
      toast(`${nextEnabled ? '已启用' : '已禁用'}：${id}`);
      await loadModules();
    } catch (e) {
      toast(`切换失败：${e.message}`, 'err');
    }
  }

  async function uninstallModule(id, kind) {
    const target = state.modules.find((s) => s.id === id);
    const ok = await confirmAction({
      title: '卸载模块',
      text: `确认卸载「${target?.name || id}」？`,
      detail: [
        `类型：${KIND_LABEL[kind] || kind}`,
        '操作：停用 → 目录移入 data/.trash/ → 清理配置',
        '影响：该模块立即从运行中移除；配置项会被删除。',
        '可恢复：是（回收站保留原目录）。'
      ].join('\n')
    });
    if (!ok) return;
    try {
      await api(`/api/modules/${kind}/${encodeURIComponent(id)}?mode=uninstall`, { method: 'DELETE' });
      toast(`已卸载：${id}`);
      await loadModules();
    } catch (e) {
      toast(`卸载失败：${e.message}`, 'err');
    }
  }

  // ── 日志 ──
  function renderLogs() {
    const rows = state.logs.filter((l) => state.logLevel === 'all' || String(l.level || '').toLowerCase() === state.logLevel);
    $('#log-count').textContent = `${rows.length} 条`;
    $('#log-list').innerHTML = rows.length
      ? rows.map((l) => {
        const level = String(l.level || 'info').toLowerCase();
        const msg = l.msg ?? l.message ?? (typeof l === 'string' ? l : JSON.stringify(l));
        return `<div class="log-line">
          <span class="log-time">${esc(fmtTime(l.time ?? l.ts ?? l.timestamp ?? ''))}</span>
          <span class="log-level ${esc(level)}">${esc(level)}</span>
          <span class="log-msg">${esc(msg)}</span>
        </div>`;
      }).join('')
      : '<div class="empty">暂无日志</div>';
  }

  async function loadLogs() {
    try {
      const data = await api('/api/logs?limit=200');
      state.logs = Array.isArray(data.logs) ? data.logs : [];
      renderLogs();
    } catch (e) {
      toast(`日志加载失败：${e.message}`, 'err');
    }
  }

  // ── 关于 ──
  async function loadAbout() {
    try {
      const [ver] = await Promise.all([api('/api/version').catch(() => null), loadModules()]);
      $('#about-version').textContent = ver?.version || '-';
      $('#about-builtin').textContent = `${state.builtin.size} 个`;
      $('#about-installed').textContent = `${Object.keys(state.installed).length} 个`;
    } catch { /* ignore */ }
  }

  // ── 暂停 / 恢复 ──
  async function togglePause() {
    try {
      if (state.paused) await api('/api/pause', { method: 'DELETE' });
      else await api('/api/pause', { method: 'POST', body: JSON.stringify({ paused: true }) });
      toast(state.paused ? '已恢复' : '已暂停');
      await loadOverview();
    } catch (e) {
      toast(`操作失败：${e.message}`, 'err');
    }
  }

  // ── 初始化 ──
  function init() {
    initTheme();
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));
    $('#refresh-btn')?.addEventListener('click', () => {
      if (state.page === 'overview') loadOverview();
      else if (state.page === 'modules') loadModules();
      else if (state.page === 'logs') loadLogs();
      else loadAbout();
    });
    $('#pause-btn')?.addEventListener('click', togglePause);

    $('#kind-seg')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      state.kind = btn.dataset.kind;
      $$('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderModules();
    });
    $('#module-search')?.addEventListener('input', (e) => { state.q = e.target.value; renderModules(); });
    $('#module-status')?.addEventListener('change', (e) => { state.statusFilter = e.target.value; renderModules(); });

    $('#module-rows')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const id = tr?.dataset.id;
      const kind = tr?.dataset.kind || 'skill';
      if (!id) return;
      if (btn.dataset.act === 'toggle') {
        const mod = state.modules.find((s) => s.id === id);
        await toggleModule(id, !mod?.enabled);
      } else if (btn.dataset.act === 'uninstall') {
        await uninstallModule(id, kind);
      }
    });

    $('#log-level')?.addEventListener('change', (e) => { state.logLevel = e.target.value; renderLogs(); });
    $('#log-refresh')?.addEventListener('click', loadLogs);
    $('#log-auto')?.addEventListener('change', (e) => {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
      if (e.target.checked) state.autoTimer = setInterval(loadLogs, 5000);
    });

    setPage('overview');
    setInterval(() => {
      if (state.page === 'overview') loadOverview();
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
