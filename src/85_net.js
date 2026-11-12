// ============================================================================
// МОДУЛЬ: МЕРЕЖЕВА ГРА ЧЕРЕЗ HGS (HOME GAME SERVER, https://github.com/idologonia/HGS)
// «Гра в мережі» з головного меню: hgs.js сам знаходить сервер (адресу публікує HGS у
// github:idologonia/hgs-address), перший раз показує вхід/реєстрацію й заходить у кімнату
// "lobby". Звідси — список кімнат, створення своєї (з вибором сторін: гравець / бот легкий /
// бот важкий, номер карти), лобі кімнати, гра й чат.
// Сервер головний (server/logic.py): браузер надсилає лише дії гравця, сервер виконує їх
// і надсилає кожному картину ЙОГО сторони (08b_view.js). Функції правил, якими інтерфейс
// віддає накази, підмінено (installProxies): наказ іде на сервер, а виклик повертає Promise
// з результатом сервера — інтерфейс чекає на нього через await.
// Якщо hgs.js не завантажився або сервер вимкнено — «Гра на одинці» працює, як і раніше.
// ============================================================================
const Net = (() => {
  const GAME_ID = 'ugotarian-wargame';
  const SERVER = 'github:idologonia/hgs-address';
  const LOBBY = 'lobby';
  // Накази, що змінюють гру (той самий перелік перевіряє сервер — server/engine.js)
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
  const KIND_NAMES = { human: 'Гравець', easy: 'Бот — легкий', hard: 'Бот — важкий' };
  let active = false, hgs = null, myId = null, roomId = null, info = null, saves = [], rooms = [];
  let chat = [], unread = 0, chatOpen = false, chatTo = 'all', status = 'connecting';
  let busy = false, nextId = 1, roomsTimer = null, view = 'connecting';
  const pending = new Map();
  // Кімната, де гравець був (повернення після перезавантаження сторінки)
  const ROOM_KEY = 'yugotaria.hgs.room';
  const savedRoom = { get() { try { return localStorage.getItem(ROOM_KEY); } catch (e) { return null; } },
    set(v) { try { if (v) localStorage.setItem(ROOM_KEY, v); else localStorage.removeItem(ROOM_KEY); } catch (e) { /* */ } } };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fcol = f => CONFIG.factions[f].color;

  const available = () => typeof HGS !== 'undefined' && typeof HGS.start === 'function';
  const inGameRoom = () => roomId != null && roomId !== LOBBY;
  function myFaction() {
    if (!info || !myId) return null;
    const s = info.slots.find(x => x.kind === 'human' && x.owner === myId);
    return s ? s.faction : null;
  }
  const isHost = () => !!(info && myId && info.host === myId);

  // ---------------------------------------------------- накази
  function command(mod, fn, args) {
    if (busy) return Promise.resolve({ ok: false, reason: 'Попередній наказ ще обробляється.' });
    if (!hgs || !inGameRoom()) return Promise.resolve({ ok: false, reason: 'Немає зв’язку з сервером гри.' });
    busy = true;
    const id = nextId++;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); busy = false; resolve({ ok: false, reason: 'Сервер не відповів — спробуйте ще раз.' }); }, 30000);
      pending.set(id, { resolve, timer });
      try { hgs.send('cmd', { id, mod, fn, args: JSON.parse(JSON.stringify(args)) }); }
      catch (e) { clearTimeout(timer); pending.delete(id); busy = false; resolve({ ok: false, reason: 'Не вдалося надіслати наказ: ' + e.message }); }
    });
  }
  function installProxies() {
    const MODS = { Engine, Combat, Transport, Loot, Logistics, Politics, Field, Recruit, Foreign, Air, Decisions };
    for (const key of COMMANDS) {
      const [m, fn] = key.split('.');
      if (!MODS[m] || typeof MODS[m][fn] !== 'function') continue;
      MODS[m][fn] = function (state, ...args) { return command(m, fn, args); };
    }
  }

  // ---------------------------------------------------- підключення
  function overlay() { return $('netlobby'); }
  function setView(v) { view = v; const el = overlay(); if (el) el.hidden = false; render(); }

  async function open() {
    if (!available()) { UI.toast('Мережева гра недоступна: не завантажився hgs.js.', true); return; }
    active = true;
    installProxies();
    UI.setOnline(true);
    setView('connecting');
    // перед входом — чи сервер увімкнено (інакше вікно SDK «сервер вимкнено» не дало б повернутися)
    const local = new URLSearchParams(location.search).get('hgs');
    if (!local) {
      let online = false;
      try { const inf = await HGS.findServer(SERVER.replace(/^github:/, '')); online = !!(inf && inf.online && inf.server); } catch (e) { online = false; }
      if (!online) { setView('offline'); return; }
    }
    watchLogin();
    try { hgs = await HGS.start({ gameId: GAME_ID, server: SERVER, lang: 'uk' }); }
    catch (e) { setView('offline'); return; }
    myId = hgs.player ? hgs.player.id : null;
    bind();
    status = 'online';
    roomId = hgs.room ? hgs.room.id : null;
    const back = savedRoom.get();
    if (back && back !== roomId) {
      try { await hgs.joinRoom(back); return; }   // room_joined → afterJoin
      catch (e) { savedRoom.set(null); }
    }
    afterJoin();
  }
  // Вікно входу SDK: додаємо «Скасувати» — повернутися до гри на одинці
  function watchLogin() {
    const t = setInterval(() => {
      if (hgs) { clearInterval(t); return; }
      const box = document.querySelector('[data-hgs-login]');
      if (!box || box.querySelector('[data-yugo-cancel]')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('data-yugo-cancel', ''); b.textContent = 'Скасувати — грати на одинці';
      b.style.cssText = 'margin-top:10px;padding:8px;border-radius:7px;border:1px solid #2a2f3a;background:transparent;color:#e6e8ee;font:inherit;cursor:pointer;width:100%';
      b.onclick = () => { clearInterval(t); box.remove(); leave(); };
      (box.querySelector('form') || box).appendChild(b);
    }, 300);
  }
  function bind() {
    hgs.on('hgs:state', d => { status = d.state === 'connected' ? 'online' : d.state === 'reconnecting' || d.state === 'connecting' || d.state === 'authenticating' ? 'connecting' : 'offline'; render(); UI.renderOnlineBar(); });
    hgs.on('hgs:room_joined', d => { roomId = d.room.id; afterJoin(); });
    hgs.on('hgs:room_closed', () => { if (inGameRoom()) goLobby('Кімнату закрито.'); });
    hgs.on('hgs:kicked', () => { UI.toast('Вас вилучено з кімнати.', true); goLobby(); });
    hgs.on('room', d => {
      const wasGame = info && info.phase === 'game';
      info = d;
      if (info.phase === 'setup' && wasGame) UI.leaveOnlineGame();
      if (view !== 'game' || info.phase !== 'game' || myFaction() == null) render();
      UI.renderOnlineBar();
    });
    hgs.on('saves', d => { saves = Array.isArray(d) ? d : []; render(); });
    hgs.on('view', d => {
      if (!d || !d.view) return;
      UI.applyView(View.restore(d.view));
      if (view !== 'game') { view = 'game'; const el = overlay(); if (el) el.hidden = true; }
    });
    hgs.on('result', d => {
      const p = pending.get(d && d.id);
      if (!p) return;
      pending.delete(d.id); clearTimeout(p.timer); busy = false;
      p.resolve(d.ok ? (d.result == null ? { ok: true } : d.result) : { ok: false, reason: d.reason || 'Наказ відхилено.' });
    });
    hgs.on('notice', d => UI.toast(d && d.text ? d.text : 'Відмовлено.', true));
    hgs.on('chatlog', d => { chat = Array.isArray(d) ? d : []; renderChat(); });
    hgs.on('chat', m => { chat.push(m); if (chat.length > 300) chat.shift(); if (!chatOpen && !m.system) unread++; renderChat(); });
  }
  function afterJoin() {
    info = null; saves = []; chat = [];
    try { hgs.send('hello', {}); } catch (e) { /* перепідключення повторить */ }
    if (inGameRoom()) { savedRoom.set(roomId); stopRooms(); setView('room'); }
    else { UI.leaveOnlineGame(); setView('rooms'); startRooms(); }
  }
  function goLobby(msg) {
    if (msg) UI.toast(msg);
    savedRoom.set(null);
    UI.leaveOnlineGame();
    roomId = null; info = null;
    const j = () => hgs.joinRoom(LOBBY).catch(e => UI.toast('Не вдалося повернутися до лобі: ' + (e.message || e.code), true));
    if (hgs.room && hgs.room.id !== LOBBY) hgs.leaveRoom().then(j, j); else j();
  }
  function leave() { savedRoom.set(null); try { if (hgs) hgs.disconnect(); } catch (e) { /* */ } location.href = location.pathname; }

  // ---------------------------------------------------- кімнати
  function startRooms() { stopRooms(); refreshRooms(); roomsTimer = setInterval(refreshRooms, 4000); }
  function stopRooms() { if (roomsTimer) clearInterval(roomsTimer); roomsTimer = null; }
  function refreshRooms() {
    if (!hgs || view !== 'rooms') return;
    hgs.listRooms().then(list => { rooms = (list || []).filter(r => r.id !== LOBBY); if (view === 'rooms') render(); }, () => {});
  }
  async function createRoom() {
    const name = ($('nrName').value || '').trim() || 'Кампанія';
    const seed = Math.max(1, Math.min(999999, parseInt($('nrSeed').value, 10) || 1999));
    const slots = [0, 1, 2].map(f => $('nrSide' + f).value);
    try {
      const room = await hgs.createRoom({ name, maxPlayers: 8, params: { seed, slots } });
      await hgs.joinRoom(room.id);
    } catch (e) { UI.toast('Не вдалося створити кімнату: ' + (e.message || e.code), true); }
  }
  const joinRoom = id => hgs.joinRoom(id).catch(e => UI.toast(e.code === 'room_full' ? 'Кімната заповнена.' : 'Не вдалося увійти: ' + (e.message || e.code), true));

  // ---------------------------------------------------- вікно мережевої гри
  function openLobby() { const el = overlay(); if (el) { el.hidden = false; render(); } }
  function header(sub) {
    return `<div class="nl-head"><h1>Юготарія<small>${esc(sub)}</small></h1>
      <span class="nl-status ${status}">${{ online: '● на зв’язку', connecting: '○ підключення…', offline: '● немає зв’язку' }[status]}</span></div>`;
  }
  function render() {
    const el = overlay();
    if (!el || el.hidden || !active) return;
    if (view === 'connecting') {
      el.innerHTML = `<div class="nl-card">${header('гра в мережі')}<p class="notice">Підключення до сервера гри…</p>
        <div class="row"><button type="button" id="nlBackSolo">Грати на одинці</button></div></div>`;
    } else if (view === 'offline') {
      el.innerHTML = `<div class="nl-card">${header('гра в мережі')}<p class="notice">Сервер гри зараз вимкнено або недоступний. Спробуйте пізніше — або грайте на одинці.</p>
        <div class="row"><button type="button" class="primary" id="nlRetry">Спробувати ще раз</button><button type="button" id="nlBackSolo">Грати на одинці</button></div></div>`;
      $('nlRetry').onclick = () => open();
    } else if (view === 'rooms') {
      const row = r => {
        const p = r.params || {};
        const sides = Array.isArray(p.sides) ? p.sides : Array.isArray(p.slots) ? p.slots : [];
        return `<div class="nl-room"><div><b>${esc(r.name)}</b>
          <div class="nl-sub">${p.phase === 'game' ? `гра йде${p.time ? ' · ' + esc(p.time) : ''}` : 'набір гравців'} · гравців ${r.players}/${r.max_players || r.maxPlayers || '—'}${p.free != null ? ` · вільних сторін ${p.free}` : ''}${sides.length ? ' · ' + sides.map((k, f) => `<span class="dot" style="background:${fcol(f)}"></span>${esc(k === 'human' ? 'гравець' : k === 'hard' ? 'бот важкий' : 'бот легкий')}`).join(' ') : ''}</div></div>
          <button type="button" class="primary" data-room="${esc(r.id)}" ${r.status === 'locked' ? 'disabled' : ''}>Увійти</button></div>`;
      };
      el.innerHTML = `<div class="nl-card">${header('гра в мережі' + (hgs && hgs.player ? ' · ' + hgs.player.name : ''))}
        <section><h2>Кімнати</h2><div class="nl-rooms">${rooms.length ? rooms.map(row).join('') : '<p class="notice">Кімнат ще немає — створіть свою.</p>'}</div></section>
        <section><h2>Створити кімнату</h2>
          <div class="row"><label for="nrName">Назва</label><input id="nrName" maxlength="40" value="${esc((hgs && hgs.player ? hgs.player.name + ': ' : '') + 'кампанія')}"></div>
          <div class="nl-slots">${[0, 1, 2].map(f => `<div class="nl-slot"><span class="dot" style="background:${fcol(f)}"></span><b>${esc(CONFIG.factions[f].name)}</b><span></span>
            <span class="nl-act"><select id="nrSide${f}" aria-label="Хто керує: ${esc(CONFIG.factions[f].name)}">${Object.entries(KIND_NAMES).map(([k, n]) => `<option value="${k}"${(f === 0 ? 'human' : 'easy') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></span></div>`).join('')}</div>
          <div class="row"><label for="nrSeed">Номер карти</label><input type="number" id="nrSeed" value="1999" min="1" max="999999"><button type="button" class="primary" id="nrCreate">Створити й увійти</button></div>
          <p class="notice">Ви будете хостом кімнати: оберете свою сторону, дочекаєтеся друзів і почнете гру. Сторони можна змінити й у самій кімнаті.</p></section>
        <section><h2>Чат</h2><div class="nl-chat" id="nlChat"></div></section>
        <div class="row"><button type="button" id="nlBackSolo">Вийти з мережі — грати на одинці</button></div></div>`;
      el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => joinRoom(b.dataset.room));
      $('nrCreate').onclick = createRoom;
    } else {
      roomLobby(el);
    }
    const back = $('nlBackSolo'); if (back) back.onclick = leave;
    renderChat();
  }
  function roomLobby(el) {
    if (!info) { el.innerHTML = `<div class="nl-card">${header('кімната')}<p class="notice">Вхід у кімнату…</p></div>`; return; }
    const L = info, mine = myFaction(), host = isHost(), inGame = L.phase === 'game';
    const slotRow = s => {
      const isMe = mine === s.faction;
      let who;
      if (s.kind !== 'human') who = `<span class="nl-bot">${esc(KIND_NAMES[s.kind])}</span>`;
      else if (s.owner) who = `<span class="nl-pl${s.online ? '' : ' off'}">${esc(s.owner_name)}${s.online ? '' : ' (не в мережі)'}</span>`;
      else who = '<span class="nl-free">вільно</span>';
      const take = s.kind === 'human' && (!s.owner || isMe) ? (isMe ? '<button type="button" data-nl="leave_side">Звільнити</button>' : `<button type="button" class="primary" data-nl="take" data-f="${s.faction}">Зайняти</button>`) : '';
      const hostCtl = host ? `<select data-nlkind="${s.faction}" aria-label="Хто керує: ${esc(s.name)}">${Object.entries(KIND_NAMES).map(([k, n]) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
        ${s.kind === 'human' && s.owner && !isMe ? `<button type="button" data-nl="kick" data-f="${s.faction}" title="Звільнити сторону">✕</button>` : ''}` : '';
      return `<div class="nl-slot${isMe ? ' me' : ''}"><span class="dot" style="background:${fcol(s.faction)}"></span><b>${esc(s.name)}</b>${who}<span class="nl-act">${take}${hostCtl}</span></div>`;
    };
    el.innerHTML = `<div class="nl-card">${header(`кімната «${L.name}»${inGame && L.game ? ' · ' + L.game.time : ''}`)}
      <section><h2>Сторони</h2><div class="nl-slots">${L.slots.map(slotRow).join('')}</div>
        <p class="notice">${inGame ? (mine != null ? 'Гра йде — ви керуєте своєю стороною.' : 'Гра йде. Займіть вільну сторону, щоб приєднатися.') : host ? 'Ви — хост: оберіть, хто з сторін гравці, а хто боти, займіть свою й почніть гру.' : 'Займіть сторону й чекайте, поки хост почне гру.'}</p></section>
      ${host ? `<section><h2>Хост</h2>
        ${!inGame ? `<div class="row"><label for="nlSeed">Номер карти</label><input type="number" id="nlSeed" value="${L.seed}" min="1" max="999999"><button type="button" class="primary" id="nlStart">Почати кампанію</button></div>
          ${saves.length ? `<div class="row"><label for="nlResume">Продовжити гру</label><select id="nlResume">${saves.map(s => `<option value="${esc(s.id)}">${esc(s.name)} — ${esc(s.time)}</option>`).join('')}</select><button type="button" id="nlResumeBtn">Продовжити</button></div>` : ''}` :
          '<div class="row"><button type="button" id="nlSave">Зберегти гру</button><button type="button" id="nlEnd">Завершити гру</button></div>'}
      </section>` : ''}
      <section><h2>У кімнаті</h2><p class="nl-players">${L.players.map(p => `<span>${esc(p.name)}${p.id === L.host ? ' ★' : ''}${p.faction != null ? ` · ${esc(CONFIG.factions[p.faction].short)}` : ''}</span>`).join('')}</p></section>
      <section><h2>Чат</h2><div class="nl-chat" id="nlChat"></div></section>
      <div class="row">${inGame && mine != null ? '<button type="button" class="primary" id="nlBack">До гри</button>' : ''}<button type="button" id="nlLeaveRoom">Вийти з кімнати</button></div>
    </div>`;
    el.querySelectorAll('[data-nl]').forEach(b => b.onclick = () => hgs.send(b.dataset.nl, { faction: Number(b.dataset.f) }));
    el.querySelectorAll('[data-nlkind]').forEach(s => s.onchange = () => hgs.send('slot', { faction: Number(s.dataset.nlkind), kind: s.value }));
    if ($('nlStart')) $('nlStart').onclick = () => { hgs.send('seed', { seed: Number($('nlSeed').value) }); hgs.send('start', {}); };
    if ($('nlResumeBtn')) $('nlResumeBtn').onclick = () => hgs.send('resume', { save: $('nlResume').value });
    if ($('nlSave')) $('nlSave').onclick = () => hgs.send('save', {});
    if ($('nlEnd')) $('nlEnd').onclick = () => hgs.send('end', {});
    if ($('nlBack')) $('nlBack').onclick = () => { el.hidden = true; };
    $('nlLeaveRoom').onclick = () => goLobby();
  }

  // ---------------------------------------------------- чат
  function chatHtml() {
    const sh = f => (f == null ? '' : CONFIG.factions[f].short);
    const list = chat.slice(-120).map(m => `<div class="cm${m.system ? ' sys' : ''}${m.to !== 'all' ? ' priv' : ''}"><span class="cm-t">${new Date(m.t).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>
      ${m.system ? '' : `<b style="color:${m.fromFaction != null ? fcol(m.fromFaction) : 'inherit'}">${esc(m.from)}${m.fromFaction != null ? ` (${esc(sh(m.fromFaction))})` : ''}</b>${m.to !== 'all' ? ` → ${esc(sh(m.to))}` : ''}: `}${esc(m.text)}</div>`).join('') || '<p class="notice">Повідомлень ще немає.</p>';
    const opts = [['all', 'Усім']].concat(inGameRoom() ? [0, 1, 2].map(f => [String(f), 'Лише ' + CONFIG.factions[f].short]) : []);
    return `<div class="chat-list">${list}</div>
      <div class="chat-in"><select class="chat-to" aria-label="Кому">${opts.map(([v, n]) => `<option value="${v}"${String(chatTo) === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <input class="chat-text" maxlength="400" placeholder="Повідомлення…" aria-label="Повідомлення"><button type="button" class="chat-send">Надіслати</button></div>`;
  }
  function bindChat(root) {
    const input = root.querySelector('.chat-text'), to = root.querySelector('.chat-to');
    const sendIt = () => {
      const text = (input.value || '').trim(); if (!text || !hgs) return;
      input.value = '';
      chatTo = to.value === 'all' ? 'all' : Number(to.value);
      try { hgs.send('chat', { to: chatTo, text }); } catch (e) { UI.toast('Не вдалося надіслати.', true); }
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

  // Для рядка ходу в інтерфейсі: сторони кімнати з іменами гравців
  function lobby() {
    if (!info) return null;
    return { slots: info.slots.map(s => ({ kind: s.kind, owner: s.owner_name })) };
  }

  return {
    available, open, openLobby, resumable: () => available() && !!savedRoom.get(), toggleChat, command,
    active: () => active, faction: myFaction, busy: () => busy, isHost, lobby, status: () => status, COMMANDS
  };
})();
