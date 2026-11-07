// ============================================================================
// МОДУЛЬ: КЛІЄНТ ОНЛАЙН-ГРИ (браузер гравця)
// Якщо сторінку віддав сервер гри (server/server.js), гра працює онлайн:
//  • лобі: нікнейм, вибір сторони, керування хоста (хто гравець, хто бот, карта, старт,
//    збереження/завантаження), список гравців;
//  • усі накази, що змінюють гру, ідуть на сервер — функції правил, які інтерфейс викликає
//    для наказів, підмінено (installProxies): наказ виконує сервер і повертає результат
//    разом із новою картиною фракції (08b_view.js). У браузері гра нічого не симулює.
//  • сповіщення сервера (Server-Sent Events): чужі ходи, лобі, чат;
//  • чат: загальний і приватний (стороні).
// Токен гравця зберігається в браузері — після перезавантаження сторінки чи перезапуску
// сервера гравець автоматично повертається на свою сторону.
// ============================================================================
const Net = (() => {
  // Накази, що змінюють гру (ті самі списки, що й на сервері)
  const COMMANDS = [
    'Engine.issueMoveOrder', 'Engine.setStance', 'Engine.deploy', 'Engine.cancelOrder', 'Engine.endPhase', 'Combat.attack',
    'Transport.disembark', 'Transport.disembarkAll', 'Transport.board', 'Transport.splitSquad', 'Transport.merge', 'Transport.abandonVehicle',
    'Loot.loot', 'Loot.dropCargo', 'Loot.recoverDead',
    'Logistics.resupply', 'Logistics.pickupWounded', 'Logistics.loadItem', 'Logistics.loadFromStore', 'Logistics.issueFromCargo',
    'Logistics.unloadToStore', 'Logistics.destroyFacility', 'Logistics.claimFacility',
    'Field.takeVehicle', 'Field.startProject', 'Field.mount', 'Field.layWireField', 'Field.issueBinoculars', 'Field.requisition', 'Field.issueVehicle',
    'Politics.aid', 'Politics.propaganda', 'Politics.raiseMilitia', 'Politics.sendSpies', 'Politics.propose', 'Politics.dissolveAlliance',
    'Politics.setLabor', 'Politics.interrogate', 'Politics.respond',
    'Recruit.foundWorkshop', 'Recruit.form', 'Recruit.buy', 'Recruit.setWorkshopRecipe', 'Recruit.upgradeWorkshop',
    'Foreign.sellRF', 'Foreign.requestInvestment', 'Foreign.officialRequest', 'Foreign.hirePmc', 'Foreign.callVolunteers',
    'Air.launch', 'Decisions.start', 'Decisions.cancel'
  ];
  const LS_KEY = 'yugotaria.online';
  let active = false, token = null, isHost = false, lobby = null, es = null, rev = -1, busy = false;
  let chat = [], unread = 0, chatOpen = false, chatTo = 'all', status = 'connecting', fetching = false;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* приватний режим */ } } };

  async function detect() {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
    try {
      const r = await fetch('/api/hello', { cache: 'no-store' });
      if (!r.ok) return false;
      const j = await r.json();
      return !!(j && j.game === 'yugotaria');
    } catch (e) { return false; }
  }
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  // Синхронний запит — інтерфейс після наказу одразу читає результат (як у звичайній грі)
  function postSync(path, body) {
    const x = new XMLHttpRequest();
    try {
      x.open('POST', path, false);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(body));
    } catch (e) { return { ok: false, reason: 'Немає зв’язку з сервером.' }; }
    if (x.status !== 200) return { ok: false, reason: `Сервер відповів помилкою (${x.status}).` };
    try { return JSON.parse(x.responseText); } catch (e) { return { ok: false, reason: 'Некоректна відповідь сервера.' }; }
  }

  // ---------------------------------------------------- накази
  function command(mod, fn, args) {
    if (busy) return { ok: false, reason: 'Попередній наказ ще обробляється.' };
    busy = true;
    let r;
    try { r = postSync('/api/cmd', { token, mod, fn, args: JSON.parse(JSON.stringify(args)) }); }
    finally { busy = false; }
    if (!r.ok) return { ok: false, reason: r.reason || 'Наказ відхилено.' };
    rev = r.rev;
    if (r.view) UI.applyView(View.restore(r.view));
    return r.result == null ? { ok: true } : r.result;
  }
  function installProxies() {
    const MODS = { Engine, Combat, Transport, Loot, Logistics, Politics, Field, Recruit, Foreign, Air, Decisions };
    for (const key of COMMANDS) {
      const [m, fn] = key.split('.');
      if (!MODS[m] || typeof MODS[m][fn] !== 'function') continue;
      MODS[m][fn] = function (state, ...args) { return command(m, fn, args); };
    }
  }
  async function fetchView() {
    if (fetching || !lobby || lobby.phase !== 'game' || lobby.me == null || lobby.me.faction == null) return;
    fetching = true;
    try {
      const r = await fetch('/api/view?token=' + encodeURIComponent(token), { cache: 'no-store' });
      if (!r.ok) return;
      const v = await r.json();
      if (busy) return;
      rev = v.view ? v.view.rev : rev;
      UI.applyView(View.restore(v));
    } catch (e) { /* наступне сповіщення спробує знову */ }
    finally { fetching = false; }
  }

  // ---------------------------------------------------- підключення
  async function boot() {
    active = true;
    installProxies();
    const params = new URLSearchParams(location.search);
    const hostKey = params.get('host');
    if (hostKey) { try { sessionStorage.setItem('yugotaria.hostKey', hostKey); } catch (e) { /* */ } history.replaceState(null, '', location.pathname); }
    const saved = store.get();
    UI.setOnline(true);
    if (saved.token || saved.name) await join(saved.name || 'Гравець', saved.token);
    else renderLobby();
  }
  async function join(name, tok) {
    let hk = null;
    try { hk = sessionStorage.getItem('yugotaria.hostKey'); } catch (e) { /* */ }
    const r = await post('/api/join', { name, token: tok || undefined, hostKey: hk || undefined });
    if (!r.ok) { UI.toast(r.reason || 'Не вдалося приєднатися.', true); return; }
    token = r.token; isHost = r.isHost;
    store.set({ token, name });
    connect();
  }
  function connect() {
    if (es) es.close();
    status = 'connecting';
    es = new EventSource('/api/events?token=' + encodeURIComponent(token));
    es.onopen = () => { status = 'online'; renderStatus(); };
    es.onerror = () => { status = 'offline'; renderStatus(); };
    es.addEventListener('lobby', e => {
      const prevPhase = lobby && lobby.phase;
      lobby = JSON.parse(e.data);
      isHost = !!(lobby.me && lobby.me.isHost);
      renderLobby();
      if (lobby.phase === 'game' && lobby.me && lobby.me.faction != null && prevPhase !== 'game') fetchView();
      if (lobby.phase === 'lobby' && UI.getState()) UI.leaveOnlineGame();
      UI.renderOnlineBar();
    });
    es.addEventListener('update', e => { const d = JSON.parse(e.data); if (d.rev !== rev) fetchView(); });
    es.addEventListener('chatlog', e => { chat = JSON.parse(e.data); renderChat(); });
    es.addEventListener('chat', e => {
      const m = JSON.parse(e.data);
      chat.push(m); if (chat.length > 300) chat.shift();
      if (!chatOpen && !m.system) unread++;
      renderChat();
    });
  }
  const lobbyAction = (action, extra) => post('/api/lobby', Object.assign({ token, action }, extra || {})).then(r => { if (!r.ok) UI.toast(r.reason || 'Не вдалося.', true); return r; });

  // ---------------------------------------------------- лобі
  const KIND_NAMES = { human: 'Гравець', easy: 'Бот — легкий', hard: 'Бот — важкий' };
  function openLobby() { const el = $('netlobby'); if (el) { el.hidden = false; renderLobby(); } }
  function closeLobby() { const el = $('netlobby'); if (el && lobby && lobby.phase === 'game' && lobby.me && lobby.me.faction != null) el.hidden = true; }
  function renderLobby() {
    const el = $('netlobby');
    if (!el) return;
    const inGame = lobby && lobby.phase === 'game';
    const mine = lobby && lobby.me ? lobby.me.faction : null;
    if (inGame && mine != null && el.dataset.auto !== 'shown') { el.hidden = true; el.dataset.auto = 'shown'; }
    if (!inGame) { el.hidden = false; el.dataset.auto = ''; }
    if (el.hidden) return;
    if (!token) {
      el.innerHTML = `<div class="nl-card"><h1>Юготарія<small>онлайн-гра</small></h1>
        <p class="notice">Ви підключилися до сервера гри. Як вас звати?</p>
        <div class="row"><input id="nlName" maxlength="24" placeholder="Ваше ім’я" autocomplete="nickname"><button type="button" class="primary" id="nlJoin">Приєднатися</button></div></div>`;
      const go = () => join(($('nlName').value || '').trim() || 'Гравець');
      $('nlJoin').onclick = go; $('nlName').onkeydown = e => { if (e.key === 'Enter') go(); };
      setTimeout(() => { const i = $('nlName'); if (i) i.focus(); }, 0);
      return;
    }
    if (!lobby) { el.innerHTML = '<div class="nl-card"><p class="notice">Підключення до сервера…</p></div>'; return; }
    const L = lobby;
    const slotRow = s => {
      const isMe = mine === s.faction;
      let who;
      if (s.kind !== 'human') who = `<span class="nl-bot">${esc(KIND_NAMES[s.kind])}</span>`;
      else if (s.owner) who = `<span class="nl-pl${s.online ? '' : ' off'}">${esc(s.owner)}${s.online ? '' : ' (не в мережі)'}</span>`;
      else who = '<span class="nl-free">вільно</span>';
      const take = s.kind === 'human' && (!s.owner || isMe) ? (isMe ? '<button type="button" data-nl="leave">Звільнити</button>' : `<button type="button" class="primary" data-nl="take" data-f="${s.faction}">Зайняти</button>`) : '';
      const hostCtl = isHost ? `<select data-nlkind="${s.faction}" aria-label="Хто керує: ${esc(s.name)}">${Object.entries(KIND_NAMES).map(([k, n]) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
        ${s.kind === 'human' && s.owner && !isMe ? `<button type="button" data-nl="kick" data-f="${s.faction}" title="Звільнити сторону">✕</button>` : ''}` : '';
      return `<div class="nl-slot${isMe ? ' me' : ''}"><span class="dot" style="background:${CONFIG.factions[s.faction].color}"></span><b>${esc(s.name)}</b>${who}<span class="nl-act">${take}${hostCtl}</span></div>`;
    };
    el.innerHTML = `<div class="nl-card">
      <div class="nl-head"><h1>Юготарія<small>онлайн-гра${inGame && L.game ? ` · ${esc(L.game.time)}` : ''}</small></h1>
        <span class="nl-status ${status}">${{ online: '● на зв’язку', connecting: '○ підключення…', offline: '● немає зв’язку' }[status]}</span></div>
      <div class="row"><label for="nlMyName">Ваше ім’я</label><input id="nlMyName" maxlength="24" value="${esc(L.me ? L.me.name : '')}"><button type="button" id="nlRename">Змінити</button>${isHost ? '<span class="nl-host">ви — хост</span>' : ''}</div>
      <section><h2>Сторони</h2><div class="nl-slots">${L.slots.map(slotRow).join('')}</div>
        <p class="notice">${inGame ? (mine != null ? 'Гра йде — ви керуєте своєю стороною.' : 'Гра йде. Займіть вільну сторону, щоб приєднатися.') : 'Займіть сторону. Хост обирає, хто з них — гравці, а хто — боти, і починає гру.'}</p></section>
      ${isHost ? `<section><h2>Хост</h2>
        ${!inGame ? `<div class="row"><label for="nlSeed">Номер карти</label><input type="number" id="nlSeed" value="${L.seed}" min="1" max="999999"><button type="button" class="primary" id="nlStart">Почати кампанію</button></div>` :
          `<div class="row"><button type="button" id="nlSave">Зберегти гру</button><button type="button" id="nlToLobby">Завершити й повернутися до лобі</button></div>`}
        ${L.saves && L.saves.length ? `<div class="row"><label for="nlLoad">Збереження</label><select id="nlLoad">${L.saves.map(s => `<option value="${esc(s.file)}">${esc(s.file)} — ${new Date(s.time).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</option>`).join('')}</select><button type="button" id="nlLoadBtn">Завантажити</button></div>` : ''}
      </section>` : ''}
      <section><h2>Гравці</h2><p class="nl-players">${L.players.map(p => `<span class="${p.online ? '' : 'off'}">${esc(p.name)}${p.isHost ? ' ★' : ''}${p.faction != null ? ` · ${esc(CONFIG.factions[p.faction].short)}` : ''}</span>`).join('')}</p></section>
      <section><h2>Чат</h2><div class="nl-chat" id="nlChat"></div></section>
      ${inGame && mine != null ? '<div class="row"><button type="button" class="primary" id="nlBack">До гри</button></div>' : ''}
    </div>`;
    el.querySelectorAll('[data-nl]').forEach(b => b.onclick = () => lobbyAction(b.dataset.nl, { faction: Number(b.dataset.f) }));
    el.querySelectorAll('[data-nlkind]').forEach(s => s.onchange = () => lobbyAction('slot', { faction: Number(s.dataset.nlkind), kind: s.value }));
    $('nlRename').onclick = () => { const n = ($('nlMyName').value || '').trim(); if (!n) return; store.set({ token, name: n }); lobbyAction('name', { name: n }); };
    if ($('nlStart')) $('nlStart').onclick = () => lobbyAction('seed', { seed: Number($('nlSeed').value) }).then(() => lobbyAction('start'));
    if ($('nlSave')) $('nlSave').onclick = () => lobbyAction('save').then(r => { if (r.ok) UI.toast('Гру збережено на сервері.'); });
    if ($('nlToLobby')) $('nlToLobby').onclick = () => lobbyAction('toLobby');
    if ($('nlLoadBtn')) $('nlLoadBtn').onclick = () => lobbyAction('load', { file: $('nlLoad').value }).then(r => { if (r.ok) { el.dataset.auto = ''; } });
    if ($('nlBack')) $('nlBack').onclick = () => { el.hidden = true; };
    renderChat();
  }
  function renderStatus() { const s = document.querySelector('.nl-status'); if (s) renderLobby(); UI.renderOnlineBar(); }

  // ---------------------------------------------------- чат
  function chatHtml() {
    const fname = f => (f == null ? '' : CONFIG.factions[f].short);
    const list = chat.slice(-120).map(m => `<div class="cm${m.system ? ' sys' : ''}${m.to !== 'all' ? ' priv' : ''}"><span class="cm-t">${new Date(m.t).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>
      ${m.system ? '' : `<b style="color:${m.fromFaction != null ? CONFIG.factions[m.fromFaction].color : 'inherit'}">${esc(m.from)}${m.fromFaction != null ? ` (${esc(fname(m.fromFaction))})` : ''}</b>${m.to !== 'all' ? ` → ${esc(fname(m.to))}` : ''}: `}${esc(m.text)}</div>`).join('') || '<p class="notice">Повідомлень ще немає.</p>';
    const opts = [['all', 'Усім']].concat([0, 1, 2].map(f => [String(f), 'Лише ' + CONFIG.factions[f].short]));
    return `<div class="chat-list">${list}</div>
      <div class="chat-in"><select class="chat-to" aria-label="Кому">${opts.map(([v, n]) => `<option value="${v}"${String(chatTo) === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <input class="chat-text" maxlength="400" placeholder="Повідомлення…" aria-label="Повідомлення"><button type="button" class="chat-send">Надіслати</button></div>`;
  }
  function bindChat(root) {
    if (!root) return;
    const input = root.querySelector('.chat-text'), to = root.querySelector('.chat-to');
    const sendIt = () => {
      const text = (input.value || '').trim(); if (!text) return;
      input.value = '';
      chatTo = to.value === 'all' ? 'all' : Number(to.value);
      post('/api/chat', { token, to: chatTo, text }).then(r => { if (!r.ok) UI.toast(r.reason, true); });
    };
    root.querySelector('.chat-send').onclick = sendIt;
    input.onkeydown = e => { if (e.key === 'Enter') sendIt(); e.stopPropagation(); };
    to.onchange = () => { chatTo = to.value === 'all' ? 'all' : Number(to.value); };
    const l = root.querySelector('.chat-list'); if (l) l.scrollTop = l.scrollHeight;
  }
  function renderChat() {
    for (const id of ['nlChat', 'chatBody']) {
      const el = $(id);
      if (!el || (id === 'chatBody' && !chatOpen)) continue;
      const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.classList.contains('chat-text');
      const draft = focused ? document.activeElement.value : '';
      el.innerHTML = chatHtml(); bindChat(el);
      if (focused) { const i = el.querySelector('.chat-text'); i.value = draft; i.focus(); }
    }
    if (chatOpen) unread = 0;
    const b = $('btnChat'); if (b) b.innerHTML = 'Чат' + (unread ? `<span class="badge">${unread}</span>` : '');
  }
  function toggleChat() {
    const p = $('chatPanel'); if (!p) return;
    chatOpen = p.hidden; p.hidden = !chatOpen;
    if (chatOpen) unread = 0;
    renderChat();
    if (chatOpen) { const i = p.querySelector('.chat-text'); if (i) i.focus(); }
  }

  return {
    detect, boot, command, openLobby, closeLobby, toggleChat,
    active: () => active, faction: () => (lobby && lobby.me ? lobby.me.faction : null), busy: () => busy,
    isHost: () => isHost, lobby: () => lobby, status: () => status, COMMANDS
  };
})();
