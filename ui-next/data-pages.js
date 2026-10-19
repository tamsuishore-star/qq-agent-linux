// 数据页：会话 / 存档 / 记忆（V1.1.0）
// 真实操作：会话重试/中止/删除/清空已结束；存档唤醒/已读/屏蔽/测试发送/清空/删消息；记忆整理/删除。
(() => {
  'use strict';
  const { api, esc, fmtNum, fmtTime, openSheet, toast, confirmAction } = window.TS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const routeKey = (k) => String(k || '').replace(/:/g, '_');

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
          <div class="grow"><div class="title">${esc(s.chatKey || s.id)}</div>
            <div class="sub">${esc(s.trigger?.text || s.outcome || '')}</div></div>
          <span class="side">${statusPill(s.status)} ${esc(fmtTime(s.startedAt))}</span></div>`).join('')
      : '<div class="empty">暂无会话记录</div>';
  }

  async function loadSessions() {
    try { const d = await api('/api/sessions?limit=200'); sessions = d.sessions || []; renderSessions(); }
    catch (e) { toast(`会话加载失败：${e.message}`, 'err'); }
  }

  async function openSession(id) {
    try {
      const d = await api(`/api/sessions/${encodeURIComponent(id)}`);
      const s = d.session || d;
      const u = s.usage || {};
      openSheet('会话详情', `<dl class="kv">
        <dt>ID</dt><dd>${esc(s.id)}</dd><dt>会话</dt><dd>${esc(s.chatKey || '-')}</dd>
        <dt>状态</dt><dd>${statusPill(s.status)}</dd><dt>开始</dt><dd>${esc(fmtTime(s.startedAt))}</dd>
        <dt>结束</dt><dd>${esc(fmtTime(s.endedAt))}</dd><dt>模型</dt><dd>${esc(s.model || '-')}</dd>
        <dt>Token</dt><dd>${fmtNum(u.totalTokens || 0)}（输入 ${fmtNum(u.promptTokens || 0)} / 输出 ${fmtNum(u.completionTokens || 0)}）</dd>
        <dt>触发</dt><dd>${esc(s.trigger?.text || s.triggerText || '-')}</dd><dt>结果</dt><dd>${esc(s.outcome || '-')}</dd>
      </dl><div class="setting-actions" style="margin-top:12px">
        <button class="btn" id="sess-retry" type="button">重试</button>
        <button class="btn" id="sess-abort" type="button">中止</button>
        <button class="btn danger" id="sess-delete" type="button">删除记录</button>
      </div><p class="hint">重试会重新执行该次会话；中止仅对运行中的会话有效。</p>`);
      $('#sess-retry').onclick = () => act(`/api/sessions/${encodeURIComponent(id)}/retry`, '重试已提交');
      $('#sess-abort').onclick = () => act(`/api/sessions/${encodeURIComponent(id)}/abort`, '已请求中止');
      $('#sess-delete').onclick = async () => {
        if (!await confirmAction({ title: '删除会话记录', text: '删除后不可恢复，确认？' })) return;
        try { await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('已删除'); window.TS.closeSheet(); await loadSessions(); }
        catch (e) { toast(`删除失败：${e.message}`, 'err'); }
      };
    } catch (e) { toast(`详情加载失败：${e.message}`, 'err'); }
  }

  async function act(url, okText) {
    try { await api(url, { method: 'POST', body: '{}' }); toast(okText); await loadSessions(); }
    catch (e) { toast(`操作失败：${e.message}`, 'err'); }
  }

  // 存档
  async function loadChats() {
    try {
      const d = await api('/api/chats');
      chats = d.chats || [];
      $('#chat-count').textContent = `${chats.length} 个会话`;
      $('#chat-list').innerHTML = chats.length
        ? chats.map((c) => `<div class="row clickable" data-chat="${esc(c.key || c.chatKey)}">
            <span class="dot on"></span><div class="grow">
              <div class="title">${esc(c.chatName || c.key || c.chatKey)}</div>
              <div class="sub">${esc(c.lastText || '（暂无消息）')}</div></div>
            <span class="side">${fmtNum(c.total || 0)} 条 · ${esc(fmtTime(c.lastTs))}</span></div>`).join('')
        : '<div class="empty">暂无存档</div>';
    } catch (e) { toast(`存档加载失败：${e.message}`, 'err'); }
  }

  async function openChat(key) {
    const rk = routeKey(key);
    try {
      const d = await api(`/api/chats/${encodeURIComponent(rk)}/messages?limit=80`);
      const list = d.messages || [];
      openSheet('消息存档', `
        <div class="setting-actions" style="margin-bottom:12px;flex-wrap:wrap">
          <button class="btn sm" id="chat-wake" type="button">唤醒</button>
          <button class="btn sm" id="chat-read" type="button">标为已读</button>
          <button class="btn sm" id="chat-mute" type="button">屏蔽未读</button>
          <button class="btn sm danger" id="chat-clear" type="button">清空存档</button>
        </div>
        <div class="field"><label>测试发送</label><div style="display:flex;gap:6px">
          <input class="input" id="chat-test-text" placeholder="输入要发送的内容" style="flex:1" />
          <button class="btn sm primary" id="chat-send" type="button">发送</button></div>
          <span class="hint">受白名单限制，发送成功会写入存档。</span></div>
        <div class="list">${list.length ? list.slice(-80).map((m) => `<div class="row">
            <span class="dot"></span><div class="grow"><div class="title">${esc(m.senderName || m.senderId || '成员')}</div>
            <div class="sub" style="white-space:normal">${esc(m.text || '')}</div></div>
            <span class="side">${esc(fmtTime(m.ts || m.time))}</span>
            <button class="btn sm ghost" data-del-msg="${esc(m.id)}" title="删除这条消息">删</button></div>`).join('') : '<div class="empty">这个会话还没有消息</div>'}</div>`);

      const post = (path, body, ok) => api(`/api/chats/${encodeURIComponent(rk)}${path}`, { method: 'POST', body: JSON.stringify(body || {}) })
        .then(() => { toast(ok); }).catch((e) => toast(`操作失败：${e.message}`, 'err'));
      $('#chat-wake').onclick = () => post('/wake', {}, '已触发唤醒');
      $('#chat-read').onclick = () => post('/mark-read', {}, '已标为已读');
      $('#chat-mute').onclick = () => post('/mute', {}, '已屏蔽未读');
      $('#chat-send').onclick = () => {
        const text = $('#chat-test-text').value.trim();
        if (!text) { toast('内容为空', 'err'); return; }
        post('/test-send', { text }, '已发送'); $('#chat-test-text').value = '';
      };
      $('#chat-clear').onclick = async () => {
        if (!await confirmAction({ title: '清空存档', text: '删除该会话全部消息，不可恢复，确认？' })) return;
        post('/clear', {}, '存档已清空'); window.TS.closeSheet(); await loadChats();
      };
      $$('[data-del-msg]').forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.dataset.delMsg);
          if (!await confirmAction({ title: '删除消息', text: '删除这一条存档？' })) return;
          try { await api(`/api/chats/${encodeURIComponent(rk)}/delete-messages`, { method: 'POST', body: JSON.stringify({ ids: [id] }) }); btn.closest('.row').remove(); toast('已删除'); }
          catch (e) { toast(`删除失败：${e.message}`, 'err'); }
        };
      });
    } catch (e) { toast(`消息加载失败：${e.message}`, 'err'); }
  }

  // 记忆
  async function loadMemory() {
    try {
      const d = await api('/api/memory-files');
      memories = d.files || [];
      $('#memory-count').textContent = `${memories.length} 个会话`;
      $('#memory-list').innerHTML = memories.length
        ? memories.map((m) => `<div class="row clickable" data-mem="${esc(m.chatKey)}">
            <span class="dot on"></span><div class="grow"><div class="title">${esc(m.chatKey)}</div>
            <div class="sub">${fmtNum(m.memberCount)} 位成员 · ${fmtNum(m.impressionCount)} 条印象</div></div>
            <span class="side">${esc(fmtTime(m.updatedAt))}</span></div>`).join('')
        : '<div class="empty">暂无记忆</div>';
    } catch (e) { toast(`记忆加载失败：${e.message}`, 'err'); }
  }

  async function openMemory(key) {
    const rk = routeKey(key);
    try {
      const d = await api(`/api/memory-files/${encodeURIComponent(rk)}`);
      const imps = d.memberImpression || [];
      const members = d.members || [];
      openSheet('记忆详情', `
        <div class="setting-actions" style="margin-bottom:12px">
          <button class="btn sm danger" id="mem-clear" type="button">删除该会话记忆</button>
        </div>
        <h2 style="font-size:13px;color:var(--tx-2)">成员印象（${imps.length}）</h2>
        <div class="list">${imps.length ? imps.map((m) => `<div class="row">
          <span class="dot"></span><div class="grow"><div class="title">${esc(m.target || m.userId || '')}</div>
          <div class="sub" style="white-space:normal">${esc(m.content || '')}</div></div>
          <span class="side">${esc(fmtTime(m.createdAt))}</span></div>`).join('') : '<div class="empty">暂无印象</div>'}</div>
        <h2 style="font-size:13px;color:var(--tx-2);margin-top:16px">成员（${members.length}）</h2>
        <div class="list">${members.length ? members.map((m) => `<div class="row">
          <span class="dot"></span><div class="grow"><div class="title">${esc(m.name || m.userId)}</div>
          <div class="sub">${esc(m.userId || '')}</div></div>
          <button class="btn sm danger" data-del-mem="${esc(m.userId)}">删除</button></div>`).join('') : '<div class="empty">暂无成员</div>'}</div>`);

      $('#mem-clear').onclick = async () => {
        if (!await confirmAction({ title: '删除会话记忆', text: '该会话的全部成员印象将被删除，不可恢复。' })) return;
        try { await api(`/api/memory-files/${encodeURIComponent(rk)}`, { method: 'DELETE' }); toast('已删除'); window.TS.closeSheet(); await loadMemory(); }
        catch (e) { toast(`删除失败：${e.message}`, 'err'); }
      };
      $$('[data-del-mem]').forEach((btn) => {
        btn.onclick = async () => {
          if (!await confirmAction({ title: '删除成员印象', text: '删除该成员的全部印象？' })) return;
          try { await api(`/api/memory-files/${encodeURIComponent(rk)}/members/${encodeURIComponent(btn.dataset.delMem)}`, { method: 'DELETE' }); toast('已删除'); window.TS.closeSheet(); await loadMemory(); }
          catch (e) { toast(`删除失败：${e.message}`, 'err'); }
        };
      });
    } catch (e) { toast(`记忆详情加载失败：${e.message}`, 'err'); }
  }

  function init() {
    $('#session-refresh').addEventListener('click', loadSessions);
    $('#session-status').addEventListener('change', (e) => { sessionFilter = e.target.value; renderSessions(); });
    $('#session-clear').addEventListener('click', async () => {
      if (!await confirmAction({ title: '清空已结束会话', text: '保留运行中/等待中的会话，其余记录将删除。' })) return;
      try { await api('/api/sessions/clear-finished', { method: 'POST', body: '{}' }); toast('已清空'); await loadSessions(); }
      catch (e) { toast(`清空失败：${e.message}`, 'err'); }
    });
    $('#session-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-sid]'); if (row) openSession(row.dataset.sid);
    });
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
    $('#memory-consolidate').addEventListener('click', async () => {
      if (!await confirmAction({ title: '立即整理记忆', text: '将调用整理模型处理全部会话记忆，可能产生 Token 消耗。' })) return;
      try { await api('/api/memory-files/consolidate', { method: 'POST', body: '{}' }); toast('已提交整理任务'); }
      catch (e) { toast(`整理失败：${e.message}`, 'err'); }
    });
  }

  window.TS_PAGES = { sessions: loadSessions, chats: loadChats, memory: loadMemory };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
