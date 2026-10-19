// 数据页：会话 / 存档 / 记忆（V1.1.0）
// 只读浏览，复用真实接口；详情用右侧抽屉展示。
(() => {
  'use strict';
  const { api, esc, fmtNum, fmtTime, openSheet } = window.TS;
  const $ = (s, r = document) => r.querySelector(s);

  let sessions = [];
  let chats = [];
  let memories = [];
  let sessionFilter = 'all';

  const statusPill = (s) => {
    const st = String(s || '').toLowerCase();
    if (st === 'running') return '<span class="pill warn">running</span>';
    if (st === 'error' || st === 'failed') return '<span class="pill err">error</span>';
    return `<span class="pill ok">${esc(st || 'done')}</span>`;
  };

  // 会话
  function renderSessions() {
    const list = sessions.filter((s) => sessionFilter === 'all' || String(s.status || '').toLowerCase() === sessionFilter);
    $('#session-count').textContent = `${list.length} / ${sessions.length}`;
    $('#session-list').innerHTML = list.length
      ? list.map((s) => `<div class="row clickable" data-sid="${esc(s.id)}">
          <span class="dot ${s.status === 'error' ? 'err' : s.status === 'running' ? 'warn' : 'on'}"></span>
          <div class="grow">
            <div class="title">${esc(s.chatKey || s.id)}</div>
            <div class="sub">${esc(s.trigger?.text || s.outcome || '')}</div>
          </div>
          <span class="side">${statusPill(s.status)} ${esc(fmtTime(s.startedAt))}</span>
        </div>`).join('')
      : '<div class="empty">暂无会话记录</div>';
  }

  async function loadSessions() {
    try {
      const d = await api('/api/sessions?limit=200');
      sessions = d.sessions || [];
      renderSessions();
    } catch (e) { window.TS.toast(`会话加载失败：${e.message}`, 'err'); }
  }

  async function openSession(id) {
    try {
      const d = await api(`/api/sessions/${encodeURIComponent(id)}`);
      const s = d.session || d;
      const u = s.usage || {};
      openSheet('会话详情', `<dl class="kv">
        <dt>ID</dt><dd>${esc(s.id)}</dd>
        <dt>会话</dt><dd>${esc(s.chatKey || '-')}</dd>
        <dt>状态</dt><dd>${statusPill(s.status)}</dd>
        <dt>开始</dt><dd>${esc(fmtTime(s.startedAt))}</dd>
        <dt>结束</dt><dd>${esc(fmtTime(s.endedAt))}</dd>
        <dt>模型</dt><dd>${esc(s.model || '-')}</dd>
        <dt>Token</dt><dd>${fmtNum(u.totalTokens || 0)}（输入 ${fmtNum(u.promptTokens || 0)} / 输出 ${fmtNum(u.completionTokens || 0)}）</dd>
        <dt>触发</dt><dd>${esc(s.trigger?.text || '-')}</dd>
        <dt>结果</dt><dd>${esc(s.outcome || '-')}</dd>
      </dl><p class="hint">完整处理过程仍在经典控制台的「会话」页查看。</p>`);
    } catch (e) { window.TS.toast(`详情加载失败：${e.message}`, 'err'); }
  }

  // 存档
  async function loadChats() {
    try {
      const d = await api('/api/chats');
      chats = d.chats || [];
      $('#chat-count').textContent = `${chats.length} 个会话`;
      $('#chat-list').innerHTML = chats.length
        ? chats.map((c) => `<div class="row clickable" data-chat="${esc(c.key || c.chatKey)}">
            <span class="dot on"></span>
            <div class="grow">
              <div class="title">${esc(c.chatName || c.key || c.chatKey)}</div>
              <div class="sub">${esc(c.lastText || '（暂无消息）')}</div>
            </div>
            <span class="side">${fmtNum(c.total || 0)} 条 · ${esc(fmtTime(c.lastTs))}</span>
          </div>`).join('')
        : '<div class="empty">暂无存档</div>';
    } catch (e) { window.TS.toast(`存档加载失败：${e.message}`, 'err'); }
  }

  async function openChat(key) {
    try {
      const routeKey = String(key).replace(/:/g, '_');
      const d = await api(`/api/chats/${encodeURIComponent(routeKey)}/messages?limit=80`);
      const list = d.messages || d.items || [];
      openSheet('消息存档', list.length
        ? `<div class="list">${list.slice(-80).map((m) => `<div class="row">
            <span class="dot"></span>
            <div class="grow"><div class="title">${esc(m.senderName || m.sender || m.role || '成员')}</div>
            <div class="sub" style="white-space:normal">${esc(m.text || m.message || '')}</div></div>
            <span class="side">${esc(fmtTime(m.time || m.ts))}</span></div>`).join('')}</div>`
        : '<div class="empty">这个会话还没有消息</div>');
    } catch (e) { window.TS.toast(`消息加载失败：${e.message}`, 'err'); }
  }

  // 记忆
  async function loadMemory() {
    try {
      const d = await api('/api/memory-files');
      memories = d.files || [];
      $('#memory-count').textContent = `${memories.length} 个会话`;
      $('#memory-list').innerHTML = memories.length
        ? memories.map((m) => `<div class="row clickable" data-mem="${esc(m.chatKey)}">
            <span class="dot on"></span>
            <div class="grow"><div class="title">${esc(m.chatKey)}</div>
            <div class="sub">${fmtNum(m.memberCount)} 位成员 · ${fmtNum(m.impressionCount)} 条印象</div></div>
            <span class="side">${esc(fmtTime(m.updatedAt))}</span></div>`).join('')
        : '<div class="empty">暂无记忆</div>';
    } catch (e) { window.TS.toast(`记忆加载失败：${e.message}`, 'err'); }
  }

  async function openMemory(key) {
    try {
      const routeKey = String(key).replace(/:/g, '_');
      const d = await api(`/api/memory-files/${encodeURIComponent(routeKey)}`);
      const impressions = d.memberImpression || [];
      openSheet('记忆详情', impressions.length
        ? `<div class="list">${impressions.map((m) => `<div class="row">
            <span class="dot"></span>
            <div class="grow"><div class="title">${esc(m.target || m.userId || '')}</div>
            <div class="sub" style="white-space:normal">${esc(m.content || '')}</div></div>
            <span class="side">${esc(fmtTime(m.createdAt))}</span></div>`).join('')}</div>`
        : '<div class="empty">暂无成员印象</div>');
    } catch (e) { window.TS.toast(`记忆详情加载失败：${e.message}`, 'err'); }
  }

  function init() {
    $('#session-refresh').addEventListener('click', loadSessions);
    $('#session-status').addEventListener('change', (e) => { sessionFilter = e.target.value; renderSessions(); });
    $('#session-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-sid]'); if (row) openSession(row.dataset.sid);
    });
    // 总览里的“最近会话”也复用详情
    $('#recent-sessions').addEventListener('click', (e) => {
      const row = e.target.closest('[data-session]'); if (row) openSession(row.dataset.session);
    });
    $('#chat-refresh').addEventListener('click', loadChats);
    $('#chat-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-chat]'); if (row) openChat(row.dataset.chat);
    });
    $('#memory-refresh').addEventListener('click', loadMemory);
    $('#memory-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-mem]'); if (row) openMemory(row.dataset.mem);
    });
  }

  window.TS_PAGES = { sessions: loadSessions, chats: loadChats, memory: loadMemory };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
