// ============================================================================
// МОДУЛЬ: ІНТЕРФЕЙС — РЕНДЕРИНГ КАРТИ, ПАНЕЛІ, ВВЕДЕННЯ
// Інтерфейс лише читає стан і викликає Engine / Combat / Intel / SaveSystem.
// Показує тільки те, що знає фракція-«глядач» (туман війни): у грі кількох людей — фракція
// поточної фази; коли людина одна — завжди її фракція (боти ходять, а вона бачить своє);
// коли грають лише боти — фракція, обрана в панелі глядача.
// ============================================================================
const UI = (() => {
  let state = null;
  const view = { cx: 0, cy: 0, s: 24, showControl: true, showGrid: true, showSupply: false, showZones: true };
  let selectedId = null, selectedHex = -1, hoverHex = -1;
  let selectedEnemy = null;          // id ворожого підрозділу (видимого або позначки)
  let mode = null;                   // null | 'move' | 'retreat' | 'attack'
  let preview = null;                // попередній перегляд руху або атаки
  let intensity = 'normal';
  let report = null;                 // звіт бою для показу
  let leftTab = 'own';               // own | intel
  let handover = true;               // екран передачі ходу
  let viewFaction = null;            // чиїми очима показуємо карту (null — фракція поточної фази)
  let botBusy = false, botTimer = null;
  const spectator = { paused: false, delay: 700, view: 0 };   // режим «лише боти»
  let canvas, ctx, cw = 0, ch = 0, dpr = 1, dirty = true;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fcolor = f => getComputedStyle(document.documentElement).getPropertyValue('--f-' + CONFIG.factions[f].key).trim() || CONFIG.factions[f].color;
  let FC = CONFIG.factions.map(f => f.color);
  const MAPFC = CONFIG.factions.map(f => f.color);   // кольори на паперовій карті
  const ABBR = ['СВ', 'ДП', 'НП'];
  const pf = () => viewFaction != null ? viewFaction : Engine.phaseFaction(state);

  // ------------------------------------------------------- гравці й боти
  // hotseat — кілька людей (екран передачі ходу); solo — одна людина проти ботів;
  // spectate — усі фракції під ботами, людина спостерігає.
  function playMode() {
    if (typeof Net !== 'undefined' && Net.active()) return 'online';
    const n = AI.humans(state).length;
    return n === 0 ? 'spectate' : n === 1 ? 'solo' : 'hotseat';
  }
  // Чи може людина зараз віддавати накази (її фаза, не хід бота, не глядач)
  function commandable() {
    if (!state || botBusy || handover) return false;
    const f = Engine.phaseFaction(state);
    if (playMode() === 'online') return f != null && f === Net.faction() && !Net.busy();
    return f != null && !AI.isBot(state, f) && f === pf();
  }
  function applyViewer() {
    const m = playMode();
    viewFaction = m === 'online' ? Net.faction() : m === 'solo' ? AI.humans(state)[0] : m === 'spectate' ? spectator.view : null;
  }
  // Після будь-якої зміни фази: або запускаємо бота, або передаємо хід людині
  function afterPhaseChange() {
    applyViewer();
    // онлайн: фази й ботів веде сервер; картка «Ваш хід» — у applyView
    if (playMode() === 'online') { botBusy = false; renderAll(); return; }
    const f = Engine.phaseFaction(state);
    const m = playMode();
    clearTimeout(botTimer);
    if (state.campaign && state.campaign.over) {
      botBusy = false; handover = m === 'hotseat';
    } else if (AI.isBot(state, f)) {
      botBusy = true; handover = m === 'hotseat';
      if (!(m === 'spectate' && spectator.paused)) botTimer = setTimeout(runBotPhase, m === 'spectate' ? spectator.delay : 60);
    } else {
      botBusy = false;
      // одна людина: звіт «поки вас не було» — лише якщо є тривоги; кілька — завжди передача ходу
      handover = m === 'hotseat' || newAlerts(f).length > 0;
    }
    renderAll();
  }
  function runBotPhase() {
    botTimer = null;
    if (!state || state.campaign.over || !AI.isBot(state, Engine.phaseFaction(state))) { afterPhaseChange(); return; }
    let r;
    try { r = AI.runPhase(state); } catch (e) { console.error('ШІ:', e); }
    const e = Engine.endPhase(state);
    if (e.ok && e.hourEnded) {
      const sv = SaveSystem.saveToSlot('auto', state);
      if (!sv.ok && playMode() !== 'spectate') toast('Автозбереження не вдалося: ' + sv.reason, true);
    }
    if (!e.ok) { botBusy = false; toast(e.reason, true); renderAll(); return; }
    if (selectedId != null && !Engine.unitById(state, selectedId)) resetSelection();
    if (playMode() !== 'spectate') { mode = null; preview = null; }
    void r;
    afterPhaseChange();
  }
  function renderBotbar() {
    const el = $('botbar');
    if (!state) { el.hidden = true; return; }
    const m = playMode();
    const f = Engine.phaseFaction(state);
    const parts = [];
    if (m === 'online') {
      const L = Net.lobby();
      const slot = L && f != null ? L.slots[f] : null;
      const who = !slot ? '' : slot.kind !== 'human' ? 'бот' : slot.owner ? slot.owner : 'вільно';
      const st = Net.status();
      parts.push(`<span class="who"><span class="dot" style="background:${st === 'online' ? '#3a8a3a' : '#b3261e'}"></span>${st === 'online' ? 'онлайн' : 'немає зв’язку'}</span>`);
      if (f != null && f !== Net.faction()) parts.push(`<span class="who"><span class="dot" style="background:${FC[f]}"></span>Хід: ${esc(CONFIG.factions[f].short)} — ${esc(who)}…</span>`);
      else if (f === Net.faction()) parts.push('<span class="who"><b>Ваш хід</b></span>');
    } else if (m === 'spectate') {
      parts.push(`<span class="who">Лише боти${state.campaign.over ? ' · кампанію завершено' : ''}</span>`);
      parts.push(`<button type="button" id="spPause" ${state.campaign.over ? 'disabled' : ''}>${spectator.paused ? '▶ Продовжити' : '⏸ Пауза'}</button>`);
      parts.push(`<button type="button" id="spStep" ${spectator.paused && !state.campaign.over ? '' : 'disabled'}>Крок</button>`);
      parts.push(`<label>Темп <select id="spSpeed">${[[1500, 'повільно'], [700, 'звичайно'], [150, 'швидко']].map(([v, n]) => `<option value="${v}"${spectator.delay === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`);
      parts.push(`<label>Погляд <select id="spView">${[0, 1, 2].map(k => `<option value="${k}"${spectator.view === k ? ' selected' : ''}>${esc(CONFIG.factions[k].short)}</option>`).join('')}</select></label>`);
    } else if (botBusy && f != null) {
      parts.push(`<span class="who"><span class="dot" style="background:${FC[f]}"></span>Ходить бот: ${esc(CONFIG.factions[f].short)} (${esc(AI.CONTROLLER_NAMES[AI.controller(state, f)].replace('Бот ', '').replace(/[()]/g, ''))})…</span>`);
    }
    el.hidden = !parts.length;
    el.innerHTML = parts.join('');
    if (m !== 'spectate') return;
    $('spPause').onclick = () => { spectator.paused = !spectator.paused; afterPhaseChange(); };
    $('spStep').onclick = () => { if (spectator.paused && AI.isBot(state, Engine.phaseFaction(state))) runBotPhase(); };
    $('spSpeed').onchange = e => { spectator.delay = Number(e.target.value); };
    $('spView').onchange = e => { spectator.view = Number(e.target.value); applyViewer(); resetSelection(); invalidateBase(); renderAll(); };
  }

  // ------------------------------------------------------------ ініціалізація
  function init() {
    canvas = $('map');
    ctx = canvas.getContext('2d');
    FC = [0, 1, 2].map(fcolor);
    const ro = new ResizeObserver(resize);
    ro.observe($('mapwrap'));
    bindInput();
    bindButtons();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', () => { FC = [0, 1, 2].map(fcolor); invalidateBase(); renderAll(); });
    // назви пунктів у статичному шарі мають перемалюватися, коли довантажиться шрифт
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { invalidateBase(); redraw(); });
    requestAnimationFrame(loop);
  }

  function resetSelection() {
    selectedId = null; selectedHex = -1; selectedEnemy = null; mode = null; preview = null; report = null;
  }

  function setState(s) {
    clearTimeout(botTimer); botTimer = null; botBusy = false;
    state = s;
    if (!state.players) AI.configure(state, ['human', 'human', 'human']);   // старі збереження — гра людей
    resetSelection();
    leftTab = 'own';
    applyViewer();
    focusFaction();
    closeMainMenu();
    afterPhaseChange();
  }

  function focusFaction() {
    const f = pf();
    const first = state.units.find(u => u.faction === f);
    if (first) centerOn(first.idx); else centerOn(Math.floor(state.map.w * state.map.h / 2));
  }

  function resize() {
    const r = $('mapwrap').getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cw = Math.max(1, r.width); ch = Math.max(1, r.height);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    dirty = true;
  }

  function loop() {
    if (dirty && state) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }
  const redraw = () => { dirty = true; };
  let zoneCache = null;
  let phaseAlertIds = new Set();   // тривоги, що надійшли до початку поточної фази   // { key, reach, fire } — скидається в renderAll

  // ------------------------------------------------------------- координати
  function toScreen(x, y) { return [(x - view.cx) * view.s + cw / 2, (y - view.cy) * view.s + ch / 2]; }
  function toWorld(sx, sy) { return [(sx - cw / 2) / view.s + view.cx, (sy - ch / 2) / view.s + view.cy]; }
  function hexAtScreen(sx, sy) {
    const [x, y] = toWorld(sx, sy);
    const o = Hex.fromPoint(x, y);
    return Engine.grid(state).idx(o.col, o.row);
  }
  function centerOn(idx) {
    const c = Engine.grid(state).center(idx);
    view.cx = c.x; view.cy = c.y; redraw();
  }
  function clampView() {
    const maxX = 1.5 * (state.map.w - 1), maxY = SQRT3 * (state.map.h - 0.5);
    view.cx = Math.min(maxX, Math.max(0, view.cx));
    view.cy = Math.min(maxY, Math.max(0, view.cy));
  }
  function zoomAt(factor, sx = cw / 2, sy = ch / 2) {
    const [wx, wy] = toWorld(sx, sy);
    view.s = Math.min(70, Math.max(5, view.s * factor));
    const [wx2, wy2] = toWorld(sx, sy);
    view.cx += wx - wx2; view.cy += wy - wy2;
    clampView(); redraw();
  }

  // -------------------------------------------- що бачить поточна фракція
  function visibleEnemies() {
    const f = pf();
    return [...Intel.visibleIds(state, f)].map(id => Engine.unitById(state, id)).filter(u => u && !Politics.allied(state, f, u.faction));
  }
  function visibleAllies() {
    const f = pf();
    return [...Intel.visibleIds(state, f)].map(id => Engine.unitById(state, id)).filter(u => u && Politics.allied(state, f, u.faction));
  }
  function staleMarkers() { return Intel.knownList(state, pf()).filter(m => !m.visible); }
  function knownRecord(id) { return Intel.knownList(state, pf(), { allies: 'all' }).find(m => m.id === id) || null; }

  // ---------------------------------------------------------------- малювання
  function hexPath(x, y, r) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // Додає контур гекса до поточного шляху (без beginPath) — щоб заливати сотні гексів одним fill().
  // Контур замикається лінією до першої вершини, а не closePath(): у Chrome closePath на шляху
  // з тисячами підшляхів працює за квадратичний час.
  function addHex(x, y, r) {
    ctx.moveTo(x + r, y);
    for (let k = 1; k < 6; k++) ctx.lineTo(x + r * HEX_COS[k], y + r * HEX_SIN[k]);
    ctx.lineTo(x + r, y);
  }
  const HEX_COS = [0, 1, 2, 3, 4, 5].map(k => Math.cos(Math.PI / 3 * k));
  const HEX_SIN = [0, 1, 2, 3, 4, 5].map(k => Math.sin(Math.PI / 3 * k));

  // Статичний шар карти (місцевість, контроль, сітка, річки, дороги, назви, постачання)
  // малюється в окремий canvas і перевикористовується, доки не зміниться вигляд
  // (зсув, масштаб, перемикачі) або стан гри (renderAll → invalidateBase).
  // Наведення миші, превʼю маршруту й виділення малюються поверх готового зображення.
  let base = null, baseVersion = 0, lastKey = '';
  const invalidateBase = () => { baseVersion++; };
  let SX = new Float64Array(0), SY = new Float64Array(0);   // екранні координати центрів видимих гексів

  function draw() {
    const g = Engine.grid(state), m = state.map, s = view.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (handover) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mapbg').trim() || '#cfcbbb';
      ctx.fillRect(0, 0, cw, ch);
      return;
    }

    const [wl, wt] = toWorld(0, 0), [wr, wb] = toWorld(cw, ch);
    const c0 = Math.max(0, Math.floor(wl / 1.5) - 1), c1 = Math.min(m.w - 1, Math.ceil(wr / 1.5) + 1);
    const r0 = Math.max(0, Math.floor(wt / SQRT3) - 1), r1 = Math.min(m.h - 1, Math.ceil(wb / SQRT3) + 1);
    const vis = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) vis.push(r * m.w + c);
    const visSet = new Set(vis);

    // Поки вигляд змінюється щокадру (перетягування, колесо), кеш не допоможе — малюємо
    // статичний шар просто на екран. Щойно ключ повторився (вигляд зупинився), один раз
    // малюємо його в кеш і далі лише копіюємо.
    const key = [view.cx, view.cy, s, cw, ch, dpr, view.showControl, view.showGrid, view.showSupply, pf(), baseVersion].join('|');
    if (base && base.key === key) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base.canvas, 0, 0);
    } else if (lastKey !== key) {
      drawBase(g, m, s, vis);
    } else {
      if (!base) { const c = document.createElement('canvas'); base = { canvas: c, ctx: c.getContext('2d'), key: '' }; }
      if (base.canvas.width !== canvas.width || base.canvas.height !== canvas.height) {
        base.canvas.width = canvas.width; base.canvas.height = canvas.height;
      }
      const main = ctx;
      ctx = base.ctx;
      try { drawBase(g, m, s, vis); } finally { ctx = main; }
      base.key = key;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base.canvas, 0, 0);
    }
    lastKey = key;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';   // як лишав статичний шар раніше

    drawFacilities(g, visSet);
    // ніч
    if (Engine.isNight(state.time.hour)) { ctx.fillStyle = 'rgba(15,20,40,0.22)'; ctx.fillRect(0, 0, cw, ch); }

    drawZones(g, visSet);
    if (preview && preview.ok && preview.path) drawPreview(g);
    drawTargets(g);
    drawMarkers(g, visSet);
    drawUnits(g, vis);
    drawCaches(g, visSet);
    drawCivilians(g, visSet);
    if (preview && preview.ok && preview.hex != null && !preview.path) drawFireLine(g);
    if (hoverHex >= 0) { const cc = g.center(hoverHex); const [x, y] = toScreen(cc.x, cc.y); hexPath(x, y, s - 1); ctx.strokeStyle = 'rgba(20,20,15,0.6)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (selectedHex >= 0) { const cc = g.center(selectedHex); const [x, y] = toScreen(cc.x, cc.y); hexPath(x, y, s - 1.5); ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.stroke(); }
  }

  function drawBase(g, m, s, vis) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mapbg').trim() || '#cfcbbb';
    ctx.fillRect(0, 0, cw, ch);

    if (SX.length !== g.size) { SX = new Float64Array(g.size); SY = new Float64Array(g.size); }
    for (const i of vis) { const cc = g.center(i); const [x, y] = toScreen(cc.x, cc.y); SX[i] = x; SY[i] = y; }

    // місцевість — один fill() на тип замість одного на гекс
    const byTerrain = CONFIG.terrain.map(() => []);
    for (const i of vis) byTerrain[m.terrain[i]].push(i);
    byTerrain.forEach((list, t) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const i of list) addHex(SX[i], SY[i], s + 0.5);
      ctx.fillStyle = CONFIG.terrain[t].color; ctx.fill();
    });
    if (s >= 13) for (const i of vis) drawTerrainMarks(i, SX[i], SY[i], s);
    if (m.shelter && s >= 9) {
      ctx.strokeStyle = '#3b2f22'; ctx.lineWidth = Math.max(1.2, s * 0.07);
      for (const i of vis) {
        if (!m.shelter[i]) continue;
        const x = SX[i], y = SY[i];
        for (let k = 0; k < m.shelter[i]; k++) { ctx.beginPath(); ctx.moveTo(x - s * 0.55, y + s * (0.55 - k * 0.14)); for (let z = 0; z < 6; z++) ctx.lineTo(x - s * 0.55 + (z + 1) * s * 0.18, y + s * (0.55 - k * 0.14) + (z % 2 ? 0 : -s * 0.1)); ctx.stroke(); }
      }
    }
    if (view.showControl) {
      ctx.globalAlpha = 0.15;
      for (let f = 0; f < MAPFC.length; f++) {
        ctx.beginPath();
        let any = false;
        for (const i of vis) if (m.control[i] === f) { addHex(SX[i], SY[i], s); any = true; }
        if (any) { ctx.fillStyle = MAPFC[f]; ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    if (view.showGrid && s >= 9) {
      // уся сітка — один шлях і одна обводка замість окремої на кожен гекс
      ctx.strokeStyle = 'rgba(40,40,30,0.16)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const i of vis) addHex(SX[i], SY[i], s);
      ctx.stroke();
    }
    if (view.showControl) {
      ctx.lineWidth = Math.max(1.5, s * 0.1); ctx.strokeStyle = 'rgba(35,30,25,0.75)'; ctx.setLineDash([s * 0.3, s * 0.18]);
      ctx.beginPath();
      for (const i of vis) {
        const a = m.control[i]; if (a < 0) continue;
        const x = SX[i], y = SY[i];
        for (let d = 0; d < 3; d++) {
          const n = g.neighbor(i, d); if (n < 0) continue;
          const b = m.control[n]; if (b < 0 || b === a) continue;
          const ang = Hex.DIR_ANGLE[d] * Math.PI / 180;
          const a1 = ang - Math.PI / 6, a2 = ang + Math.PI / 6;
          ctx.moveTo(x + s * Math.cos(a1), y + s * Math.sin(a1));
          ctx.lineTo(x + s * Math.cos(a2), y + s * Math.sin(a2));
        }
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // річки
    ctx.strokeStyle = '#4f7f9c'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2, s * 0.22);
    ctx.beginPath();
    for (const i of vis) {
      if (!m.river[i]) continue;
      const x = SX[i], y = SY[i];
      let links = 0;
      for (let d = 0; d < 6; d++) {
        const n = g.neighbor(i, d); if (n < 0) continue;
        if (m.river[n] || (m.terrain[n] === TERRAIN_ID.sea && links < 1)) {
          const ang = Hex.DIR_ANGLE[d] * Math.PI / 180;
          ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * s * 0.87, y + Math.sin(ang) * s * 0.87); links++;
        }
      }
    }
    ctx.stroke();
    // дороги
    for (const level of [1, 2]) {
      ctx.beginPath();
      for (const i of vis) {
        if (m.road[i] < level || !m.roadDirs[i]) continue;
        const x = SX[i], y = SY[i];
        for (let d = 0; d < 6; d++) {
          if (!(m.roadDirs[i] & (1 << d))) continue;
          const n = g.neighbor(i, d);
          if (n < 0) continue;
          if (Math.min(m.road[i], m.road[n]) !== level) continue;
          const ang = Hex.DIR_ANGLE[d] * Math.PI / 180;
          ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * s * 0.87, y + Math.sin(ang) * s * 0.87);
        }
      }
      if (level === 2) {
        ctx.lineWidth = Math.max(2.5, s * 0.24); ctx.strokeStyle = '#3e332c'; ctx.setLineDash([]); ctx.stroke();
        ctx.lineWidth = Math.max(1, s * 0.1); ctx.strokeStyle = '#d9b36a'; ctx.stroke();
      } else {
        ctx.lineWidth = Math.max(1.2, s * 0.1); ctx.strokeStyle = '#7a5a3a'; ctx.setLineDash([s * 0.25, s * 0.15]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.strokeStyle = '#1d1d1a'; ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.beginPath();
    for (const i of vis) {
      if (!m.bridge[i]) continue;
      const x = SX[i], y = SY[i];
      const w = s * 0.42;
      ctx.moveTo(x - w, y - w * 0.55); ctx.lineTo(x + w, y - w * 0.55);
      ctx.moveTo(x - w, y + w * 0.55); ctx.lineTo(x + w, y + w * 0.55);
    }
    ctx.stroke();
    if (s >= 7) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const st of m.settlements) {
        const cc = g.center(st.center); const [x, y] = toScreen(cc.x, cc.y - (st.kind === 'city' ? 4.3 : 1.8));
        if (x < -100 || x > cw + 100 || y < -40 || y > ch + 40) continue;
        const fs = st.kind === 'city' ? Math.max(12, s * 0.75) : Math.max(10, s * 0.55);
        ctx.font = `${st.kind === 'city' ? 700 : 600} ${fs}px 'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif`;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(245,240,225,0.9)'; ctx.strokeText(st.name.toUpperCase(), x, y);
        ctx.fillStyle = '#25231e'; ctx.fillText(st.name.toUpperCase(), x, y);
      }
    }
    if (s >= 6 && m.borderEntry) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      m.borderEntry.forEach((idx, fct) => {
        if (idx == null || idx < 0) return;
        const cc = g.center(idx); const [x, y] = toScreen(cc.x, cc.y);
        if (x < -40 || x > cw + 40 || y < -40 || y > ch + 40) return;
        const r = Math.max(6, s * 0.5);
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.6); ctx.lineTo(x - r, y + r * 0.6); ctx.closePath();
        ctx.fillStyle = m.control[idx] === fct ? MAPFC[fct] : 'rgba(120,30,30,0.9)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#1d1b17'; ctx.stroke();
        if (s >= 10) { ctx.font = `700 ${Math.max(8, s * 0.42)}px 'IBM Plex Mono', monospace`; ctx.fillStyle = '#1d1b17'; ctx.fillText(ABBR[fct], x, y + r * 1.6); }
      });
    }
    if (view.showSupply) {
      const net = Logistics.network(state, pf());
      ctx.fillStyle = 'rgba(70,110,40,0.26)';
      ctx.beginPath();
      for (const i of vis) if (net.dist[i] >= 0) addHex(SX[i], SY[i], s);
      ctx.fill();
      ctx.strokeStyle = '#3f6a1f'; ctx.lineWidth = Math.max(2, s * 0.12); ctx.setLineDash([s * 0.2, s * 0.12]); ctx.beginPath();
      for (const i of vis) {
        if (net.dist[i] < 0) continue;
        const x = SX[i], y = SY[i];
        for (let d = 0; d < 6; d++) {
          const n = g.neighbor(i, d);
          if (n >= 0 && net.dist[n] >= 0) continue;
          const ang = Hex.DIR_ANGLE[d] * Math.PI / 180;
          ctx.moveTo(x + s * Math.cos(ang - Math.PI / 6), y + s * Math.sin(ang - Math.PI / 6));
          ctx.lineTo(x + s * Math.cos(ang + Math.PI / 6), y + s * Math.sin(ang + Math.PI / 6));
        }
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function drawTerrainMarks(i, x, y, s) {
    const t = CONFIG.terrain[state.map.terrain[i]].key;
    const h = (k) => hash2(i, k, 7);
    ctx.save();
    switch (t) {
      case 'forest': case 'denseForest': {
        const n = t === 'forest' ? 3 : 6;
        ctx.fillStyle = t === 'forest' ? '#6f845f' : '#4f6a4a';
        for (let k = 0; k < n; k++) {
          const px = x + (h(k) - 0.5) * s * 1.1, py = y + (h(k + 9) - 0.5) * s * 1.0;
          ctx.beginPath(); ctx.arc(px, py, s * 0.13, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'mountains': {
        ctx.strokeStyle = '#7d6a50'; ctx.lineWidth = Math.max(1, s * 0.07);
        ctx.beginPath();
        for (let k = 0; k < 2; k++) {
          const px = x + (k ? 0.3 : -0.3) * s, py = y + (k ? 0.15 : -0.05) * s, w = s * 0.32;
          ctx.moveTo(px - w, py + w * 0.6); ctx.lineTo(px, py - w * 0.6); ctx.lineTo(px + w, py + w * 0.6);
        }
        ctx.stroke(); break;
      }
      case 'swamp': {
        ctx.strokeStyle = '#5f7f78'; ctx.lineWidth = Math.max(1, s * 0.06); ctx.beginPath();
        for (let k = -1; k <= 1; k++) { ctx.moveTo(x - s * 0.4, y + k * s * 0.3); ctx.lineTo(x + s * 0.4, y + k * s * 0.3); }
        ctx.stroke(); break;
      }
      case 'farmland': {
        ctx.strokeStyle = 'rgba(150,130,70,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = -2; k <= 2; k++) { ctx.moveTo(x - s * 0.6 + k * s * 0.25, y + s * 0.5); ctx.lineTo(x - s * 0.1 + k * s * 0.25, y - s * 0.5); }
        ctx.stroke(); break;
      }
      case 'city': case 'village': case 'industrial': {
        ctx.fillStyle = t === 'industrial' ? '#6f6a64' : t === 'city' ? '#7c6b5d' : '#8c7558';
        const n = t === 'village' ? 3 : 5;
        for (let k = 0; k < n; k++) {
          const px = x + (h(k) - 0.5) * s * 1.0, py = y + (h(k + 5) - 0.5) * s * 0.9;
          const w = s * (t === 'industrial' ? 0.32 : 0.2);
          ctx.fillRect(px - w / 2, py - w / 2, w, w * (t === 'industrial' ? 0.6 : 1));
        }
        break;
      }
    }
    ctx.restore();
  }

  function drawPreview(g) {
    const s = view.s;
    const u = Engine.unitById(state, preview.unitId);
    const pts = [u.idx].concat(preview.path).map(i => { const c = g.center(i); return toScreen(c.x, c.y); });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const col = preview.kind === 'retreat' ? '#7a3a14' : '#111';
    for (let k = 1; k < pts.length; k++) {
      const hour = preview.hourOf[k - 1];
      const now = hour === 0 && !preview.pending;
      ctx.strokeStyle = now ? col : 'rgba(17,17,17,0.45)';
      ctx.lineWidth = Math.max(2.5, s * 0.16);
      ctx.setLineDash(now ? [] : [s * 0.25, s * 0.2]);
      ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.max(10, s * 0.45)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k < preview.hourOf.length; k++) {
      const last = k === preview.hourOf.length - 1;
      if (last || preview.hourOf[k + 1] !== preview.hourOf[k]) {
        const [x, y] = pts[k + 1];
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, Math.max(7, s * 0.34), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f2efe4'; ctx.fillText(String(preview.hourOf[k] + 1 + preview.startHourOffset), x, y + 0.5);
      }
    }
  }

  function drawFireLine(g) {
    const u = Engine.unitById(state, preview.unitId);
    if (!u) return;
    const a = g.center(u.idx), b = g.center(preview.hex);
    const [x1, y1] = toScreen(a.x, a.y), [x2, y2] = toScreen(b.x, b.y);
    ctx.strokeStyle = '#b3261e'; ctx.lineWidth = Math.max(2, view.s * 0.12);
    ctx.setLineDash(preview.indirect ? [view.s * 0.3, view.s * 0.2] : []);
    ctx.beginPath(); ctx.moveTo(x1, y1);
    if (preview.indirect) ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - Math.hypot(x2 - x1, y2 - y1) * 0.3, x2, y2);
    else ctx.lineTo(x2, y2);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x2, y2, view.s * 0.7, 0, Math.PI * 2); ctx.stroke();
  }

  // Зони вибраного підрозділу: досяжність руху (ця година / повна година) і зона ураження
  function zonesFor(u) {
    const key = `${u.id}|${u.idx}|${u.mp}|${state.time.turn}|${state.phase}`;
    if (zoneCache && zoneCache.key === key) return zoneCache;
    const own = u.faction === pf() && Engine.phaseFaction(state) === pf();
    zoneCache = { key, reach: own ? Engine.reachable(state, u) : null, fire: Combat.fireZone(state, u) };
    return zoneCache;
  }
  function edgePath(g, set, visSet) {
    const s = view.s;
    ctx.beginPath();
    for (const i of set) {
      if (!visSet.has(i)) continue;
      const cc = g.center(i); const [x, y] = toScreen(cc.x, cc.y);
      for (let d = 0; d < 6; d++) {
        const n = g.neighbor(i, d);
        if (n >= 0 && set.has(n)) continue;
        const ang = Hex.DIR_ANGLE[d] * Math.PI / 180;
        ctx.moveTo(x + s * Math.cos(ang - Math.PI / 6), y + s * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(x + s * Math.cos(ang + Math.PI / 6), y + s * Math.sin(ang + Math.PI / 6));
      }
    }
  }
  // Рядки картки: зони руху й вогню (ті самі, що на карті)
  function zoneRows(u) {
    const z = zonesFor(u);
    const out = [];
    if (z.reach) {
      const r = z.reach;
      out.push(`<dt>Рух зараз</dt><dd>${r.reason ? esc(r.reason) : r.pending ? 'цієї години вже діяв — далі з наступної' : `${r.now.size} гекс. досяжно цієї години`}${r.fuelLimited ? ' · обмежує пальне' : ''}</dd>`);
    }
    const f = z.fire;
    if (f.rangeM > 0) {
      out.push(`<dt>${f.indirect ? 'Навісний вогонь' : 'Прямий вогонь'}</dt><dd>до ${Math.round(f.rangeM)} м (${f.rangeHex} гекс.)${f.indirect ? ' · можна бити по площі' : ` · з видимістю ${f.hexes.size} гекс.`}</dd>`);
    }
    if (f.deployRangeM > f.rangeM) out.push(`<dt>Після розгортання</dt><dd>до ${Math.round(f.deployRangeM)} м (${f.deployRangeHex} гекс.)</dd>`);
    return out.join('');
  }
  function drawZones(g, visSet) {
    if (!view.showZones || selectedId == null || handover) return;
    const u = Engine.unitById(state, selectedId);
    if (!u || u.faction !== pf() || (preview && preview.ok && preview.path)) return;
    const z = zonesFor(u);
    const s = view.s;
    const showMove = mode !== 'attack', showFire = mode !== 'move' && mode !== 'retreat';
    // рух
    if (showMove && z.reach) {
      const now = new Set(z.reach.now.keys()), full = new Set([...z.reach.now.keys(), ...z.reach.next.keys()]);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (const i of now) { if (!visSet.has(i)) continue; const cc = g.center(i); const [x, y] = toScreen(cc.x, cc.y); hexPath(x, y, s); ctx.fill(); }
      if (z.reach.next.size) {
        full.add(u.idx);
        edgePath(g, full, visSet);
        ctx.strokeStyle = 'rgba(25,25,20,0.55)'; ctx.lineWidth = Math.max(1.2, s * 0.07); ctx.setLineDash([s * 0.22, s * 0.16]); ctx.stroke(); ctx.setLineDash([]);
      }
      if (now.size) {
        now.add(u.idx);
        edgePath(g, now, visSet);
        ctx.strokeStyle = 'rgba(15,15,12,0.9)'; ctx.lineWidth = Math.max(1.8, s * 0.1); ctx.stroke();
      }
    }
    // вогонь
    if (showFire && z.fire && z.fire.hexes.size) {
      const f = z.fire;
      if (!f.indirect) {
        ctx.fillStyle = 'rgba(179,38,30,0.13)';
        for (const i of f.hexes) { if (!visSet.has(i)) continue; const cc = g.center(i); const [x, y] = toScreen(cc.x, cc.y); hexPath(x, y, s); ctx.fill(); }
      }
      const ring = new Set(f.hexes); for (const i of f.noLos) ring.add(i); ring.add(u.idx);
      edgePath(g, ring, visSet);
      ctx.strokeStyle = '#b3261e'; ctx.lineWidth = Math.max(1.6, s * 0.09);
      ctx.setLineDash(f.indirect ? [s * 0.35, s * 0.2] : []); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // Ворожі цілі, доступні вибраному підрозділу в режимі атаки
  function drawTargets(g) {
    if (mode !== 'attack') return;
    const u = Engine.unitById(state, selectedId);
    if (!u) return;
    const indirect = Combat.hasIndirect(u);
    const rangeHex = Math.floor(Combat.maxRange(u, indirect) / CONFIG.hexMeters);
    const targets = new Set();
    for (const e of visibleEnemies()) if (g.dist(u.idx, e.idx) <= rangeHex) targets.add(e.idx);
    if (indirect) for (const mk of staleMarkers()) if (g.dist(u.idx, mk.idx) <= rangeHex) targets.add(mk.idx);
    ctx.strokeStyle = '#b3261e'; ctx.lineWidth = Math.max(2, view.s * 0.1);
    for (const i of targets) {
      const cc = g.center(i); const [x, y] = toScreen(cc.x, cc.y);
      hexPath(x, y, view.s * 0.92); ctx.stroke();
    }
  }

  // Склади, шпиталі, підприємства (відомі поточній фракції)
  function drawFacilities(g, visSet) {
    const s = view.s;
    if (s < 7) return;
    const f = pf();
    // злітна смуга аеропорту
    for (const fa of Logistics.known(state, f)) {
      if (!fa.runway || fa.runway.length < 2) continue;
      const pts = fa.runway.map(i => { const c = g.center(i); return toScreen(c.x, c.y); });
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#4a4a46'; ctx.lineWidth = Math.max(5, s * 0.5);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.strokeStyle = '#f2efe6'; ctx.lineWidth = Math.max(1, s * 0.05); ctx.setLineDash([s * 0.25, s * 0.2]);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.setLineDash([]); ctx.lineCap = 'round';
    }
    // зона спостереження БПЛА (своя), і превʼю району при виборі вильоту
    const droneRing = (idx, r, dashed) => {
      const c = g.center(idx); const [x, y] = toScreen(c.x, c.y);
      ctx.strokeStyle = 'rgba(40,70,120,0.85)'; ctx.lineWidth = 2; ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.beginPath(); ctx.arc(x, y, r * s * SQRT3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(40,70,120,0.08)'; ctx.fill();
    };
    for (const so of Air.activeSorties(state, f)) droneRing(so.idx, so.radius, false);
    if (mode === 'uav' && hoverHex >= 0) droneRing(hoverHex, CONFIG.air.uav.radius, true);
    for (const fa of Logistics.known(state, f)) {
      if (!visSet.has(fa.idx)) continue;
      const seen = fa.owner === f ? { owner: fa.owner, destroyed: fa.destroyed } : (fa.seen[f] || { owner: fa.owner, destroyed: fa.destroyed });
      const cc = g.center(fa.idx); const [x, y] = toScreen(cc.x, cc.y);
      const w = Math.max(14, s * 1.0), h = Math.max(9, s * 0.48);
      const bx = x - w / 2, by = y - s * 0.93;
      ctx.fillStyle = '#f4efe2'; ctx.fillRect(bx, by, w, h);
      ctx.lineWidth = 2; ctx.strokeStyle = MAPFC[seen.owner] || '#333'; ctx.strokeRect(bx, by, w, h);
      ctx.fillStyle = '#1d1b17'; ctx.font = `700 ${Math.max(7, h * 0.62)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(CONFIG.facilities[fa.type].short, x, by + h / 2 + 0.5);
      if (seen.destroyed || fa.condition <= 0) { ctx.strokeStyle = '#b3261e'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + w, by + h); ctx.moveTo(bx + w, by); ctx.lineTo(bx, by + h); ctx.stroke(); }
    }
  }

  // Цивільні колони (біженці / евакуація під коридором): сіра плашка з кількістю авто,
  // зелена рамка — під захистом гуманітарного коридору
  function drawCivilians(g, visSet) {
    const s = view.s;
    if (s < 6) return;
    const f = pf();
    for (const c of Civil.columns(state)) {
      if (!visSet.has(c.idx) || !Civil.visibleTo(state, f, c)) continue;
      const cc = g.center(c.idx); const [x, y] = toScreen(cc.x, cc.y);
      const w = Math.max(24, s * 1.5), h = Math.max(11, s * 0.6);
      const bx = x - w / 2, by = y + s * 0.38;
      ctx.fillStyle = '#ece9df'; ctx.fillRect(bx, by, w, h);
      ctx.lineWidth = c.corridor ? 2.5 : 1.2; ctx.strokeStyle = c.corridor ? '#2f8a3a' : '#4a4a44'; ctx.strokeRect(bx, by, w, h);
      // «машинки»
      const n = Math.min(3, Civil.cars(c));
      for (let k = 0; k < n; k++) { const cx = bx + 3 + k * (h * 0.9); ctx.fillStyle = '#5b5b55'; ctx.fillRect(cx, by + h * 0.3, h * 0.7, h * 0.4); }
      ctx.fillStyle = '#1d1b17'; ctx.font = `600 ${Math.max(7, h * 0.7)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(String(c.people), bx + w - 3, by + h / 2 + 0.5);
    }
  }

  // Місця боїв: «200» і трофеї (лише відомі поточній фракції)
  function drawCaches(g, visSet) {
    const s = view.s;
    if (s < 9) return;
    for (const k of Loot.known(state, pf())) {
      const c = k.c; if (!visSet.has(c.idx)) continue;
      const info = k.now ? { dead: c.dead, weapons: Loot.count(c.weapons) + Loot.count(c.ammo), wrecks: (c.vehicles || []).length } : { dead: k.seen.dead, weapons: k.seen.weapons + k.seen.ammo, wrecks: k.seen.wrecks };
      const dead = info.dead.reduce((a, b) => a + b, 0);
      if (!dead && !info.weapons && !info.wrecks) continue;
      const cc = g.center(c.idx); const [x, y] = toScreen(cc.x, cc.y);
      const bx = x - s * 0.62, by = y + s * 0.44;
      const label = (dead ? `200×${dead}` : '') + (info.wrecks ? (dead ? ' ' : '') + '▲' : '');
      ctx.font = `700 ${Math.max(8, s * 0.32)}px 'IBM Plex Mono', monospace`;
      const tw = Math.max(ctx.measureText(label || '•').width + 6, s * 0.4);
      ctx.globalAlpha = k.now ? 1 : 0.6;
      ctx.fillStyle = '#2a1a16'; ctx.fillRect(bx, by, tw, Math.max(10, s * 0.42));
      ctx.fillStyle = '#f3e6d8'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label || '•', bx + 3, by + Math.max(10, s * 0.42) / 2 + 0.5);
      if (info.weapons) { ctx.fillStyle = '#e0b84a'; ctx.beginPath(); ctx.arc(bx + tw + s * 0.14, by + s * 0.21, Math.max(3, s * 0.14), 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#2a1a16'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }

  function drawMarkers(g, visSet) {
    const s = view.s;
    if (s < 8) return;
    const byHex = new Map();
    for (const mk of staleMarkers()) {
      if (!visSet.has(mk.idx)) continue;
      if (!byHex.has(mk.idx)) byHex.set(mk.idx, []);
      byHex.get(mk.idx).push(mk);
    }
    for (const [idx, list] of byHex) {
      const mk = list[0];
      const cc = g.center(idx); const [x, y] = toScreen(cc.x, cc.y);
      const w = Math.max(10, s * 1.15), h = Math.max(7, s * 0.78);
      ctx.globalAlpha = Math.max(0.35, mk.confidence / 100);
      ctx.fillStyle = 'rgba(240,236,224,0.85)';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.setLineDash([3, 2]); ctx.lineWidth = 1.5; ctx.strokeStyle = MAPFC[mk.faction];
      ctx.strokeRect(x - w / 2, y - h / 2, w, h); ctx.setLineDash([]);
      ctx.fillStyle = MAPFC[mk.faction];
      ctx.font = `700 ${Math.max(9, s * 0.42)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`?${mk.age}г`, x, y + 0.5);
      ctx.globalAlpha = 1;
      if (selectedEnemy != null && list.some(m => m.id === selectedEnemy)) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; ctx.strokeRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4); }
    }
  }

  function drawUnits(g, vis) {
    const s = view.s;
    const f = pf();
    const shown = state.units.filter(u => u.faction === f && u.embarked == null).concat(visibleAllies(), visibleEnemies());
    const occ = new Map();
    for (const u of shown) { if (!occ.has(u.idx)) occ.set(u.idx, []); occ.get(u.idx).push(u); }
    const visSet = new Set(vis);
    for (const [idx, list] of occ) {
      if (!visSet.has(idx)) continue;
      const cc = g.center(idx); const [x, y] = toScreen(cc.x, cc.y);
      const top = list.find(u => u.id === selectedId || u.id === selectedEnemy) || list.find(u => u.faction === f) || list[0];
      const w = Math.max(10, s * 1.15), h = Math.max(7, s * 0.78);
      if (s < 8) { ctx.fillStyle = MAPFC[top.faction]; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); continue; }
      if (list.length > 1) { ctx.fillStyle = 'rgba(20,20,15,0.55)'; ctx.fillRect(x - w / 2 + 3, y - h / 2 - 3, w, h); }
      const enemy = top.faction !== f;
      const rec = enemy ? knownRecord(top.id) : null;
      drawCounter(top, x - w / 2, y - h / 2, w, h, top.id === selectedId || top.id === selectedEnemy, !enemy, rec);
      if (enemy && Politics.allied(state, f, top.faction)) {
        // позначка союзника: біла пунктирна рамка та «С»
        ctx.setLineDash([3, 2]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4); ctx.setLineDash([]);
        if (s >= 12) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x - w / 2, y - h / 2, Math.max(5, s * 0.24), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#141414'; ctx.font = `700 ${Math.max(7, s * 0.3)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('С', x - w / 2, y - h / 2 + 0.5); }
      }
      if (list.length > 1) {
        const bx = x + w / 2, by = y - h / 2;
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(bx, by, Math.max(6, s * 0.3), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(9, s * 0.38)}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(list.length, bx, by + 0.5);
      }
    }
  }

  // rec — розвіддані про ворожий підрозділ (тип може бути невідомим)
  function drawCounter(u, x, y, w, h, selected, own, rec) {
    const col = MAPFC[u.faction];
    ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
    ctx.lineWidth = selected ? 3 : own ? 1.6 : 1;
    ctx.strokeStyle = selected ? '#ffd23f' : '#141414';
    ctx.strokeRect(x, y, w, h);
    const known = own || (rec && rec.type);
    const sym = known ? CONFIG.unitTypes[u.type].symbol : (rec && rec.cls === 'vehicle' ? 'unknownVeh' : 'unknown');
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(1, w * 0.06);
    const ix = x + w * 0.18, iy = y + h * 0.18, iw = w * 0.64, ih = h * 0.64;
    ctx.beginPath();
    switch (sym) {
      case 'inf': case 'crew': ctx.moveTo(ix, iy); ctx.lineTo(ix + iw, iy + ih); ctx.moveTo(ix + iw, iy); ctx.lineTo(ix, iy + ih); ctx.stroke(); break;
      case 'mg': ctx.moveTo(ix, iy); ctx.lineTo(ix + iw, iy + ih); ctx.moveTo(ix + iw, iy); ctx.lineTo(ix, iy + ih); ctx.stroke();
        ctx.beginPath(); ctx.arc(ix + iw / 2, iy + ih / 2, ih * 0.22, 0, Math.PI * 2); ctx.fill(); break;
      case 'at': ctx.moveTo(ix, iy + ih); ctx.lineTo(ix + iw / 2, iy); ctx.lineTo(ix + iw, iy + ih); ctx.stroke(); break;
      case 'recon': ctx.moveTo(ix, iy + ih); ctx.lineTo(ix + iw, iy); ctx.stroke(); break;
      case 'mortar': ctx.arc(ix + iw / 2, iy + ih * 0.75, ih * 0.2, 0, Math.PI * 2); ctx.moveTo(ix + iw / 2, iy + ih * 0.55); ctx.lineTo(ix + iw / 2, iy); ctx.moveTo(ix + iw / 2 - ih * 0.2, iy + ih * 0.2); ctx.lineTo(ix + iw / 2, iy); ctx.lineTo(ix + iw / 2 + ih * 0.2, iy + ih * 0.2); ctx.stroke(); break;
      case 'med': ctx.moveTo(ix + iw / 2, iy); ctx.lineTo(ix + iw / 2, iy + ih); ctx.moveTo(ix + iw * 0.2, iy + ih / 2); ctx.lineTo(ix + iw * 0.8, iy + ih / 2); ctx.lineWidth = Math.max(1.5, w * 0.1); ctx.stroke(); break;
      case 'tracked': {
        const rx = ix + iw * 0.05, rw = iw * 0.9, ry = iy + ih * 0.2, rh = ih * 0.6, rr = rh / 2;
        ctx.moveTo(rx + rr, ry); ctx.lineTo(rx + rw - rr, ry); ctx.arc(rx + rw - rr, ry + rr, rr, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(rx + rr, ry + rh); ctx.arc(rx + rr, ry + rr, rr, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); break;
      }
      case 'wheeled':
        ctx.moveTo(ix, iy + ih * 0.35); ctx.lineTo(ix + iw, iy + ih * 0.35); ctx.stroke();
        ctx.beginPath(); ctx.arc(ix + iw * 0.25, iy + ih * 0.75, ih * 0.16, 0, Math.PI * 2); ctx.arc(ix + iw * 0.75, iy + ih * 0.75, ih * 0.16, 0, Math.PI * 2); ctx.fill(); break;
      case 'eng': case 'ags': case 'hmg': case 'sup': case 'arty': case 'ew':
        ctx.font = `700 ${Math.max(7, h * 0.48)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(sym === 'eng' ? 'ІНЖ' : sym === 'ags' ? 'АГС' : sym === 'sup' ? 'БК' : sym === 'arty' ? 'Д-30' : sym === 'ew' ? 'РЕР' : '12,7', x + w / 2, y + h / 2 + 0.5);
        if (u.deployed && sym !== 'eng' && sym !== 'sup' && sym !== 'ew') { ctx.fillRect(x + w * 0.2, y + h * 0.82, w * 0.6, Math.max(1, h * 0.06)); }
        break;
      case 'unknown': case 'unknownVeh':
        ctx.font = `700 ${Math.max(9, h * 0.75)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(sym === 'unknownVeh' ? '?▭' : '?', x + w / 2, y + h / 2 + 0.5); break;
    }
    if (u.mount && view.s >= 14) {
      ctx.fillStyle = '#141414'; ctx.font = `700 ${Math.max(7, view.s * 0.28)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(u.mount === 'АГС-17' ? 'АГС' : u.mount === 'НСВ «Утьос»' ? '12,7' : 'ПКМ', x + w / 2, y + h + 2);
    }
    if (own) {
      const size = CONFIG.unitTypes[u.type].size;
      if (size && view.s >= 16) {
        ctx.fillStyle = '#141414'; ctx.font = `700 ${Math.max(8, view.s * 0.32)}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(size, x + w / 2, y - 1);
      }
      // смужка моралі
      ctx.fillStyle = u.morale >= 60 ? '#5f8f3a' : u.morale >= 40 ? '#d1a237' : '#c0392b';
      ctx.fillRect(x, y + h, w * u.morale / 100, Math.max(2, h * 0.12));
      if (u.order || u.pendingOrder || u.stance !== 'none') {
        ctx.fillStyle = u.order && u.order.status !== 'active' ? '#e0766a' : u.stance === 'defend' ? '#9fd27a' : u.stance === 'observe' ? '#8fc6ff' : '#ffd23f';
        ctx.beginPath(); ctx.moveTo(x + w, y + h); ctx.lineTo(x + w - h * 0.45, y + h); ctx.lineTo(x + w, y + h - h * 0.45); ctx.fill();
      }
      if (u.carrying && u.carrying.length && view.s >= 10) {
        const n = Transport.load(state, u);
        const bw = Math.max(14, view.s * 0.8), bh = Math.max(9, view.s * 0.42);
        ctx.fillStyle = '#141414'; ctx.fillRect(x - 2, y - bh + 1, bw, bh);
        ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(8, bh * 0.8)}px 'IBM Plex Mono', monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('+' + n, x, y - bh / 2 + 1.5);
      }
      if (u.fort > 0 && view.s >= 14) {
        ctx.strokeStyle = '#141414'; ctx.lineWidth = 1.5;
        for (let k = 0; k < u.fort; k++) { ctx.beginPath(); ctx.arc(x + w / 2, y + h + 2, w * 0.55 + k * 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
      }
    }
  }

  // ------------------------------------------------------------------ панелі
  function renderAll() {
    if (!state) return;
    zoneCache = null;
    invalidateBase();
    if (!handover) Logistics.refreshSupply(state, pf());
    renderHandover(); renderTop(); renderBotbar(); renderLeft(); renderRight(); renderLog(); renderHexInfo(); renderHint(); redraw();
    window.__state = state;
  }

  function alertsHtml(f) {
    const list = newAlerts(f);
    if (!list.length) return '';
    const g = Engine.grid(state);
    const fire = list.filter(e => /^(ПІД ВОГНЕМ|ОБСТРІЛЯНО)/.test(e.text)).length;
    const sup = list.filter(e => /^ПІДТРИМКА/.test(e.text)).length;
    const lost = list.filter(e => /^ВТРАЧЕНО/.test(e.text)).length;
    const head = [fire ? `під вогнем: ${fire}` : '', sup ? `падіння підтримки: ${sup}` : '', lost ? `втрачено пунктів: ${lost}` : ''].filter(Boolean).join(' · ') || `подій: ${list.length}`;
    const shown = list.slice(-12).reverse();
    return `<div class="ho-alerts"><h3>Поки вас не було — ${esc(head)}</h3>
      ${shown.map(e => `<button type="button" data-halert="${e.id}"><span class="t">Д${e.day} ${String(e.hour).padStart(2, '0')}:00${e.at != null ? ' · ' + g.label(e.at) : ''}</span>${esc(e.text)}</button>`).join('')}
      ${list.length > shown.length ? `<p class="notice">і ще ${list.length - shown.length} — див. журнал, фільтр «лише тривоги».</p>` : ''}
    </div>`;
  }

  function renderHandover() {
    const el = $('handover');
    if (!handover) { el.hidden = true; return; }
    const f = Engine.phaseFaction(state);
    el.hidden = false;
    // хід бота в грі кількох людей — карту приховано, бот ходить сам
    if (AI.isBot(state, f) && !(state.campaign && state.campaign.over)) {
      el.innerHTML = `<div class="ho-card" style="border-top-color:${FC[f]}">
        <div class="ho-time">${esc(Engine.timeLabel(state.time))}${Engine.isNight(state.time.hour) ? ' · ніч' : ''}</div>
        <h2>${esc(CONFIG.factions[f].name)}</h2>
        <p>Ходить ${esc(AI.CONTROLLER_NAMES[AI.controller(state, f)].toLowerCase())}…</p>
      </div>`;
      return;
    }
    const solo = playMode() === 'solo' || playMode() === 'online';
    el.innerHTML = `<div class="ho-card" style="border-top-color:${FC[f]}">
      <div class="ho-time">${esc(Engine.timeLabel(state.time))}${Engine.isNight(state.time.hour) ? ' · ніч' : ''} · фаза ${f + 1} з 3</div>
      <h2>${solo ? 'Ваш хід' : esc(CONFIG.factions[f].name)}</h2>
      <p>${solo ? `${esc(CONFIG.factions[f].name)}. Боти зробили свої ходи — нижче те, що ви помітили за цей час.` : 'Передайте керування гравцю цієї фракції. Карта прихована, щоб інші сторони не бачили його розвідданих.'}</p>
      ${Politics.incoming(state, f).length ? `<p><b>Дипломатичні пропозиції: ${Politics.incoming(state, f).length}</b> — див. «Політика».</p>` : ''}
      ${state.campaign && state.campaign.over ? `<p><b>Кампанію завершено.</b> ${esc(state.campaign.reason)}</p>` : ''}
      ${alertsHtml(f)}
      <button type="button" class="primary" id="btnBeginPhase">${solo ? 'До справ' : 'Розпочати фазу'}</button>
    </div>`;
    const begin = () => {
      const fresh = newAlerts(f);
      phaseAlertIds = new Set(fresh.map(e => e.id));
      if (!state.alertSeen) state.alertSeen = [0, 0, 0];
      state.alertSeen[f] = state.nextLogId - 1;
      handover = false; focusFaction(); renderAll();
      if (state.campaign && state.campaign.over) openChronicle();
    };
    $('btnBeginPhase').onclick = begin;
    el.querySelectorAll('[data-halert]').forEach(b => b.onclick = () => { begin(); jumpToLog(Number(b.dataset.halert)); });
    setTimeout(() => { const b = $('btnBeginPhase'); if (b) b.focus(); }, 0);
  }

  function renderTop() {
    $('clock').textContent = Engine.timeLabel(state.time) + (Engine.isNight(state.time.hour) ? ' · ніч' : '') + ` · хід ${state.time.turn}`;
    const p = state.phase;
    const porder = state.phaseOrder || [0, 1, 2];
    $('phases').innerHTML = [0, 1, 2, 3].map(i => {
      const f = i < 3 ? porder[i] : null;
      const active = i === p;
      const bg = active ? (f != null ? FC[f] : 'var(--fg)') : 'transparent';
      const name = f != null ? Engine.PHASE_NAMES[f] : Engine.PHASE_NAMES[3];
      const abbr = f != null ? ABBR[f] : 'Кінець год.';
      return `<span title="${esc(name)}" class="phase-chip${active ? ' active' : ''}" style="background:${bg}">${i + 1}. ${esc(abbr)}</span>`;
    }).join('');
    $('btnEndPhase').textContent = state.campaign && state.campaign.over ? 'Кампанію завершено' : p === 2 ? 'Завершити годину ▸' : 'Завершити фазу ▸';
    $('btnEndPhase').disabled = !commandable() || !!(state.campaign && state.campaign.over);
    if (playMode() === 'spectate') $('btnEndPhase').textContent = 'Хід ботів';
    const inc = handover ? 0 : Politics.incoming(state, pf()).length;
    $('btnPol').innerHTML = 'Політика' + (inc ? `<span class="badge">${inc}</span>` : '');
  }

  function unitStatus(u) {
    const g = Engine.grid(state);
    if (u.dispersal >= 3) return { text: `Розсіяний: ${u.personnel.straggling} відсталих`, cls: 'warn' };
    if (u.embarked != null) { const v = Engine.unitById(state, u.embarked); return { text: `У машині: ${v ? v.name : '?'}`, cls: '' }; }
    if (u.order && u.order.status === 'blocked') return { text: `Шлях перекрито → ${g.label(u.order.target)}`, cls: 'warn' };
    if (u.order && u.order.status === 'contact') return { text: `Контакт! Рух зупинено → ${g.label(u.order.target)}`, cls: 'warn' };
    if (u.order) return { text: `${Engine.ORDER_NAMES[u.order.type]} → ${g.label(u.order.target)} (ще ${u.order.path.length})`, cls: '' };
    if (u.pendingOrder) return { text: `Відкладений: ${Engine.ORDER_NAMES[u.pendingOrder.type].toLowerCase()}${u.pendingOrder.target != null ? ' → ' + g.label(u.pendingOrder.target) : ''}`, cls: '' };
    if (u.stance === 'defend') return { text: `Оборона${u.fort ? `, позиції ${u.fort}/${CONFIG.combat.fortMax}` : ''}`, cls: '' };
    if (u.stance === 'observe') return { text: 'Розвідка (спостереження)', cls: '' };
    if (u.stance === 'ambush') return { text: 'Засідка: чекає ціль', cls: '' };
    return { text: 'Очікує наказу', cls: '' };
  }

  function renderLeft() {
    const st = Engine.controlStats(state);
    const land = st.reduce((a, b) => a + b, 0) || 1;
    const km2 = n => (n * 0.0541).toFixed(1).replace('.', ',');
    $('controlSummary').innerHTML = `
      <h3>Контроль території</h3>
      <div class="ctlbar">${[0, 1, 2].map(f => `<i style="width:${st[f] / land * 100}%;background:${FC[f]}"></i>`).join('')}</div>
      ${[0, 1, 2].map(f => `<div class="ctlrow"><span><span class="dot" style="background:${FC[f]}"></span>${esc(CONFIG.factions[f].short)}</span><span class="num">${km2(st[f])} км² · ${Math.round(st[f] / land * 100)}%</span></div>`).join('')}
      <div class="settl">${state.map.settlements.map(s => `<span>${esc(s.name)}</span><span>${s.control >= 0 ? `<span class="dot" style="background:${FC[s.control]}"></span>${esc(CONFIG.factions[s.control].short)}` : '—'}</span>`).join('')}</div>`;
    const f = pf();
    const own = state.units.filter(u => u.faction === f);
    const known = Intel.knownList(state, f);
    const allies = Intel.knownList(state, f, { allies: true });
    $('factionTabs').innerHTML = `
      <button type="button" role="tab" data-ltab="own" aria-selected="${leftTab === 'own'}" style="border-bottom-color:${leftTab === 'own' ? FC[f] : 'transparent'}">Мої сили · ${own.length}</button>
      <button type="button" role="tab" data-ltab="intel" aria-selected="${leftTab === 'intel'}" style="border-bottom-color:${leftTab === 'intel' ? 'var(--bad)' : 'transparent'}">Розвідка · ${known.length}</button>
      ${allies.length ? `<button type="button" role="tab" data-ltab="allies" aria-selected="${leftTab === 'allies'}" style="border-bottom-color:${leftTab === 'allies' ? 'var(--accent)' : 'transparent'}">Союзники · ${allies.length}</button>` : ''}`;
    if (handover) { $('unitlist').innerHTML = ''; return; }
    const g = Engine.grid(state);
    if (leftTab === 'own') {
      $('unitlist').innerHTML = own.map(u => {
        const ut = CONFIG.unitTypes[u.type];
        const st2 = unitStatus(u);
        return `<button type="button" class="urow${u.id === selectedId ? ' sel' : ''}" data-unit="${u.id}">
          <span class="ic" style="background:${FC[u.faction]};border-color:${FC[u.faction]}">${esc(ut.short.slice(0, 4))}</span>
          <span><span class="nm">${esc(u.name)}</span> <span class="st num">${g.label(u.idx)} · ${u.personnel.fit}/${u.personnel.assigned} · м${u.morale}${u.vehicle ? ` · ${Math.round(u.vehicle.fuel)} л${u.carrying && u.carrying.length ? ` · +${Transport.load(state, u)}` : ''}` : ''}</span><br><span class="st" style="${st2.cls ? 'color:var(--warn)' : ''}">${esc(st2.text)}</span></span>
          <span class="mp" title="Очки руху цієї години">${Engine.fmt(u.mp)}/${Engine.mpMax(u)}</span>
        </button>`;
      }).join('') || '<p class="notice" style="padding:12px">Підрозділів не залишилося.</p>';
    } else if (leftTab === 'allies') {
      $('unitlist').innerHTML = allies.map(m => { const u = Engine.unitById(state, m.id); return `<button type="button" class="urow${m.id === selectedEnemy ? ' sel' : ''}" data-enemy="${m.id}">
          <span class="ic" style="background:${FC[m.faction]};border-color:${FC[m.faction]}">${esc(CONFIG.unitTypes[m.type].short.slice(0, 4))}</span>
          <span><span class="nm">${esc(u ? u.name : m.label)}</span> <span class="st num">${g.label(m.idx)}</span><br><span class="st">${esc(CONFIG.factions[m.faction].short)} · ${esc(CONFIG.unitTypes[m.type].name)}</span></span>
          <span class="mp">${m.fit} ос.</span></button>`; }).join('') || '<p class="notice" style="padding:12px">Союзників немає.</p>';
    } else {
      $('unitlist').innerHTML = known.map(m => `<button type="button" class="urow${m.id === selectedEnemy ? ' sel' : ''}" data-enemy="${m.id}">
          <span class="ic" style="background:${m.visible ? FC[m.faction] : 'transparent'};border-color:${FC[m.faction]};color:${m.visible ? '#fff' : FC[m.faction]}">${m.visible ? 'ВИД' : '?'}</span>
          <span><span class="nm">${esc(m.label)}</span> <span class="st num">${g.label(m.idx)}</span><br><span class="st">${esc(CONFIG.factions[m.faction].short)} · ${m.visible ? 'спостерігається зараз' : `${m.age} год тому, упевненість ${m.confidence}%`}</span></span>
          <span class="mp">${m.fit != null ? m.fit + ' ос.' : ''}</span>
        </button>`).join('') || '<p class="notice" style="padding:12px">Противника не виявлено. Використовуйте розвідгрупи та наказ «Розвідка».</p>';
    }
  }

  function hexDetails(i) {
    const g = Engine.grid(state), m = state.map;
    const t = CONFIG.terrain[m.terrain[i]];
    const road = m.road[i] === 2 ? 'асфальт' : m.road[i] === 1 ? 'ґрунтова' : 'немає';
    const ctl = m.control[i] >= 0 ? CONFIG.factions[m.control[i]].name : 'немає';
    const st = m.settlement[i] >= 0 ? m.settlements[m.settlement[i]].name : null;
    const cost = cls => {
      if (m.river[i] && !m.bridge[i]) return '—';
      const v = CONFIG.moveCost[cls][t.key]; return v == null ? '—' : Engine.fmt(v);
    };
    return { g, m, t, road, ctl, st, cost };
  }

  function renderHexInfo() {
    if (!state || handover) { $('hexinfo').textContent = ''; return; }
    const i = hoverHex >= 0 ? hoverHex : selectedHex;
    if (i < 0) { $('hexinfo').textContent = 'Наведіть курсор на гекс'; return; }
    const d = hexDetails(i);
    const parts = [`${d.g.label(i)}`, d.t.name];
    if (d.st) parts.push(d.st);
    if (d.m.river[i]) parts.push(d.m.bridge[i] ? 'міст' : 'річка');
    if (d.m.road[i]) parts.push('дорога: ' + d.road);
    parts.push(`укриття ${Math.round((CONFIG.combat.cover[d.t.key] || 0) * 100)}%`);
    parts.push('рух пішки ' + d.cost('foot'));
    const sel = selectedId != null ? Engine.unitById(state, selectedId) : null;
    if (sel && sel.idx !== i) parts.push(`${d.g.dist(sel.idx, i) * CONFIG.hexMeters} м від ${sel.name}`);
    for (const c of Civil.columnsAt(state, i)) if (Civil.visibleTo(state, pf(), c)) parts.push(`колона ${c.corridor ? 'евакуації (коридор)' : 'біженців'}: ${c.people} осіб, ≈${Civil.cars(c)} авто — не стріляти`);
    $('hexinfo').textContent = parts.join(' · ');
  }

  function attackIsIndirect() { const u = selectedId != null ? Engine.unitById(state, selectedId) : null; return !!u && Combat.hasIndirect(u); }
  function renderHint() {
    const el = $('modehint');
    const texts = {
      move: preview && preview.ok ? 'Клацніть кінцевий гекс ще раз або Enter — підтвердити. Esc — скасувати.' : 'Рух: оберіть кінцевий гекс. Esc — скасувати.',
      retreat: preview && preview.ok ? 'Відступ у тил запропоновано: Enter — підтвердити, або клацніть інший гекс.' : 'Відступ: оберіть гекс. Маршрут обходитиме відомого противника.',
      attack: preview && preview.ok ? 'Клацніть ціль ще раз або Enter — відкрити вогонь. Esc — скасувати.' : (attackIsIndirect() ? 'Навісний вогонь: клацніть ціль у червоній зоні — відомого противника або будь-який гекс (вогонь по площі). Esc — скасувати.' : intensity === 'suppress' ? 'Вогонь на придушення: клацніть будь-який гекс у зоні вогню — відомого противника, застарілу позначку або просто ймовірну позицію. Esc — скасувати.' : 'Атака: оберіть ціль, обведену червоним. Esc — скасувати.')
    };
    texts.uav = `${CONFIG.air.uav.name}: клацніть район вильоту — коло показує зону спостереження (${CONFIG.air.uav.radius} гекс.). Esc — скасувати.`;
    if (mode && !handover) { el.hidden = false; el.textContent = texts[mode]; } else el.hidden = true;
  }

  function renderRight() {
    if (handover) { $('right').innerHTML = ''; return; }
    const parts = [];
    if (report) parts.push(reportHtml(report));
    const u = selectedId != null ? Engine.unitById(state, selectedId) : null;
    if (u) parts.push(unitCard(u));
    else if (selectedEnemy != null) parts.push(enemyCard(selectedEnemy));
    if (selectedHex >= 0) parts.push(hexCard(selectedHex));
    if (!u && selectedEnemy == null && selectedHex < 0 && !report) {
      parts.push(`<div class="sec"><h3>Вибір</h3><p class="notice">Клацніть свій підрозділ на карті або в списку ліворуч, щоб відкрити його картку та віддати наказ. Права кнопка по гексу — швидкий маршрут, по ворогу — атака.</p></div>`);
    }
    $('right').innerHTML = parts.join('');
  }

  function reportHtml(R) {
    const head = R.kind === 'indirect' ? `Мінометний вогонь: ${esc(R.attacker)} → ${esc(R.defender)}` : R.kind === 'suppress' ? `Вогонь на придушення: ${esc(R.attacker)} → ${esc(R.defender)}` : `Бій: ${esc(R.attacker)} → ${esc(R.defender)}`;
    return `<div class="sec report"><div class="rep-head"><h3>Звіт бою · ${esc(R.time)}</h3><button type="button" data-act="closeReport">Закрити</button></div>
      <p class="rep-title">${head}</p>
      ${R.steps.map(s => `<div class="rep-step"><h4>${esc(s.title)}</h4>${s.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`).join('')}
    </div>`;
  }

  function orderButtons(u) {
    if (u.embarked != null) {
      const v = Engine.unitById(state, u.embarked);
      return `<div class="orders">
        <button type="button" data-act="disembark">Висадка</button>
        <button type="button" class="${mode === 'attack' ? 'primary' : ''}" data-act="attack">Атака з машини</button>
      </div>
      ${intensityRow()}
      <p class="notice">Підрозділ їде в ${esc(v ? v.name : 'машині')}. Рухом керує машина; з машини пасажири стріляють з ефективністю ×${CONFIG.transport.passengerFireMult}. Висадка займає ${CONFIG.transport.boardShare * 100}% години.</p>`;
    }
    const dis = !Engine.canAct(u);
    const hasOrder = u.order || u.pendingOrder || u.stance !== 'none';
    const canAmbush = Object.entries(u.weapons).some(([m, n]) => n > 0 && CONFIG.weapons[m] && !CONFIG.weapons[m].indirect);
    const b = (act, label, on, extra = '') => `<button type="button" class="${on ? 'primary' : ''}" data-act="${act}" ${dis ? 'disabled' : ''} ${extra}>${label}</button>`;
    return `<div class="orders">
      ${b('move', 'Рух', mode === 'move')}
      ${b('attack', 'Атака', mode === 'attack')}
      ${b('defend', 'Оборона', u.stance === 'defend')}
      ${b('retreat', 'Відступ', mode === 'retreat')}
      ${b('observe', 'Розвідка', u.stance === 'observe')}
      ${canAmbush ? b('ambush', 'Засідка', u.stance === 'ambush') : ''}
      ${u.vehicle ? `<button type="button" data-act="abandon" ${Transport.abandonReason(state, u) ? 'disabled title="' + esc(Transport.abandonReason(state, u)) + '"' : ''}>Залишити машину</button>` : ''}
      <button type="button" data-act="cancel" ${hasOrder ? '' : 'disabled'}>Скасувати наказ</button>
    </div>
    ${u.stance === 'ambush' ? '<p class="notice">Чекає ціль: першою помітить і відкриє вогонь по ворогу, що ввійде в межі прямого вогню, поки сам лишається невиявленим. Рух або будь-яка дія скасовує засідку.</p>' : ''}
    ${intensityRow()}
    ${deployHtml(u)}
    ${engHtml(u)}
    ${mountHtml(u)}
    ${binocularsHtml(u)}
    ${wireHtml(u)}
    ${supplyHtml(u)}
    ${lootHtml(u)}
    ${recoverDeadHtml(u)}
    ${medevacHtml(u)}
    ${transportHtml(u)}
    ${orgHtml(u)}
    <p class="notice">Окопи копає піхота/інженери в полі та лісі самостійно в обороні (наказ «Оборона»); бліндажі та мінні поля — через меню інженерних робіт нижче.</p>`;
  }

  function intensityRow() {
    return `<div class="intens" role="radiogroup" aria-label="Інтенсивність вогню">
      <span>Вогонь:</span>
      ${Object.entries(CONFIG.combat.intensity).map(([k, v]) => `<button type="button" role="radio" aria-checked="${intensity === k}" class="toggle" aria-pressed="${intensity === k}" data-int="${k}" title="Витрата ×${v.ammo}, ефект ×${v.effect}">${esc(v.name)}</button>`).join('')}
    </div>`;
  }

  function deployHtml(u) {
    if (!Combat.needsDeploy(u) || u.vehicle) return '';
    const heavy = Object.keys(u.weapons).filter(m => CONFIG.weapons[m] && CONFIG.weapons[m].deploy).join(', ');
    return `<div class="subsec"><h4>Групова зброя: ${esc(heavy)}</h4>
      <div class="pickrow"><span>${u.deployed ? `Розгорнуто${Engine.terrainKey(state, u.idx) === 'mountains' ? ' на висоті (+' + CONFIG.heightRangeBonus * 100 + '% дальності)' : ''}` : 'Не розгорнуто — стріляти не може'}</span>
      ${u.deployed ? '' : `<button type="button" class="mini primary" data-act="deploy">Розгорнути (${CONFIG.deployShare * 100}% год)</button>`}</div>
      <p class="notice">Будь-який рух згортає зброю.</p></div>`;
  }

  function engHtml(u) {
    if (u.type !== 'eng_squad') return '';
    const p = Field.projectOf(state, u);
    if (p) return `<div class="subsec"><h4>Інженерні роботи</h4><p class="notice">${esc(p.label)}: ${p.type === 'repair' || p.type === 'rebuild' ? 'триває' : `${p.progress} з ${p.hours} год`}. Відділення має лишатися на місці; «Скасувати наказ» перериває роботу.</p></div>`;
    const opts = Field.options(state, u);
    const E = CONFIG.engineering;
    const cost = t => E[t].eng ? `${E[t].eng} інж. майна${t === 'rebuild' ? '/год' : ''}` : E[t].parts ? `${E[t].parts} запчастин${t === 'repair' ? '/год' : ''}` : E[t].goods ? `${E[t].n} × ${CONFIG.goods[E[t].goods].name.toLowerCase()}` : '';
    return `<div class="subsec"><h4>Інженерні роботи</h4>
      ${opts.length ? opts.map(o => `<div class="pickrow"><span>${esc(o.label)} <small class="muted">${E[o.type].hours} год · ${cost(o.type)}</small></span><button type="button" class="mini" data-act="eng" data-etype="${o.type}" data-etarget="${o.target}">Почати</button></div>`).join('') : '<p class="notice">Поруч немає роботи: підійдіть до річки (міст), мосту (підрив), свого пошкодженого об’єкта (ремонт) або уламків (відновлення). Бліндаж і мінні поля можна будувати будь-де прохідному.</p>'}
      <p class="notice">Матеріали — з вантажу машини в гексі, зі складу поруч або зі складу мережі в зоні постачання.</p></div>`;
  }

  function mountHtml(u) {
    if (!CONFIG.unitTypes[u.type].mountable) return '';
    const src = Field.mountSources(state, u);
    const uniq = [...new Set(src.map(x => x.m))];
    const why = Field.mountReason(state, u, null);
    return `<div class="subsec"><h4>Озброєння машини${u.mount ? ': ' + esc(u.mount) : ''}</h4>
      ${uniq.length ? uniq.map(m => `<div class="pickrow"><span>Встановити ${esc(m)}</span><button type="button" class="mini" data-act="mount" data-model="${esc(m)}" ${why ? `disabled title="${esc(why)}"` : ''}>Встановити</button></div>`).join('') : `<p class="notice">${u.mount ? 'Технічка готова до бою.' : 'Щоб зробити технічку, станьте в гекс свого складу з ПКМ, «Утьосом» чи АГС або поруч із розрахунком, у якого є така зброя.'}</p>`}
    </div>`;
  }

  function binocularsHtml(u) {
    if (u.type !== 'recon') return '';
    if (u.binoculars) return `<div class="subsec"><h4>Бінокль</h4><p class="notice">Є в підрозділу — дальність спостереження +${CONFIG.detection.binocularsBonus} гекс.</p></div>`;
    const why = Field.issueBinocularsReason(state, u);
    return `<div class="subsec"><h4>Бінокль</h4><div class="orders"><button type="button" class="mini" data-act="issueBinoculars" ${why ? `disabled title="${esc(why)}"` : ''}>Отримати бінокль (+${CONFIG.detection.binocularsBonus} гекс. спостереження)</button></div></div>`;
  }

  const WIRE_UNITS = ['eng_squad', 'inf_squad', 'inf_platoon', 'mg_team', 'at_team', 'recon'];
  function wireHtml(u) {
    if (!WIRE_UNITS.includes(u.type)) return '';
    const why = Field.wireReason(state, u);
    const lvl = Mines.wireAt(state, u.idx);
    const own = (lvl && lvl[u.faction]) || 0;
    return `<div class="subsec"><h4>Єгоза (загородження) · своя тут: рівень ${own}/${CONFIG.engineering.wire.max}</h4>
      <div class="orders"><button type="button" class="mini" data-act="layWire" ${why ? `disabled title="${esc(why)}"` : ''}>Встановити (+1 рівень)</button></div>
      <p class="notice">Дає захист (cover) будь-кому, хто обороняється в гексі; забирає частину ОР у ворога, що заходить сюди (своїм — безкоштовно).</p></div>`;
  }

  const LOAD_PRESETS = [['ammo', 'Набої'], ['fuel', 'Пальне'], ['med', 'Медикаменти'], ['eng', 'Інж. майно'], ['parts', 'Запчастини'], ['crude', 'Нафта'], ['mix', 'Змішаний (потроху всього)'], ['all', 'Усе (евакуація складу)']];
  const loadSel = {};   // u.id -> останньо вибраний тип вантажу (щоб не збивалось при перемальовці)
  function supplyHtml(u) {
    const st = Logistics.storesNear(state, u);
    if (!st.length || u.embarked != null) return '';
    const why = Logistics.resupplyReason(state, u);
    let load = '';
    if (Logistics.cargoCapKg(u) > 0 && st.some(x => x.idx === u.idx)) {
      const lr = Logistics.loadReason(state, u);
      const sel = loadSel[u.id] || 'ammo';
      load = `<div class="pickrow"><span>Завантажити (загально)</span><span class="orders">
        <select data-loadsel="${u.id}">${LOAD_PRESETS.map(([k, t]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <button type="button" class="mini" data-act="load" data-uidload="${u.id}" ${lr ? `disabled title="${esc(lr)}"` : ''}>Завантажити</button>
      </span></div>`;
      // Запит гравця: окремо — вибір КОНКРЕТНОЇ позиції й кількості (щоб не губилося в «жадібному»
      // загальному розподілі, як було з протитанковими мінами).
      const items = Logistics.loadableItems(state, u);
      if (items.length) {
        load += `<div class="pickrow"><span>…або конкретна позиція</span><span class="orders">
          <select data-itemsel="${u.id}">${items.map((it, i) => `<option value="${i}">${esc(it.name)} (є ${Engine.fmt(it.have)} ${esc(it.unit)})</option>`).join('')}</select>
          <input type="number" min="1" step="1" value="1" style="width:4.5em" data-itemqty="${u.id}">
          <button type="button" class="mini" data-act="loadItem" data-uidload="${u.id}" ${lr ? `disabled title="${esc(lr)}"` : ''}>Завантажити</button>
        </span></div>`;
      }
    }
    return `<div class="subsec"><h4>Склад поруч: ${esc(st[0].name)}</h4>
      <div class="pickrow"><span>Поповнити набої та пальне до повного</span><button type="button" class="mini" data-act="resupply" ${why ? `disabled title="${esc(why)}"` : ''}>Поповнити</button></div>${load}</div>`;
  }

  function medevacHtml(u) {
    if (u.type !== 'medevac') return '';
    const why = Logistics.pickupReason(state, u);
    return `<div class="subsec"><h4>Евакуація поранених · несе ${u.carriedWounded || 0}/${CONFIG.medical.medevacCapacity}</h4>
      <div class="pickrow"><span>Забрати поранених у своїх підрозділів у гексі</span><button type="button" class="mini" data-act="pickup" ${why ? `disabled title="${esc(why)}"` : ''}>Забрати</button></div>
      <p class="notice">Поранені поруч із групою (у гексі чи сусідньому) майже не помирають. У зоні постачання група сама передає їх у шпиталь наприкінці години.</p></div>`;
  }

  function lootHtml(u) {
    const c = Loot.cacheAt(state, u.idx, false);
    if (Loot.isEmpty(c)) return '';
    const why = Loot.lootReason(state, u);
    return `<div class="subsec"><h4>Трофеї в гексі · ${Loot.count(c.weapons)} од. зброї, ${Loot.count(c.ammo)} набоїв</h4>
      <div class="pickrow"><span>Переозброїти бійців без зброї, решту — у вантаж</span><button type="button" class="mini" data-act="loot" ${why ? `disabled title="${esc(why)}"` : ''}>Забрати</button></div>
      ${why ? `<p class="notice">${esc(why)}</p>` : ''}</div>`;
  }

  // Рішення автора (запит гравця): тіла своїх загиблих у гексі тиснуть на мораль, поки їх не
  // забрали (CONFIG.combat.deadMoraleLoss/год) — доступно будь-якому боєздатному підрозділу,
  // не лише медевакам (це не медична допомога, а просто винесення тіл).
  function recoverDeadHtml(u) {
    const c = Loot.cacheAt(state, u.idx, false);
    const n = c && c.dead ? (c.dead[u.faction] || 0) : 0;
    if (!n) return '';
    const why = Loot.recoverDeadReason(state, u);
    return `<div class="subsec"><h4>Загиблі в гексі: ${n}</h4>
      <div class="pickrow"><span>Забрати тіла — поки вони тут, мораль у гексі щогодини падає (−${CONFIG.combat.deadMoraleLoss})</span><button type="button" class="mini" data-act="recoverDead" ${why ? `disabled title="${esc(why)}"` : ''}>Забрати загиблих</button></div>
      ${why ? `<p class="notice">${esc(why)}</p>` : ''}</div>`;
  }

  // Посадка (для піших) або пасажири (для техніки)
  function transportHtml(u) {
    if (u.vehicle) {
      const list = Transport.passengers(state, u);
      return `<div class="subsec"><h4>Пасажири · ${Transport.load(state, u)}/${Transport.capacity(u)}</h4>
        ${list.length ? `<ul class="list">${list.map(p => `<li><span>${esc(p.name)} (${Transport.persons(p)} ос.)</span><span><button type="button" class="mini" data-act="unloadOne" data-pid="${p.id}">Висадити</button></span></li>`).join('')}</ul>
        <div class="orders"><button type="button" data-act="unloadAll">Висадити всіх</button></div>` : '<p class="notice">Порожньо. Піший підрозділ у цьому гексі може сісти через свою картку («Посадка»).</p>'}
      </div>`;
    }
    if (Engine.moveClass(u) !== 'foot') return '';
    const vs = Transport.vehiclesFor(state, u);
    if (!vs.length) return '';
    return `<div class="subsec"><h4>Посадка в техніку</h4>
      ${vs.map(x => `<div class="pickrow"><span>${esc(x.v.name)} · вільно ${x.free}/${Transport.capacity(x.v)}</span><button type="button" class="mini" data-act="board" data-vid="${x.v.id}" ${x.reason ? `disabled title="${esc(x.reason)}"` : ''}>Посадка</button></div>${x.reason ? `<p class="notice">${esc(x.reason)}</p>` : ''}`).join('')}
    </div>`;
  }

  // Виділення відділення / об'єднання
  function orgHtml(u) {
    const parts = [];
    if (CONFIG.organization.splittable.includes(u.type)) {
      const why = Transport.splitReason(state, u);
      parts.push(`<div class="pickrow"><span>Виділити відділення (${CONFIG.organization.squadSize} ос.)</span><button type="button" class="mini" data-act="split" ${why ? `disabled title="${esc(why)}"` : ''}>Виділити</button></div>${why ? `<p class="notice">${esc(why)}</p>` : ''}`);
    }
    if (CONFIG.organization.mergeable.includes(u.type) && u.embarked == null) {
      for (const x of Transport.mergeCandidates(state, u)) {
        parts.push(`<div class="pickrow"><span>Влити ${esc(x.u.name)} (${x.u.personnel.fit} ос.)</span><button type="button" class="mini" data-act="merge" data-mid="${x.u.id}" ${x.reason ? `disabled title="${esc(x.reason)}"` : ''}>Об’єднати</button></div>`);
      }
    }
    if (!parts.length) return '';
    return `<div class="subsec"><h4>Реорганізація · ${CONFIG.organization.actionShare * 100}% години</h4>${parts.join('')}</div>`;
  }

  function unitCard(u) {
    const g = Engine.grid(state);
    const ut = CONFIG.unitTypes[u.type];
    const p = u.personnel;
    const mine = pf() === u.faction && commandable();
    const wl = Object.entries(u.weapons).map(([k, n]) => `<li><span>${esc(k)}${CONFIG.weapons[k] ? ` <small class="muted">${CONFIG.weapons[k].range} м</small>` : ''}</span><span>${n}</span></li>`).join('') || '<li><span>немає</span><span></span></li>';
    const al = Object.entries(u.ammo).map(([k, n]) => `<li><span>${esc(CONFIG.ammo[k] ? CONFIG.ammo[k].name : k)}</span><span${n === 0 ? ' class="bad"' : ''}>${n}</span></li>`).join('') || '<li><span>немає</span><span></span></li>';
    const st = unitStatus(u);
    let orderHtml = `<p class="notice${st.cls ? ' warn' : ''}">${esc(st.text)}</p>`;
    if (u.order && u.pendingOrder) orderHtml += `<p class="notice">Відкладений наказ: ${esc(Engine.ORDER_NAMES[u.pendingOrder.type])} (з наступної години)</p>`;
    let controls = '';
    if (mine) {
      controls = orderButtons(u);
      if (u.attackedTurn === state.time.turn) controls += `<p class="notice">Підрозділ уже вів бій цієї години.</p>`;
      else if (u.mp <= 1e-9) controls += `<p class="notice">Очки руху цієї години вичерпано. Новий наказ руху почне виконуватися з наступної години.</p>`;
      else if (u.movedThisPhase) controls += `<p class="notice">Залишок ОР цієї години: ${Engine.fmt(u.mp)}. Новий наказ руху виконається негайно, у межах цього залишку.</p>`;
    }
    const lr = u.lastReport;
    const veh = u.vehicle ? `
      <div class="sec"><h3>Техніка</h3><dl class="kv">
        <dt>Модель</dt><dd>${esc(u.vehicle.model)}</dd>
        <dt>Стан</dt><dd>${u.vehicle.condition}%</dd>
        <dt>Пальне</dt><dd>${Engine.fmt(u.vehicle.fuel)} / ${u.vehicle.fuelMax} л</dd>
        <dt>Витрата</dt><dd>${CONFIG.unitTypes[u.type].vehicle.fuelPerHour} л за годину руху</dd>
        <dt>Пасажири</dt><dd>${Transport.load(state, u)} / ${u.vehicle.passengers}</dd>
        <dt>Броня</dt><dd>${Combat.armorOf(u) === 'armored' ? 'протикульна' : 'немає'}</dd>
      </dl><p class="notice">Поповнення пального — з етапу 3 (склади).</p></div>` : '';
    const xpNext = CONFIG.combat.xpForLevel[u.experience + 1];
    return `
      <div class="sec">
        <div class="card-head"><span class="flag" style="background:${FC[u.faction]}"></span>
          <div><h2>${esc(u.name)}${u.hero ? ` ★ ${esc(u.hero.name)}` : ''}</h2><div class="sub">${esc(ut.name)} · ${esc(CONFIG.factions[u.faction].name)}</div></div></div>
      </div>
      <div class="sec"><h3>Наказ</h3>${orderHtml}${controls}${previewHtml(u)}</div>
      <div class="sec"><h3>Стан</h3><dl class="kv">
        <dt>Позиція</dt><dd>${g.label(u.idx)} · ${esc(CONFIG.terrain[state.map.terrain[u.idx]].name)}</dd>
        <dt>Укриття</dt><dd>${Math.round(Combat.coverOf(state, u) * 100)}%${u.fort ? `, позиції ${u.fort}/${CONFIG.combat.fortMax}` : ''}</dd>
        <dt>Очки руху</dt><dd>${Engine.fmt(u.mp)} / ${ut.mp} за год</dd>
        <dt>Мораль</dt><dd>${u.morale} · ${esc(moraleBand(u.morale))}</dd>
        <dt>Придушення</dt><dd>${Math.round(u.suppression)}</dd>
        <dt>Досвід</dt><dd>${esc(CONFIG.experience[u.experience])} (${u.xp}${xpNext != null ? '/' + xpNext : ''})</dd>
        ${u.hero ? `<dt>Герой</dt><dd class="good">${esc(u.hero.name)} · +${CONFIG.combat.heroes.moraleBonus} моралі, +${Math.round((CONFIG.combat.heroes.fireMult - 1) * 100)}% до вогню, назавжди</dd>` : ''}
        <dt>Спостереження</dt><dd>${Intel.observeRange(state, u)} гекс. (${Intel.observeRange(state, u) * CONFIG.hexMeters} м)</dd>
        ${zoneRows(u)}
        ${u.dispersal ? `<dt>Розсіювання</dt><dd>${u.dispersal}/3</dd>` : ''}
        ${u.surrounded ? '<dt>Оточення</dt><dd class="bad">так</dd>' : ''}
        <dt>Постачання</dt><dd>${esc(Logistics.supplyText(state, u, u.inSupply))}</dd>
        <dt>Зв’язок</dt><dd>${u.comm.connected ? 'є' : 'втрачено'}</dd>
      </dl><div class="moralebar"><i style="width:${u.morale}%"></i></div></div>
      <div class="sec"><h3>Особовий склад</h3><dl class="kv">
        <dt>За штатом</dt><dd>${p.assigned}</dd>
        <dt>Боєздатні</dt><dd>${p.fit}</dd>
        <dt>Поранені</dt><dd>${p.wounded}</dd>
        <dt>Загиблі</dt><dd>${p.killed}</dd>
        <dt>Полонені</dt><dd>${p.captured}</dd>
        <dt>Зниклі безвісти</dt><dd>${p.missing}</dd>
        <dt>Евакуйовані поранені</dt><dd>${p.evacuated || 0}</dd>
        <dt>Відстали</dt><dd>${p.straggling}</dd>
      </dl></div>
      <div class="sec"><h3>Озброєння</h3><ul class="list">${wl}</ul></div>
      <div class="sec"><h3>Боєприпаси</h3><ul class="list">${al}</ul></div>
      ${cargoHtml(u)}
      ${veh}
      <div class="sec"><h3>Останній доклад командуванню</h3><p class="notice">${lr ? `${Engine.timeLabel(lr)} · ${g.label(lr.idx)} · боєздатних ${lr.fit} · мораль ${lr.morale}` : 'Доповідей ще не було.'}</p></div>`;
  }

  function cargoHtml(u) {
    const c = u.cargo || { weapons: {}, ammo: {}, goods: {} };
    const w = Object.entries(c.weapons).filter(([, n]) => n > 0), a = Object.entries(c.ammo).filter(([, n]) => n > 0), gd = Object.entries(c.goods || {}).filter(([, n]) => n > 0);
    const mine = u.faction === pf() && commandable();
    const canKg = Logistics.cargoCapKg(u) > 0;
    const head = canKg ? `Вантаж · ${Math.round(Logistics.cargoKg(u))}/${Logistics.cargoCapKg(u)} кг` : `Трофеї у вантажі · ${Loot.count(c.weapons)}/${Loot.cargoCap(u)}`;
    let btns = '';
    if (mine && canKg) {
      const ri = Logistics.issueReason(state, u), ru = Logistics.unloadReason(state, u);
      btns = `<div class="orders">
        <button type="button" data-act="issue" ${ri ? `disabled title="${esc(ri)}"` : ''}>Видати запаси підрозділам у гексі</button>
        <button type="button" data-act="unload" ${ru ? `disabled title="${esc(ru)}"` : ''}>Розвантажити на склад</button>
      </div>`;
    }
    if (!w.length && !a.length && !gd.length) return canKg && mine ? `<div class="sec"><h3>${head}</h3><p class="notice">Порожньо. Завантажте запаси в гексі свого складу.</p></div>` : '';
    return `<div class="sec"><h3>${head}</h3><ul class="list">
      ${w.map(([m, n]) => `<li><span>${esc(m)}</span><span>${n}</span></li>`).join('')}
      ${a.map(([k, n]) => `<li><span>${esc(CONFIG.ammo[k].name)}</span><span>${n}</span></li>`).join('')}
      ${gd.map(([k, n]) => `<li><span>${esc(CONFIG.goods[k].name)}</span><span>${Engine.fmt(n)} ${CONFIG.goods[k].unit}</span></li>`).join('')}
    </ul>${btns}${mine && !u.vehicle ? '<div class="orders"><button type="button" data-act="dropCargo">Залишити вантаж у гексі</button></div>' : ''}
    <p class="notice">${canKg ? 'Видача поповнює набої й пальне всім своїм у гексі; розвантаження створює польовий склад, якщо складу в гексі немає.' : 'Вантаж не стріляє; його можна залишити в гексі.'}</p></div>`;
  }

  // Об’єкти в гексі
  function facilityHtml(i) {
    const f = pf();
    const list = Logistics.known(state, f).filter(x => x.idx === i);
    if (!list.length) return '';
    const sel = selectedId != null ? Engine.unitById(state, selectedId) : null;
    const now = Intel.hexObserved(state, f, i);
    return list.map(fa => {
      const def = CONFIG.facilities[fa.type];
      const mine = fa.owner === f && commandable();
      const visible = mine || now;
      const st = fa.stock;
      const ammo = Object.entries(st.ammo).filter(([, n]) => n > 0).map(([k, n]) => `<li><span>${esc(CONFIG.ammo[k].name)}</span><span>${n}</span></li>`).join('');
      const weap = Object.entries(st.weapons).filter(([, n]) => n > 0).map(([k, n]) => `<li><span>${esc(k)}</span><span>${n}</span></li>`).join('');
      const goods = Object.entries(st.goods).filter(([, n]) => n > 0).map(([k, n]) => `<li><span>${esc(CONFIG.goods[k].name)}</span><span>${Engine.fmt(Math.round(n * 10) / 10)} ${CONFIG.goods[k].unit}</span></li>`).join('');
      let info = '';
      if (!visible) info = `<p class="notice">Об’єкт противника. Останні дані: ${fa.seen[f] ? esc(Engine.timeLabel(fa.seen[f])) : '—'}.</p>`;
      else {
        info = `<dl class="kv">
          <dt>Власник</dt><dd>${fa.owner === -1 ? 'нічийний (не захоплено)' : esc(CONFIG.factions[fa.owner].name)}</dd>
          ${fa.destroyed ? '<dt>Стан</dt><dd class="bad">знищено</dd>' : !Logistics.isStore(fa) && fa.type !== 'hospital' ? `<dt>Стан</dt><dd>${fa.condition}%${fa.offline > 0 ? `, простій ${fa.offline} год` : ''}</dd>` : ''}
          ${def.cost ? `<dt>Витрати</dt><dd>${def.cost} грн/год</dd>` : ''}
          ${fa.type === 'hospital' ? `<dt>Пацієнти</dt><dd>${fa.patients} / ${def.beds}</dd>` : ''}
          ${Logistics.isStore(fa) ? `<dt>Заповнення</dt><dd>${Math.round(Logistics.stockKg(st))} / ${def.capacityKg} кг</dd>` : ''}
        </dl>
        ${ammo || weap || goods ? `<ul class="list">${ammo}${weap}${goods}</ul>` : '<p class="notice">Запасів немає.</p>'}`;
      }
      let btns = '';
      if (Logistics.isStore(fa) && mine && visible && !fa.destroyed) {
        const q = Recruit.queue(state).filter(x => x.storeId === fa.id);
        const t0 = formSel[fa.id] || 'inf_squad';
        const p0 = Recruit.plan(state, f, fa, t0), w0 = Recruit.formReason(state, f, fa, t0);
        info += `<div class="subsec"><h4>Формування підрозділів</h4>
          <div class="form-row"><label for="formType${fa.id}">Тип</label><select id="formType${fa.id}" data-formsel="${fa.id}">${CONFIG.recruitment.types.map(t => `<option value="${t}" ${t0 === t ? 'selected' : ''}>${esc(CONFIG.unitTypes[t].name)}</option>`).join('')}</select>
          <button type="button" class="mini primary" data-act="form" data-fid="${fa.id}" ${w0 ? `title="${esc(w0)}"` : ''}>Сформувати</button></div>
          <p class="notice">${p0.men} ос. з резерву, ${p0.money} грн, підготовка ${p0.hours} год; зброя зі складу${p0.missing.length ? ` — бракує: ${esc(p0.missing.join(', '))}` : ''}.${w0 && !p0.missing.length ? ' ' + esc(w0) : ''}</p>
          ${q.length ? `<ul class="list">${q.map(x => `<li><span>${esc(CONFIG.unitTypes[x.type].name)}</span><span>готовий о ${esc(Engine.timeLabel(Engine.addHours(state.time, x.ready - state.time.turn)))}</span></li>`).join('')}</ul>` : ''}</div>`;
      }
      if (fa.type === 'motorpool' && mine && visible) {
        info += `<ul class="list">${Object.entries(fa.vehicles || {}).map(([t, n]) => `<li><span>${esc(CONFIG.unitTypes[t].name.replace(' (екіпаж)', ''))}</span><span>${n} <button type="button" class="mini" data-act="issueVeh" data-fid="${fa.id}" data-vtype="${t}" ${Field.motorpoolReason(state, f, fa, t) ? `disabled title="${esc(Field.motorpoolReason(state, f, fa, t))}"` : ''}>Видати</button></span></li>`).join('')}</ul><p class="notice">Екіпаж — з резерву людей фракції.</p>`;
      }
      if (sel && sel.faction === f && fa.owner === -1 && !fa.destroyed) {
        const cr = Logistics.claimReason(state, sel, fa);
        btns = `<div class="orders"><button type="button" data-act="claimFac" data-fid="${fa.id}" ${cr ? `disabled title="${esc(cr)}"` : ''}>Заявити права на об’єкт</button></div>`;
      }
      if (sel && sel.faction === f && mine && !fa.destroyed) {
        const b = [];
        if (Logistics.isStore(fa)) {
          const rr = Logistics.resupplyReason(state, sel);
          b.push(`<button type="button" data-act="resupply" ${rr ? `disabled title="${esc(rr)}"` : ''}>Поповнити ${esc(sel.name)}</button>`);
          if (Logistics.cargoCapKg(sel) > 0) {
            const lr = Logistics.loadReason(state, sel);
            const vsel = loadSel[sel.id] || 'ammo';
            b.push(`<select data-loadsel="${sel.id}">${LOAD_PRESETS.map(([k, t]) => `<option value="${k}" ${vsel === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`);
            b.push(`<button type="button" class="mini" data-act="load" data-uidload="${sel.id}" ${lr ? `disabled title="${esc(lr)}"` : ''}>Завантажити</button>`);
          }
        }
        if (sel.idx === fa.idx) {
          const dr = Logistics.destroyReason(state, sel, fa);
          b.push(`<button type="button" data-act="destroyFac" data-fid="${fa.id}" ${dr ? `disabled title="${esc(dr)}"` : ''}>${fa.confirmDestroy ? 'Підтвердити знищення' : 'Знищити об’єкт'}</button>`);
        }
        btns = `<div class="orders">${b.join('')}</div>`;
      }
      return `<div class="sec fac"><h3>${esc(def.name)} · ${esc(fa.name)}</h3>${info}${btns}</div>`;
    }).join('');
  }

  function enemyCard(id) {
    const g = Engine.grid(state);
    const m = knownRecord(id);
    if (!m) return '';
    const sel = selectedId != null ? Engine.unitById(state, selectedId) : null;
    return `<div class="sec">
      <div class="card-head"><span class="flag" style="background:${FC[m.faction]}"></span>
        <div><h2>${esc(m.label)}</h2><div class="sub">${esc(CONFIG.factions[m.faction].name)} · ${Politics.allied(state, pf(), m.faction) ? 'союзник' : m.partner ? 'партнер з обміну розвідданими' : 'розвіддані'}${m.shared != null && m.shared !== true && !m.partner ? ' · дані від «' + esc(CONFIG.factions[m.shared].short) + '»' : ''}</div></div></div>
      <dl class="kv" style="margin-top:10px">
        <dt>Позиція</dt><dd>${g.label(m.idx)}</dd>
        <dt>Стан даних</dt><dd>${m.visible ? 'спостерігається зараз' : `${m.age} год тому`}</dd>
        <dt>Упевненість</dt><dd>${m.confidence}%</dd>
        <dt>Отримано</dt><dd>${esc(Engine.timeLabel(m))}</dd>
        <dt>Чисельність</dt><dd>${m.fit != null ? m.fit + ' боєздатних' : m.approx ? esc(m.approx) : 'невідомо'}</dd>
        ${sel ? `<dt>Від ${esc(sel.name)}</dt><dd>${g.dist(sel.idx, m.idx) * CONFIG.hexMeters} м</dd>` : ''}
      </dl>
      <p class="notice">${m.partner ? 'Підрозділ партнера: його бачите завдяки союзу чи обміну розвідданими. Наказувати ним не можна; атака по союзнику розірве союз.' : m.visible ? 'Тип визначається з 2 гексів, чисельність — у безпосередньому контакті.' : 'Застаріла позначка: противник міг піти. Міномети можуть бити по ній зі зниженою точністю.'}</p>
    </div>`;
  }

  function previewHtml(u) {
    if (!preview || preview.unitId !== u.id) return '';
    if (!preview.ok) return `<div class="route"><p class="notice bad">${esc(preview.reason)}</p></div>`;
    const g = Engine.grid(state);
    const p = preview;
    if (p.path) {
      const firstLeg = p.pending ? 0 : p.hourOf.filter(h => h === 0).length;
      const legs = [];
      for (let h = 0; h < p.hours; h++) {
        const steps = p.hourOf.map((x, k) => [x, k]).filter(([x]) => x === h);
        const cost = steps.reduce((a, [, k]) => a + p.costs[k], 0);
        const end = p.path[steps[steps.length - 1][1]];
        const t = Engine.addHours(state.time, h + p.startHourOffset);
        legs.push(`<li>${Engine.timeLabel(t)}: ${steps.length} гекс., ${Engine.fmt(cost)} ОР → ${g.label(end)}</li>`);
      }
      return `<div class="route">
        <dl class="kv">
          <dt>Наказ</dt><dd>${esc(Engine.ORDER_NAMES[p.kind])} → ${g.label(p.target)}</dd>
          <dt>Довжина</dt><dd>${p.path.length} гекс. · ${(p.path.length * CONFIG.hexMeters / 1000).toFixed(2).replace('.', ',')} км</dd>
          <dt>Вартість</dt><dd>${Engine.fmt(p.total)} ОР</dd>
          <dt>Час</dt><dd>${p.hours} год${p.pending ? ' (з наступної години)' : ''}</dd>
          <dt>Цієї години</dt><dd>${firstLeg} гекс.</dd>
          <dt>Прибуття</dt><dd>${Engine.timeLabel(p.arrive)}</dd>
          ${p.fuel ? `<dt>Пальне</dt><dd${p.fuel.need > p.fuel.have ? ' class="bad"' : ''}>≈${Engine.fmt(p.fuel.need)} з ${Engine.fmt(p.fuel.have)} л</dd>` : ''}
        </dl>
        <ul>${legs.join('')}</ul>
        <h3 style="margin:8px 0 4px">Ризики</h3>
        <ul>${p.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="orders"><button type="button" class="primary" data-act="confirm">Підтвердити наказ</button><button type="button" data-act="discard">Скасувати</button></div>
      </div>`;
    }
    const target = p.targetUnit != null ? knownRecord(p.targetUnit) : (p.marker || null);
    return `<div class="route">
      <dl class="kv">
        <dt>Ціль</dt><dd>${esc(p.area ? `площа ${g.label(p.hex)} — противника не виявлено` : target ? target.label : 'гекс ' + g.label(p.hex))}</dd>
        <dt>Відстань</dt><dd>${p.dist} гекс. · ${p.meters} м</dd>
        <dt>Вогонь</dt><dd>${p.area ? 'навісний по площі' : p.indirect ? 'навісний' : 'прямий'} · ${esc(CONFIG.combat.intensity[p.intensity].name.toLowerCase())}</dd>
        <dt>Витрата</dt><dd>${esc(p.ammoText)}</dd>
      </dl>
      <ul>${p.weapons.map(w => `<li>${esc(w.model)} ×${w.n} (дальність ${w.range} м)</li>`).join('')}</ul>
      ${p.notes.length ? `<ul>${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="notice">Атака забирає решту години. Результат розраховується одразу й пояснюється у звіті бою.</p>
      <div class="orders"><button type="button" class="primary" data-act="fire">Відкрити вогонь</button><button type="button" data-act="discard">Скасувати</button></div>
    </div>`;
  }

  function hexCard(i) {
    const d = hexDetails(i);
    const f = pf();
    const own = Engine.unitsAt(state, i).filter(u => u.faction === f);
    const enemies = Engine.unitsAt(state, i).filter(u => u.faction !== f && Intel.isVisible(state, f, u.id));
    const marks = Intel.markerAt(state, f, i).filter(m => !m.visible);
    const btns = own.map(u => `<button type="button" data-unit="${u.id}"><span class="dot" style="background:${FC[u.faction]}"></span>${esc(u.name)} · ${esc(CONFIG.unitTypes[u.type].name)}</button>`)
      .concat(enemies.map(u => { const r = knownRecord(u.id); return `<button type="button" data-enemy="${u.id}"><span class="dot" style="background:${FC[u.faction]}"></span>${esc(r ? r.label : 'Противник')} (видно)</button>`; }))
      .concat(marks.map(m => `<button type="button" data-enemy="${m.id}"><span class="dot" style="background:${FC[m.faction]}"></span>${esc(m.label)} (${m.age} год тому)</button>`));
    const field = settlementHtml(i) + battlefieldHtml(i) + facilityHtml(i);
    return `${field}<div class="sec"><h3>Гекс ${d.g.label(i)}</h3><dl class="kv">
      <dt>Місцевість</dt><dd>${esc(d.t.name)}</dd>
      ${d.st ? `<dt>Населений пункт</dt><dd>${esc(d.st)}</dd>` : ''}
      <dt>Дорога</dt><dd>${d.road}</dd>
      <dt>Річка</dt><dd>${d.m.river[i] ? (d.m.bridge[i] ? 'так, є міст' : 'так, без переправи') : 'ні'}</dd>
      <dt>Контроль</dt><dd>${esc(d.ctl)}</dd>
      <dt>Укриття</dt><dd>${Math.round((CONFIG.combat.cover[d.t.key] || 0) * 100)}%</dd>
      <dt>Маскування</dt><dd>${CONFIG.detection.concealment[d.t.key] || 0}${CONFIG.detection.blocksLOS.includes(d.t.key) ? ', закриває огляд' : ''}</dd>
      <dt>Рух: пішки / кол. / гус.</dt><dd>${d.cost('foot')} / ${d.cost('wheeled')} / ${d.cost('tracked')}</dd>
      <dt>Під спостереженням</dt><dd>${Intel.hexObserved(state, f, i) ? 'так' : 'ні'}</dd>
    </dl>
    ${btns.length ? `<div class="unitsinhex">${btns.join('')}</div>` : ''}</div>`;
  }

  function supBar(s) {
    return `<div class="supbar" title="Підтримка: ${[0, 1, 2].map(f => ABBR[f] + ' ' + Math.round(Politics.support(s, f)) + '%').join(', ')}">${[0, 1, 2].map(f => `<i style="width:${Politics.support(s, f) / 3}%;background:${FC[f]}"></i>`).join('')}</div>`;
  }
  // Історія змін підтримки: звідки вона падала чи зростала
  function supLogHtml(s) {
    const log = (s.supLog || []).filter(e => Math.abs(e.d) >= 0.05).slice(-10).reverse();
    if (!log.length) return '<p class="notice">Помітних змін підтримки ще не було.</p>';
    const P = CONFIG.population;
    return `<div class="subsec"><h4>Зміни підтримки</h4><ul class="suplog">${log.map(e => `<li><span class="t">Д${e.day} ${String(e.hour).padStart(2, '0')}:00</span><span class="dot" style="background:${FC[e.f]}"></span><span>${esc(ABBR[e.f])}: ${esc(e.why)}${e.group ? ' (' + esc(P.groups[e.group].toLowerCase()) + ')' : ''}</span><span class="v ${e.d > 0 ? 'up' : 'down'}">${e.d > 0 ? '+' : '−'}${Engine.fmt(Math.abs(e.d))}</span></li>`).join('')}</ul></div>`;
  }
  function settlementHtml(i) {
    const sid = state.map.settlement[i];
    if (sid == null || sid < 0) return '';
    const s = state.map.settlements[sid];
    if (!s.pop) return '';
    const f = pf();
    const P = CONFIG.population;
    const unrest = { none: 'спокійно', protest: 'протести', strike: 'страйк' }[s.unrest];
    const aidWhy = Politics.aidReason(state, f, s);
    const propWhy = Politics.propagandaReason(state, f, s);
    const propOut = Politics.propagandaOutrage(state, f, s);
    return `<div class="sec fac"><h3>${esc(s.name)} · населення ${Politics.totalPop(s).toLocaleString('uk-UA')}</h3>
      <dl class="kv">
        <dt>Контроль</dt><dd>${s.control >= 0 ? esc(CONFIG.factions[s.control].name) : '—'}</dd>
        ${Politics.GROUPS.map(g => `<dt>${esc(P.groups[g])}</dt><dd>${s.pop[g].toLocaleString('uk-UA')} · ${[0, 1, 2].map(k => ABBR[k] + ' ' + Math.round(s.support[g][k])).join(' / ')}</dd>`).join('')}
        <dt>Настрої</dt><dd>${unrest}</dd>
        <dt>Цивільні жертви</dt><dd>${s.civKilled} заг. / ${s.civWounded} пор.</dd>
        <dt>Біженці</dt><dd>${s.refugees.toLocaleString('uk-UA')}</dd>
        <dt>Руйнування житла</dt><dd>${Math.round(s.damage.housing)}%</dd>
      </dl>${supBar(s)}
      ${supLogHtml(s)}
      <div class="orders" style="margin-top:8px">
        <button type="button" class="mini" data-act="aid" data-sid="${sid}" ${aidWhy ? `disabled title="${esc(aidWhy)}"` : ''}>Гуманітарна допомога (${P.aid.money} грн)</button>
        <button type="button" class="mini" data-act="propaganda" data-sid="${sid}" ${propWhy ? `disabled title="${esc(propWhy)}"` : ''}>Пропаганда (${P.propaganda.money} грн)${propOut ? ` — ворог тут щойно обстріляв цивільних, ефект ×${P.propaganda.outrageMult}!` : ''}</button>
      </div>
      <div class="subsec"><h4>Національне ополчення · ${P.militia.size} ос., ${P.militia.money} грн</h4><div class="orders">
        ${Politics.GROUPS.map(gr => { const w = Politics.militiaReason(state, f, s, gr); return `<button type="button" class="mini" data-act="militia" data-sid="${sid}" data-group="${gr}" ${w ? `disabled title="${esc(w)}"` : ''}>${esc(P.groups[gr])} · ${Math.round(s.support[gr][f])}%</button>`; }).join('')}
      </div><p class="notice">Потрібна підтримка групи ≥${P.militia.supportAbove}%. Біля дому (до ${P.militia.homeRadius} гекс.) ополчення стійкіше, далеко (від ${P.militia.farRadius}) — слабше. Інші групи пункту насторожуються.</p></div>
      <div class="subsec"><h4>Підпілля</h4><div class="orders">
        ${(() => { const w = Recruit.workshopReason(state, f, s); return `<button type="button" class="mini" data-act="workshop" data-sid="${sid}" ${w ? `disabled title="${esc(w)}"` : ''}>Облаштувати підпільну майстерню (${CONFIG.workshop.money} грн)</button>`; })()}
      </div><p class="notice">Майстерня потребує підтримки ≥${CONFIG.workshop.supportAbove}%; якщо вона впаде нижче ${CONFIG.workshop.exposedBelow}%, мешканці її видадуть.</p></div>
      <div class="subsec"><h4>Шпигуни · диверсія (${CONFIG.espionage.money} грн)</h4><div class="orders">
        ${(() => { const w = Politics.spyReason(state, f, s); return `<button type="button" class="mini" data-act="spy" data-sid="${sid}" ${w ? `disabled title="${esc(w)}"` : ''}>Заслати диверсантів — шанс ${Politics.spyChance(f)}%</button>`; })()}
      </div><p class="notice">Лише у чужому (не союзному) пункті. У разі успіху шкодить об’єктам противника там; у разі провалу падає власна підтримка в пункті. Кулдаун ${CONFIG.espionage.cooldownHours[f]} год.</p></div>
      <div class="subsec"><h4>Реквізиція цивільної техніки · залишилось ${Field.requisitionLeft(state, s)}</h4><div class="orders">
        ${['civ_pickup', 'civ_car', 'civ_van'].map(t => { const w = Field.requisitionReason(state, f, s, t); return `<button type="button" class="mini" data-act="requisition" data-sid="${sid}" data-vtype="${t}" ${w ? `disabled title="${esc(w)}"` : ''}>${esc(CONFIG.unitTypes[t].name)} (${CONFIG.requisition[t].money} грн)</button>`; }).join('')}
      </div><p class="notice">Екіпаж — з резерву людей. Реквізиція знижує підтримку мешканців.</p></div></div>`;
  }

  function battlefieldHtml(i) {
    const c = Loot.cacheAt(state, i, false);
    const f = pf();
    if (!c || !c.knownBy.includes(f)) return '';
    const selU = selectedId != null ? Engine.unitById(state, selectedId) : null;
    const now = Intel.hexObserved(state, f, i);
    const seen = c.seen[f];
    const list = o => Object.entries(o).filter(([, n]) => n > 0);
    const dead = now ? c.dead : seen.dead;
    const deadTxt = dead.map((n, k) => n ? `<li><span><span class="dot" style="background:${FC[k]}"></span>${esc(CONFIG.factions[k].short)}</span><span>${n}</span></li>` : '').join('');
    let body;
    if (now) {
      body = `${deadTxt ? `<h4>Загиблі («200»)</h4><ul class="list">${deadTxt}</ul>` : ''}
        ${(c.vehicles || []).length ? `<h4>Техніка</h4><ul class="list">${c.vehicles.map((v, k) => `<li><span>${esc(v.model)} — ${v.wreck ? 'уламки' : `покинута, стан ${v.condition}%, пальне ${Engine.fmt(v.fuel)} л${v.mount ? ', ' + esc(v.mount) : ''}`}</span><span>${!v.wreck && selU && selU.idx === i ? `<button type="button" class="mini" data-act="takeVeh" data-vi="${k}" ${Field.takeReason(state, selU, v) ? `disabled title="${esc(Field.takeReason(state, selU, v))}"` : ''}>Забрати</button>` : ''}</span></li>`).join('')}</ul>` : ''}
        <h4>Зброя</h4><ul class="list">${list(c.weapons).map(([m, n]) => `<li><span>${esc(m)}</span><span>${n}</span></li>`).join('') || '<li><span>немає</span><span></span></li>'}</ul>
        <h4>Боєприпаси</h4><ul class="list">${list(c.ammo).map(([k, n]) => `<li><span>${esc(CONFIG.ammo[k].name)}</span><span>${n}</span></li>`).join('') || '<li><span>немає</span><span></span></li>'}</ul>`;
    } else {
      body = `${deadTxt ? `<h4>Загиблі («200»)</h4><ul class="list">${deadTxt}</ul>` : ''}<p class="notice">Гекс зараз поза спостереженням. Дані на ${esc(Engine.timeLabel(seen))}: ${seen.weapons} од. зброї, ${seen.ammo} набоїв/пострілів${seen.wrecks ? ', уламки техніки' : ''}.</p>`;
    }
    const sel = selectedId != null ? Engine.unitById(state, selectedId) : null;
    let btn = '';
    if (sel && sel.idx === i) {
      const why = Loot.lootReason(state, sel);
      btn = `<div class="orders"><button type="button" data-act="loot" ${why ? `disabled title="${esc(why)}"` : ''}>Забрати трофеї (${esc(sel.name)})</button></div>${why && !Loot.isEmpty(c) ? `<p class="notice">${esc(why)}</p>` : ''}`;
    }
    return `<div class="sec battle"><h3>Місце бою · ${Engine.grid(state).label(i)}</h3>${body}${btn}</div>`;
  }

  function renderLog() {
    if (handover) { $('logbody').innerHTML = ''; return; }
    const hideDetails = $('logOwn').checked;
    const onlyAlerts = $('logAlerts').checked;
    const f = pf();
    const g = Engine.grid(state);
    const items = [];
    for (let k = state.log.length - 1; k >= 0 && items.length < 300; k--) {
      const e = state.log[k];
      if (!logVisible(e, f)) continue;
      if (hideDetails && e.kind === 'combatd') continue;
      if (onlyAlerts && e.kind !== 'alert') continue;
      const dot = e.faction != null ? `<span class="dot" style="background:${FC[e.faction]}"></span>` : '<span></span>';
      const loc = e.at != null ? `<button type="button" class="loc" data-log="${e.id}" title="Показати на карті">→ ${g.label(e.at)}</button>` : '';
      const fresh = e.kind === 'alert' && phaseAlertIds.has(e.id) ? ' new' : '';
      items.push(`<div class="le ${e.kind}${fresh}"><span class="t">Д${e.day} ${String(e.hour).padStart(2, '0')}:00</span>${dot}<span class="x">${esc(e.text)}${loc}</span></div>`);
    }
    $('logbody').innerHTML = items.length ? items.join('') : (onlyAlerts ? '<div class="le"><span></span><span></span><span class="x">Тривог немає.</span></div>' : '');
    $('alertCount').textContent = phaseAlertIds.size ? `(${phaseAlertIds.size} нових)` : '';
  }
  function logVisible(e, f) {
    if (e.vis && !e.vis.includes(f)) return false;
    if (e.vis === undefined && e.faction !== null && e.faction !== f) return false;
    return true;
  }
  // Нові тривоги фракції з моменту її попередньої фази
  function newAlerts(f) {
    const seen = (state.alertSeen || [0, 0, 0])[f] || 0;
    return state.log.filter(e => e.kind === 'alert' && e.id > seen && logVisible(e, f));
  }
  // Перехід до місця події: свій підрозділ — вибрати; відомий ворог — показати; інакше — гекс
  function jumpToLog(id) {
    const e = state.log.find(x => x.id === id);
    if (!e) return;
    const f = pf();
    const uids = e.uid == null ? [] : Array.isArray(e.uid) ? e.uid : [e.uid];
    const own = uids.map(u => Engine.unitById(state, u)).find(u => u && u.faction === f);
    if (own) { selectUnit(own.id, true); return; }
    const foe = uids.map(u => knownRecord(u)).find(Boolean);
    if (foe && foe.idx === e.at) { selectEnemy(foe.id, true); return; }
    if (e.at == null) return;
    selectedId = null; selectedEnemy = null; mode = null; preview = null; selectedHex = e.at;
    centerOn(e.at); renderAll();
  }

  // ------------------------------------------------------------ сповіщення
  function toast(text, bad = false) {
    const d = document.createElement('div');
    d.textContent = text; if (bad) d.className = 'bad';
    $('toast').appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }

  // ---------------------------------------------------------------- дії
  function selectUnit(id, center = false) {
    const u = Engine.unitById(state, id);
    if (!u || u.faction !== pf()) return;
    if (selectedId !== id) { mode = null; preview = null; }
    selectedId = id; selectedEnemy = null; selectedHex = u.idx;
    leftTab = 'own';
    if (center) centerOn(u.idx);
    renderAll();
  }

  function selectEnemy(id, center = false) {
    const m = knownRecord(id);
    if (!m) return;
    // у режимі атаки клік по ворогу — ціль
    if (mode === 'attack' && selectedId != null) { doAttackPreview(m.visible ? { unitId: id } : { hex: m.idx }); return; }
    selectedEnemy = id; selectedHex = m.idx;
    if (selectedId == null) mode = null;
    if (center) centerOn(m.idx);
    renderAll();
  }

  function setMode(m) {
    const u = selectedId != null ? Engine.unitById(state, selectedId) : null;
    if (!u || u.faction !== pf()) return;
    mode = mode === m ? null : m; preview = null;
    if (mode === 'retreat') {
      const t = Engine.suggestRetreat(state, u.id);
      if (t != null) { doMovePreview(t); toast('Запропоновано відступ у тил. Можна обрати інший гекс.'); return; }
    }
    if (mode === 'attack') {
      // автоматично обрати ціль, якщо вибрано ворога
      if (selectedEnemy != null) {
        const rec = knownRecord(selectedEnemy);
        if (rec) { doAttackPreview(rec.visible ? { unitId: rec.id } : { hex: rec.idx }); return; }
      }
    }
    renderAll();
  }

  function doMovePreview(target) {
    preview = Engine.previewMove(state, selectedId, target, mode === 'retreat' ? 'retreat' : 'move');
    if (!preview.ok) toast(preview.reason, true);
    renderAll();
  }

  function doAttackPreview(target) {
    mode = 'attack';
    preview = Combat.previewAttack(state, selectedId, target, intensity, { suppress: intensity === 'suppress' });
    if (preview.ok) preview.target = target;
    else toast(preview.reason, true);
    renderAll();
  }

  function confirmMove() {
    if (!preview || !preview.ok || !preview.path) return;
    const r = Engine.issueMoveOrder(state, preview.unitId, preview.target, preview.kind);
    if (!r.ok) { toast(r.reason, true); return; }
    const u = Engine.unitById(state, preview.unitId);
    if (r.pending) toast(`${u.name}: наказ відкладено до наступної години.`);
    else if (r.result.contact && r.result.contact.length) toast(`${u.name}: виявлено противника — рух зупинено!`, true);
    else toast(`${u.name}: пройдено ${r.result.moved} гекс.${u.order ? ', рух продовжиться наступної години' : ', ціль досягнуто'}.`);
    mode = null; preview = null; selectedHex = u.idx;
    renderAll();
  }

  function confirmAttack() {
    if (!preview || !preview.ok || preview.path) return;
    const r = Combat.attack(state, preview.unitId, preview.target, preview.intensity, { suppress: preview.intensity === 'suppress' });
    if (!r.ok) { toast(r.reason, true); return; }
    report = r.report;
    const res = r.report.result;
    mode = null; preview = null;
    if (!Engine.unitById(state, selectedId)) { selectedId = null; }
    if (selectedEnemy != null && !knownRecord(selectedEnemy)) selectedEnemy = null;
    if (res) toast(`Бій завершено: втрати ${res.lossA} / ${res.lossD}.`);
    renderAll();
    $('right').scrollTop = 0;
  }

  function act(r, okText) {
    if (!r.ok) toast(r.reason, true); else toast(okText);
    mode = null; preview = null;
    if (selectedId != null && !Engine.unitById(state, selectedId)) selectedId = null;
    renderAll();
  }

  function stance(kind) {
    const r = Engine.setStance(state, selectedId, kind);
    if (!r.ok) toast(r.reason, true);
    else if (r.pending) toast('Наказ почне діяти з наступної години.');
    mode = null; preview = null;
    renderAll();
  }

  function cancelOrder() {
    const r = Engine.cancelOrder(state, selectedId);
    if (!r.ok) toast(r.reason, true);
    renderAll();
  }

  function endPhase() {
    if (!commandable()) return;
    mode = null; preview = null;
    const r = Engine.endPhase(state);
    if (!r.ok) { toast(r.reason, true); return; }
    if (r.hourEnded && playMode() !== 'online') {
      const s = SaveSystem.saveToSlot('auto', state);
      if (!s.ok) toast('Автозбереження не вдалося: ' + s.reason, true);
    }
    resetSelection();
    leftTab = 'own';
    afterPhaseChange();
  }

  function onHexClick(i, button) {
    if (i < 0 || handover) return;
    // не свій хід (ходить бот / глядач) — лише огляд карти, без наказів
    if (!commandable()) { mode = null; preview = null; if (button === 2) return; }
    const sel = selectedId != null ? Engine.unitById(state, selectedId) : null;
    const f = pf();
    const enemiesHere = Engine.unitsAt(state, i).filter(u => u.faction !== f && !Politics.allied(state, f, u.faction) && Intel.isVisible(state, f, u.id));
    const marksHere = Intel.markerAt(state, f, i).filter(m => !m.visible);
    if (button === 2) {
      if (!sel) return;
      if (enemiesHere.length || marksHere.length || Combat.hasIndirect(sel) || intensity === 'suppress') {
        const t = enemiesHere.length ? { unitId: enemiesHere[0].id } : { hex: i };
        if (preview && preview.ok && !preview.path && preview.hex === i) confirmAttack(); else doAttackPreview(t);
        return;
      }
      if (mode !== 'retreat') mode = 'move';
      if (preview && preview.ok && preview.path && preview.target === i) confirmMove(); else doMovePreview(i);
      return;
    }
    if (mode === 'uav') {
      const r = Air.launch(state, Engine.phaseFaction(state), i);
      mode = null;
      if (!r.ok) toast(r.reason, true);
      else toast(r.lost ? `Виліт виконано (виявлено: ${r.seen}), але апарат втрачено.` : `Виліт: у районі виявлено противника — ${r.seen}.`, r.lost);
      renderAll();
      return;
    }
    if (mode === 'attack' && sel) {
      if (preview && preview.ok && !preview.path && preview.hex === i) { confirmAttack(); return; }
      if (enemiesHere.length) doAttackPreview({ unitId: enemiesHere[0].id });
      else if (marksHere.length || Combat.hasIndirect(sel) || intensity === 'suppress') doAttackPreview({ hex: i });
      else toast('У цьому гексі немає відомого противника. Вогонь по площі можливий лише навісною зброєю (міномет, АГС) або вогнем на придушення.', true);
      return;
    }
    if ((mode === 'move' || mode === 'retreat') && sel) {
      if (preview && preview.ok && preview.path && preview.target === i) { confirmMove(); return; }
      doMovePreview(i);
      return;
    }
    const own = Engine.unitsAt(state, i).filter(u => u.faction === f);
    if (own.length) {
      const k = own.findIndex(u => u.id === selectedId);
      selectUnit(own[(k + 1) % own.length].id);
      return;
    }
    if (enemiesHere.length || marksHere.length) {
      const ids = enemiesHere.map(u => u.id).concat(marksHere.map(m => m.id));
      const k = ids.indexOf(selectedEnemy);
      selectEnemy(ids[(k + 1) % ids.length]);
      return;
    }
    selectedId = null; selectedEnemy = null; selectedHex = i; preview = null; mode = null;
    renderAll();
  }

  // ---------------------------------------------------------------- введення
  function bindInput() {
    let down = null;
    const pointers = new Map();
    let pinch = null;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
        down = null; return;
      }
      down = { x: e.offsetX, y: e.offsetY, cx: view.cx, cy: view.cy, moved: false, button: e.button };
    });
    canvas.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch.d = d; return;
      }
      if (down) {
        const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) down.moved = true;
        if (down.moved) { view.cx = down.cx - dx / view.s; view.cy = down.cy - dy / view.s; clampView(); redraw(); }
      }
      if (state && !handover) {
        const h = hexAtScreen(e.offsetX, e.offsetY);
        if (h !== hoverHex) { hoverHex = h; renderHexInfo(); redraw(); }
      }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (down && !down.moved && state) onHexClick(hexAtScreen(e.offsetX, e.offsetY), down.button);
      down = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { down = null; pinch = null; pointers.clear(); });
    canvas.addEventListener('pointerleave', () => { hoverHex = -1; if (state) renderHexInfo(); redraw(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY); }, { passive: false });
    window.addEventListener('keydown', e => {
      if (!state || $('modalRoot').firstChild) { if (e.key === 'Escape') closeModal(); return; }
      if (!$('mainmenu').hidden) { if (e.key === 'Escape') closeMainMenu(); return; }
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (handover) return;
      if (e.key === 'Escape') { mode = null; preview = null; renderAll(); }
      else if (e.key === 'Enter' && preview && preview.ok && commandable()) { e.preventDefault(); preview.path ? confirmMove() : confirmAttack(); }
      else if (e.key === '+' || e.key === '=') zoomAt(1.2);
      else if (e.key === '-') zoomAt(1 / 1.2);
    });
  }

  function bindButtons() {
    $('btnEndPhase').onclick = endPhase;
    $('zoomIn').onclick = () => zoomAt(1.25);
    $('zoomOut').onclick = () => zoomAt(1 / 1.25);
    $('btnCenter').onclick = () => {
      const u = selectedId != null ? Engine.unitById(state, selectedId) : null;
      if (u) centerOn(u.idx); else if (selectedHex >= 0) centerOn(selectedHex); else focusFaction();
    };
    $('tglControl').onclick = e => { view.showControl = !view.showControl; e.currentTarget.setAttribute('aria-pressed', view.showControl); redraw(); };
    $('tglGrid').onclick = e => { view.showGrid = !view.showGrid; e.currentTarget.setAttribute('aria-pressed', view.showGrid); redraw(); };
    $('tglSupply').onclick = e => { view.showSupply = !view.showSupply; e.currentTarget.setAttribute('aria-pressed', view.showSupply); redraw(); };
    $('tglZones').onclick = e => { view.showZones = !view.showZones; e.currentTarget.setAttribute('aria-pressed', view.showZones); redraw(); };
    $('btnEco').onclick = openEconomy;
    $('btnPol').onclick = () => openPolitics();
    $('logOwn').onchange = renderLog;
    $('logAlerts').onchange = renderLog;
    $('logbody').addEventListener('click', e => { const b = e.target.closest('[data-log]'); if (b) jumpToLog(Number(b.dataset.log)); });
    $('btnSaves').onclick = () => (state && playMode() === 'online' ? Net.openLobby() : openSaves());
    $('btnChat').onclick = () => Net.toggleChat();
    $('btnNew').onclick = () => (playMode() === 'online' ? Net.openLobby() : openMainMenu());
    $('btnHelp').onclick = openHelp;
    document.addEventListener('change', e => {
      const el = e.target.closest('[data-formsel]');
      if (el) { formSel[el.dataset.formsel] = el.value; renderRight(); }
      const ls = e.target.closest('[data-loadsel]');
      if (ls) loadSel[ls.dataset.loadsel] = ls.value;
    });
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-unit],[data-enemy],[data-act],[data-ltab],[data-int]');
      if (!t || !state || handover) return;
      if (t.dataset.unit) selectUnit(Number(t.dataset.unit), true);
      else if (t.dataset.enemy) selectEnemy(Number(t.dataset.enemy), true);
      else if (t.dataset.ltab) { leftTab = t.dataset.ltab; renderLeft(); }
      else if (t.dataset.int) {
        intensity = t.dataset.int;
        if (preview && preview.ok && !preview.path) doAttackPreview(preview.target); else renderAll();
      }
      else switch (t.dataset.act) {
        case 'move': setMode('move'); break;
        case 'retreat': setMode('retreat'); break;
        case 'attack': setMode('attack'); break;
        case 'defend': stance('defend'); break;
        case 'observe': stance('observe'); break;
        case 'ambush': stance('ambush'); break;
        case 'cancel': cancelOrder(); break;
        case 'confirm': confirmMove(); break;
        case 'fire': confirmAttack(); break;
        case 'closeReport': report = null; renderAll(); break;
        case 'board': act(Transport.board(state, selectedId, Number(t.dataset.vid)), 'Посадку виконано.'); break;
        case 'disembark': act(Transport.disembark(state, selectedId), 'Висадку виконано.'); break;
        case 'unloadOne': act(Transport.disembark(state, Number(t.dataset.pid)), 'Висадку виконано.'); break;
        case 'unloadAll': act(Transport.disembarkAll(state, selectedId), 'Усіх пасажирів висаджено.'); break;
        case 'split': { const r = Transport.splitSquad(state, selectedId); act(r, 'Відділення виділено.'); break; }
        case 'deploy': act(Engine.deploy(state, selectedId), 'Зброю розгорнуто.'); break;
        case 'eng': act(Field.startProject(state, selectedId, t.dataset.etype, Number(t.dataset.etarget)), 'Роботи розпочато.'); break;
        case 'mount': act(Field.mount(state, selectedId, t.dataset.model), 'Зброю встановлено.'); break;
        case 'issueBinoculars': act(Field.issueBinoculars(state, selectedId), 'Бінокль отримано.'); break;
        case 'requisition': { const r = Field.requisition(state, pf(), Number(t.dataset.sid), t.dataset.vtype); act(r, 'Машину реквізовано.'); if (r.ok) selectUnit(r.unitId, true); break; }
        case 'issueVeh': { const r = Field.issueVehicle(state, pf(), Number(t.dataset.fid), t.dataset.vtype); act(r, 'Машину видано.'); if (r.ok) selectUnit(r.unitId, true); break; }
        case 'takeVeh': { const r = Field.takeVehicle(state, selectedId, Number(t.dataset.vi)); act(r, 'Техніку забрано.'); if (r.ok) selectUnit(r.unitId, true); break; }
        case 'aid': act(Politics.aid(state, pf(), Number(t.dataset.sid)), 'Гуманітарну допомогу надано.'); break;
        case 'propaganda': { const r = Politics.propaganda(state, pf(), Number(t.dataset.sid)); act(r, r.ok ? `Пропагандистську кампанію проведено (+${r.gain}%${r.outrage ? ', підсилено' : ''}).` : ''); break; }
        case 'militia': { const r = Politics.raiseMilitia(state, pf(), Number(t.dataset.sid), t.dataset.group); act(r, 'Ополчення сформовано.'); if (r.ok) selectUnit(r.unitId); break; }
        case 'spy': { const r = Politics.sendSpies(state, pf(), Number(t.dataset.sid)); act(r, r.ok ? (r.caught ? 'Диверсантів викрито — підтримка у пункті впала.' : (r.target ? `Диверсія вдалася: уражено «${r.target}».` : 'Диверсія відпрацьована.')) : ''); break; }
        case 'workshop': act(Recruit.foundWorkshop(state, pf(), Number(t.dataset.sid)), 'Підпільну майстерню облаштовано.'); break;
        case 'form': { const ty = document.getElementById('formType' + t.dataset.fid); act(Recruit.form(state, pf(), Number(t.dataset.fid), ty ? ty.value : 'inf_squad'), 'Формування розпочато.'); break; }
        case 'resupply': { const r = Logistics.resupply(state, selectedId); act(r, r.ok ? 'Поповнено: ' + r.text : ''); break; }
        case 'load': {
          const uid = Number(t.dataset.uidload);
          const preset = loadSel[uid] || 'ammo';
          const r = Logistics.loadFromStore(state, uid, preset);
          act(r, r.ok ? 'Завантажено: ' + r.text : '');
          break;
        }
        case 'loadItem': {
          const uid = Number(t.dataset.uidload);
          const u2 = Engine.unitById(state, uid);
          const items = u2 ? Logistics.loadableItems(state, u2) : [];
          const selEl = document.querySelector(`[data-itemsel="${uid}"]`);
          const qtyEl = document.querySelector(`[data-itemqty="${uid}"]`);
          const it = selEl ? items[Number(selEl.value)] : null;
          const qty = Math.max(1, Math.floor(Number(qtyEl ? qtyEl.value : 1) || 1));
          const r = it ? Logistics.loadItem(state, uid, it.storeId, it.kind, it.key, qty) : { ok: false, reason: 'Оберіть позицію.' };
          act(r, r.ok ? `Завантажено ×${r.n}.` : '');
          break;
        }
        case 'layWire': act(Field.layWireField(state, selectedId), 'Єгозу встановлено.'); break;
        case 'issue': act(Logistics.issueFromCargo(state, selectedId), 'Запаси видано.'); break;
        case 'unload': { const r = Logistics.unloadToStore(state, selectedId); act(r, r.created ? 'Створено польовий склад.' : 'Розвантажено на склад.'); break; }
        case 'pickup': act(Logistics.pickupWounded(state, selectedId), 'Поранених забрано.'); break;
        case 'destroyFac': {
          const fa = Logistics.byId(state, Number(t.dataset.fid));
          if (fa && !fa.confirmDestroy) { fa.confirmDestroy = true; renderRight(); setTimeout(() => { fa.confirmDestroy = false; }, 6000); break; }
          if (fa) delete fa.confirmDestroy;
          act(Logistics.destroyFacility(state, selectedId, Number(t.dataset.fid)), 'Об’єкт знищено.'); break;
        }
        case 'claimFac': { act(Logistics.claimFacility(state, selectedId, Number(t.dataset.fid)), 'Права на об’єкт заявлено.'); break; }
        case 'loot': { const r = Loot.loot(state, selectedId); act(r, r.ok ? 'Трофеї зібрано: ' + r.text : ''); break; }
        case 'recoverDead': { const r = Loot.recoverDead(state, selectedId); act(r, r.ok ? `Загиблих забрано: ${r.n}.` : ''); break; }
        case 'pmcHire': {
          const storeSel = document.getElementById('pmcStore');
          const r = Foreign.hirePmc(state, pf(), Number(storeSel ? storeSel.value : NaN), t.dataset.item);
          if (!r.ok) toast(r.reason, true); else { toast('Замовлення ПВК відправлено.'); renderAll(); openEconomy(); }
          break;
        }
        case 'dropCargo': act(Loot.dropCargo(state, selectedId), 'Вантаж залишено в гексі.'); break;
        case 'merge': act(Transport.merge(state, selectedId, Number(t.dataset.mid)), 'Підрозділи об’єднано.'); break;
        case 'abandon': { const r = Transport.abandonVehicle(state, selectedId); act(r, 'Екіпаж залишив машину.'); if (r.ok) selectUnit(r.unitId, true); break; }
        case 'discard': mode = null; preview = null; renderAll(); break;
      }
    });
  }

  // ------------------------------------------------------------------ вікна
  function openModal(title, html, onBind) {
    $('modalRoot').innerHTML = `<div class="modal-back" data-close="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h2>${esc(title)}</h2><button type="button" data-close="1">Закрити</button></header>
      <div class="body">${html}</div></div></div>`;
    const back = $('modalRoot').firstChild;
    back.addEventListener('click', e => { if (e.target.dataset.close) closeModal(); });
    if (onBind) onBind(back);
  }
  function closeModal() { $('modalRoot').innerHTML = ''; }

  function loadState(res, source) {
    if (!res.ok) return res;
    try {
      setState(res.state);
      (res.notes || []).forEach(n => toast(n));
      toast(`Завантажено: ${source}, ${Engine.timeLabel(state.time)}.`);
    } catch (e) {
      return { ok: false, errors: ['Помилка відновлення стану: ' + e.message] };
    }
    return { ok: true };
  }

  function openSaves() {
    const draw = () => {
      const slots = SaveSystem.listSlots();
      const fmtDate = t => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const avail = SaveSystem.storageAvailable();
      const html = `
        ${avail ? '' : '<p class="errlist">Сховище браузера недоступне. Використовуйте експорт та імпорт файлу.</p>'}
        <div style="display:flex;flex-direction:column;gap:6px">
        ${slots.map(s => `<div class="slot"><div><strong>${esc(s.name)}</strong><div class="meta">${s.empty ? 'порожньо' : `${esc(Engine.timeLabel(s))} · фаза ${s.phase + 1} · збережено ${fmtDate(s.savedAt)} · ${Math.round(s.bytes / 1024)} КБ`}</div></div>
          <div class="btns">
            ${s.key !== 'auto' ? `<button type="button" data-save="${s.key}" ${avail && state ? '' : 'disabled'}>Зберегти сюди</button>` : ''}
            <button type="button" data-load="${s.key}" ${s.empty ? 'disabled' : ''}>Завантажити</button>
            ${s.empty ? '' : `<button type="button" data-del="${s.key}">Видалити</button>`}
          </div></div>`).join('')}
        </div>
        <div><h3 style="margin:0 0 6px;font-size:13px">Експорт у файл</h3>
          <div class="row"><button type="button" id="btnExport" ${state ? '' : 'disabled'}>Завантажити файл .json</button><button type="button" id="btnCopy" ${state ? '' : 'disabled'}>Скопіювати текст збереження</button></div>
          <p class="notice">Якщо браузер блокує завантаження, скопіюйте текст і збережіть його у файл вручну.</p>
          <textarea id="exportText" readonly hidden></textarea>
        </div>
        <div><h3 style="margin:0 0 6px;font-size:13px">Імпорт</h3>
          <div class="row"><input type="file" id="importFile" accept=".json,application/json"></div>
          <p class="notice">Або вставте текст збереження:</p>
          <textarea id="importText" placeholder="Вставте вміст файлу збереження"></textarea>
          <div class="row"><button type="button" id="btnImportText">Завантажити з тексту</button></div>
          <div id="importErr" class="errlist"></div>
        </div>`;
      openModal('Збереження кампанії', html, root => {
        root.querySelectorAll('[data-save]').forEach(b => b.onclick = () => {
          const r = SaveSystem.saveToSlot(b.dataset.save, state);
          if (r.ok) { toast('Збережено: ' + SaveSystem.slotName(b.dataset.save)); draw(); } else toast(r.reason, true);
        });
        root.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
          const r = loadState(SaveSystem.loadFromSlot(b.dataset.load), SaveSystem.slotName(b.dataset.load));
          if (r.ok) closeModal(); else { $('importErr').innerHTML = r.errors.map(esc).join('<br>'); }
        });
        root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
          if (b.dataset.confirm) { SaveSystem.deleteSlot(b.dataset.del); toast('Слот очищено.'); draw(); }
          else { b.dataset.confirm = '1'; b.textContent = 'Підтвердити видалення'; }
        });
        $('btnExport').onclick = () => {
          const text = SaveSystem.serialize(state);
          try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
            a.download = `yugotaria-d${state.time.day}-${String(state.time.hour).padStart(2, '0')}h.json`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          } catch (e) { /* завантаження заблоковане */ }
          const ta = $('exportText'); ta.hidden = false; ta.value = text;
        };
        $('btnCopy').onclick = () => {
          const text = SaveSystem.serialize(state);
          const ta = $('exportText'); ta.hidden = false; ta.value = text;
          const fallback = () => { ta.select(); toast('Текст виділено — натисніть Ctrl+C.'); };
          try { navigator.clipboard.writeText(text).then(() => toast('Скопійовано в буфер обміну.'), fallback); } catch (e) { fallback(); }
        };
        $('importFile').onchange = e => {
          const f = e.target.files[0]; if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            const r = loadState(SaveSystem.deserialize(rd.result), f.name);
            if (r.ok) closeModal(); else $('importErr').innerHTML = r.errors.map(esc).join('<br>');
          };
          rd.onerror = () => { $('importErr').textContent = 'Не вдалося прочитати файл.'; };
          rd.readAsText(f);
        };
        $('btnImportText').onclick = () => {
          const r = loadState(SaveSystem.deserialize($('importText').value), 'текст');
          if (r.ok) closeModal(); else $('importErr').innerHTML = r.errors.map(esc).join('<br>');
        };
      });
    };
    draw();
  }

  // ---------------------------------------------------------- головне меню
  // Новий бій: хто керує кожною фракцією (людина / бот легкий / бот важкий) і номер карти.
  const menuSel = ['human', 'easy', 'easy'];
  function openMainMenu() {
    const el = $('mainmenu');
    const inGame = !!state;
    const auto = SaveSystem.listSlots().find(x => x.key === 'auto');
    const canContinue = !inGame && auto && !auto.empty;
    const opt = (k, v, n) => `<option value="${v}"${menuSel[k] === v ? ' selected' : ''}>${n}</option>`;
    el.hidden = false;
    el.innerHTML = `<div class="mm-card" role="dialog" aria-modal="true" aria-labelledby="mmTitle">
      <h1 id="mmTitle">Юготарія<small>Громадянська війна</small></h1>
      <div class="mm-actions">
        ${inGame ? '<button type="button" id="mmResume">Повернутися до гри</button>' : ''}
        ${canContinue ? `<button type="button" id="mmContinue">Продовжити · ${esc(Engine.timeLabel(auto))}</button>` : ''}
        <button type="button" id="mmLoad">Завантажити збереження</button>
        <button type="button" id="mmHelp">Довідка</button>
      </div>
      <section class="mm-new">
        <h2>Нова кампанія</h2>
        <p class="notice">Оберіть, хто керує кожною стороною. Боти бачать лише те, що бачить їхня розвідка. Якщо людей кілька — гра «гаряче місце» з екраном передачі ходу; якщо жодної — ви спостерігаєте за ботами.</p>
        <div class="mm-sides">
          ${[0, 1, 2].map(k => `<label class="mm-side"><span class="dot" style="background:${FC[k]}"></span><span class="nm">${esc(CONFIG.factions[k].name)}</span>
            <select data-side="${k}" aria-label="Хто керує: ${esc(CONFIG.factions[k].name)}">${opt(k, 'human', 'Людина')}${opt(k, 'easy', 'Бот — легкий')}${opt(k, 'hard', 'Бот — важкий')}</select></label>`).join('')}
        </div>
        <div class="row"><label for="seedInput">Номер карти</label><input type="number" id="seedInput" value="1999" min="1" max="999999">
          <span class="notice">Однаковий номер — однакова карта.</span></div>
        ${inGame ? '<p class="notice warn">Поточна кампанія буде замінена — збережіть її, якщо потрібно.</p>' : ''}
        <div class="row"><button type="button" class="primary" id="btnStart">Почати кампанію</button><span class="notice" id="mmSummary"></span></div>
      </section>
    </div>`;
    const summary = () => {
      const h = menuSel.filter(x => x === 'human').length;
      $('mmSummary').textContent = h === 0 ? 'Режим глядача: усі сторони — боти.' : h === 1 ? 'Одна людина проти ботів.' : `Гаряче місце: ${h} гравці${menuSel.some(x => x !== 'human') ? ' і боти' : ''}.`;
    };
    el.querySelectorAll('[data-side]').forEach(sel => sel.onchange = () => { menuSel[Number(sel.dataset.side)] = sel.value; summary(); });
    summary();
    $('btnStart').onclick = () => {
      const seed = Math.max(1, Math.min(999999, parseInt($('seedInput').value, 10) || 1999));
      const s = Engine.newGame(seed);
      AI.configure(s, menuSel.slice());
      spectator.paused = false;
      setState(s);
    };
    if ($('mmResume')) $('mmResume').onclick = closeMainMenu;
    if ($('mmContinue')) $('mmContinue').onclick = () => {
      const r = loadState(SaveSystem.loadFromSlot('auto'), 'автозбереження');
      if (!r.ok) toast(r.errors.join(' '), true);
    };
    $('mmLoad').onclick = openSaves;
    $('mmHelp').onclick = openHelp;
    setTimeout(() => { const b = $('btnStart'); if (b && !inGame) b.focus(); }, 0);
  }
  function closeMainMenu() {
    const el = $('mainmenu');
    if (!el || el.hidden) return;
    if (!state) return;   // без гри меню не закривається
    el.hidden = true; el.innerHTML = '';
  }

  let polTab = 'pop';
  // Рішення (фокуси): картки з умовами, ціною, тривалістю й станом
  function decisionsHtml(f) {
    const items = Decisions.list(state, f);
    const can = commandable();
    const act = Decisions.state(state).active[f];
    const STATUS = { available: 'Доступне', active: 'Виконується', done: 'Виконано', locked: 'Умови не виконано', excluded: 'Обрано інший шлях' };
    const card = d => `<div class="dec ${d.status}">
      <div class="dec-head"><b>${esc(d.name)}</b><span class="dec-st">${STATUS[d.status]}${d.note ? ` · ${esc(d.note)}` : ''}</span></div>
      <p>${esc(d.desc)}</p>
      ${d.reqs.length ? `<ul class="dec-req">${d.reqs.map(r => `<li class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'} ${esc(r.text)}</li>`).join('')}</ul>` : ''}
      <div class="dec-foot"><span>${d.cost ? `${d.cost} грн` : 'без коштів'} · ${d.hours} год</span>
        ${d.status === 'available' ? `<button type="button" class="primary mini" data-dec="${d.id}" ${can && !act ? '' : `disabled title="${esc(!can ? 'Не ваш хід' : 'Уже виконується інше рішення')}"`}>Розпочати</button>` : ''}
        ${d.status === 'active' ? `<button type="button" class="mini" data-dec="__cancel" ${can ? '' : 'disabled'}>Скасувати</button>` : ''}
      </div></div>`;
    return `<p class="notice">Рішення — курс вашої сторони. Одночасно виконується одне; гроші сплачуються на початку, наслідки — після завершення. Частина рішень взаємовиключні.</p>
      <div class="dec-list">${items.map(card).join('')}</div>`;
  }
  const formSel = {};
  function openPolitics(tab) {
    if (handover || !state) return;
    if (tab) polTab = tab;
    const f = pf();
    const P = CONFIG.population;
    const decAct = Decisions.state(state).active[f];
    const tabs = [['pop', 'Населення'], ['dip', 'Дипломатія' + (Politics.incoming(state, f).length ? ` (${Politics.incoming(state, f).length})` : '')], ['dec', 'Рішення' + (decAct ? ' ●' : '')], ['goals', 'Цілі'], ['events', 'Події']];
    if (state.campaign.over) tabs.push(['chron', 'Хроніка']);
    let body = '';
    if (polTab === 'pop') {
      body = `<p class="notice">Підтримка груп населення: ${[0, 1, 2].map(k => ABBR[k]).join(' / ')}. Вона впливає на доходи й мобілізацію, дає донесення про противника (від ${P.informersAbove}%), а при низькій підтримці — протести (&lt;${P.protestBelow}%), страйки (&lt;${P.strikeBelow}%) і саботаж.</p>
      <div class="tablewrap"><table><thead><tr><th>Пункт</th><th>Контроль</th><th>Населення</th><th>Підтримка</th><th>Настрої</th><th>Цив. жертви</th><th>Біженці</th></tr></thead><tbody>
      ${state.map.settlements.map(s => `<tr><td>${esc(s.name)}</td><td>${s.control >= 0 ? `<span class="dot" style="background:${FC[s.control]}"></span>${ABBR[s.control]}` : '—'}</td>
        <td class="n">${Politics.totalPop(s).toLocaleString('uk-UA')}</td><td>${supBar(s)}<small class="muted">${[0, 1, 2].map(k => Math.round(Politics.support(s, k))).join(' / ')}</small></td>
        <td>${{ none: '—', protest: 'протести', strike: 'страйк' }[s.unrest]}</td><td class="n">${s.civKilled + s.civWounded}</td><td class="n">${s.refugees.toLocaleString('uk-UA')}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="notice">Загальна підтримка: ${[0, 1, 2].map(k => `${esc(CONFIG.factions[k].short)} ${Math.round(Politics.nationalSupport(state, k))}%`).join(' · ')}. Серед юготарів: ${[0, 1, 2].map(k => `${ABBR[k]} ${Math.round(Politics.groupSupport(state, k, 'yug'))}%`).join(' · ')}.</p>`;
    } else if (polTab === 'dip') {
      const others = [0, 1, 2].filter(x => x !== f);
      const inc = Politics.incoming(state, f);
      const D = CONFIG.diplomacy;
      body = `<div class="eco-grid">${others.map(o => {
          const r = Politics.rel(state, f, o);
          const ag = r.agreements.map(a => `${Politics.TYPES[a.type].name}${a.until != null ? ` (${a.until - state.time.turn} год)` : ''}`).join(', ') || 'угод немає';
          return `<div class="eco-tile"><span>${esc(CONFIG.factions[o].name)}</span><b style="color:${FC[o]}">${Politics.statusText(state, f, o)}</b><small>${esc(ag)}</small>${Politics.allied(state, f, o) ? `<div><button type="button" class="mini" data-pol="dissolve" data-o="${o}">Розірвати союз</button></div>` : ''}</div>`;
        }).join('')}
        <div class="eco-tile"><span>Репутація (ваша / ${others.map(o => ABBR[o]).join(' / ')})</span><b>${state.diplomacy.reputation[f]} / ${others.map(o => state.diplomacy.reputation[o]).join(' / ')}</b></div></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Вхідні пропозиції</h3>${inc.length ? inc.map(p => `<div class="prop"><span><span class="dot" style="background:${FC[p.from]}"></span>${esc(CONFIG.factions[p.from].name)}: ${esc(Politics.describe(state, p))} <small class="muted">(${esc(Engine.timeLabel(p))})</small></span><span class="orders"><button type="button" class="primary mini" data-pol="accept" data-id="${p.id}">Прийняти</button><button type="button" class="mini" data-pol="reject" data-id="${p.id}">Відхилити</button></span></div>`).join('') : '<p class="notice">Немає.</p>'}</div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Нова пропозиція</h3>
        <div class="form-row">
          <label for="dipTo">Кому</label><select id="dipTo">${others.map(o => `<option value="${o}">${esc(CONFIG.factions[o].name)}</option>`).join('')}</select>
          <label for="dipType">Угода</label><select id="dipType">${Object.entries(Politics.TYPES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('')}</select>
          <label for="dipSet">Пункт</label><select id="dipSet">${state.map.settlements.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select>
          <label for="dipGiver">Передає</label><select id="dipGiver"><option value="self">ми</option><option value="other">вони</option></select>
          <button type="button" class="primary" data-pol="send">Надіслати</button>
        </div>
        <p class="notice">Отримувач відповідає у своїй фазі; без відповіді пропозиція згорає за ${D.proposalTTL} год. Перемир’я — ${D.ceasefireHours} год; коридор — ${D.corridorHours} год; союз — лише після перемир’я. Атака попри перемир’я, союз чи коридор — порушення: репутація −${D.breakReputation}, підтримка −${D.breakSupport}. Пункт потрібен для коридору та передачі території.</p>
        <ul class="list" style="margin-top:6px">${Object.values(Politics.TYPES).map(t => `<li><span>${esc(t.name)}</span><span class="muted" style="font-family:var(--font-ui)">${esc(t.desc)}</span></li>`).join('')}</ul>
      </div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Історія</h3>${state.diplomacy.history.length ? `<ul>${state.diplomacy.history.slice(-12).reverse().map(h => `<li>${esc(Engine.timeLabel(h))}: ${esc(h.text)}</li>`).join('')}</ul>` : '<p class="notice">Угод ще не було.</p>'}</div>`;
    } else if (polTab === 'dec') {
      body = decisionsHtml(f);
    } else if (polTab === 'goals') {
      const sc = Politics.scores(state);
      const mine = sc[f];
      const settled = state.map.settlements.filter(s => s.pop);
      body = `<div class="eco-grid">${[0, 1, 2].map(k => `<div class="eco-tile"><span>${esc(CONFIG.factions[k].short)}</span><b style="color:${FC[k]}">${settled.filter(s => s.control === k).length} / ${settled.length}</b></div>`).join('')}</div>
        <div><h3 style="margin:0 0 6px;font-size:13px">Орієнтовні цілі (не вирішують переможця — лише для довідки)</h3><div class="tablewrap"><table><tbody>${mine.list.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${Math.round(x.got)} / ${x.o.points}</td></tr>`).join('')}</tbody></table></div></div>
        <p class="notice">Перемога: <b>військова</b> — супротивники без боєздатних підрозділів (знищені або капітулювали), або <b>територіальна</b> — усі населені пункти карти під вашим контролем. Кампанія триває, доки не станеться одне з цього.</p>`;
    } else if (polTab === 'events') {
      const fired = state.events.filter(e => e.fired);
      body = fired.length ? `<ul>${fired.map(e => `<li><b>${esc(e.name)}</b> (${esc(Engine.timeLabel(e.fired))}): ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="notice">Подій ще не було. Умовні події спрацьовують за часом, контролем, втратами, підтримкою населення та дипломатією.</p>';
      body += `<p class="notice">Ще не сталося: ${state.events.filter(e => !e.fired).length} подій сценарію.</p>`;
    } else if (polTab === 'chron') body = chronicleHtml();
    openModal('Політика', `<div class="ptabs">${tabs.map(([k, n]) => `<button type="button" data-ptab="${k}" aria-pressed="${polTab === k}">${esc(n)}</button>`).join('')}</div>${body}`, root => {
      root.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => openPolitics(b.dataset.ptab));
      root.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => {
        const r = b.dataset.dec === '__cancel' ? Decisions.cancel(state, f) : Decisions.start(state, f, b.dataset.dec);
        if (!r.ok) toast(r.reason, true); else toast(b.dataset.dec === '__cancel' ? 'Рішення скасовано.' : 'Рішення розпочато.');
        renderAll(); openPolitics('dec');
      });
      root.querySelectorAll('[data-pol]').forEach(b => b.onclick = () => {
        let r;
        const k = b.dataset.pol;
        if (k === 'accept' || k === 'reject') r = Politics.respond(state, Number(b.dataset.id), k === 'accept');
        else if (k === 'dissolve') r = Politics.dissolveAlliance(state, f, Number(b.dataset.o));
        else if (k === 'send') {
          const to = Number($('dipTo').value), type = $('dipType').value, sid = Number($('dipSet').value);
          const giver = $('dipGiver').value === 'self' ? f : to;
          r = Politics.propose(state, f, to, type, { settlement: sid, giver });
        }
        if (!r.ok) toast(r.reason, true); else toast(k === 'send' ? 'Пропозицію надіслано.' : k === 'accept' ? 'Угоду укладено.' : k === 'reject' ? 'Пропозицію відхилено.' : 'Союз розірвано.');
        Intel.update(state);
        renderAll();
        openPolitics();
      });
    });
    const md = $('modalRoot').querySelector('.modal'); if (md) md.classList.add('wide');
  }

  function chronicleHtml() {
    const c = state.campaign, ch = c.chronicle;
    if (!ch) return '<p class="notice">Хроніка з’явиться після завершення кампанії.</p>';
    return `<div class="result-banner"><b>${c.winner != null ? esc(CONFIG.factions[c.winner].name) + ' перемагає.' : 'Нічия.'}</b> ${esc(c.reason)} <small class="muted">(${esc(ch.time)})</small></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Сторони</h3><div class="tablewrap"><table><thead><tr><th>Фракція</th><th>Очки</th><th>Загиблі</th><th>Поранені</th><th>Полонені / зниклі</th><th>Тримає в полоні</th><th>Підтримка</th><th>Кошти</th><th>Об’єкти</th></tr></thead><tbody>
      ${ch.factions.map((x, k) => `<tr><td><span class="dot" style="background:${FC[k]}"></span>${esc(x.name)}</td><td class="n">${x.score}</td><td class="n">${x.killed + x.deadOfWounds}</td><td class="n">${x.wounded}</td><td class="n">${x.captured} / ${x.missing}</td><td class="n">${x.prisonersHeld}</td><td class="n">${x.support}%</td><td class="n">${x.money.toLocaleString('uk-UA')}</td><td class="n">${x.facilities}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Доля населених пунктів</h3><div class="tablewrap"><table><thead><tr><th>Пункт</th><th>Контроль</th><th>Населення</th><th>Цивільні жертви</th><th>Біженці</th><th>Житло</th><th>Підтримка</th></tr></thead><tbody>
      ${ch.towns.map(t => `<tr><td>${esc(t.name)}</td><td>${t.control >= 0 ? ABBR[t.control] : '—'}</td><td class="n">${t.pop0.toLocaleString('uk-UA')} → ${t.pop.toLocaleString('uk-UA')}</td><td class="n">${t.civKilled} / ${t.civWounded}</td><td class="n">${t.refugees.toLocaleString('uk-UA')}</td><td class="n">${t.housing >= 1 ? '−' + Math.round(t.housing) + '%' : 'ціле'}</td><td>${t.support.join(' / ')}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Дипломатія й події</h3><ul>${ch.history.map(h => `<li>${esc(Engine.timeLabel(h))}: ${esc(h.text)}</li>`).join('')}${ch.events.map(e => `<li>${esc(Engine.timeLabel(e.when))}: подія «${esc(e.name)}»</li>`).join('')}</ul></div>`;
  }
  function openChronicle() { openPolitics('chron'); }

  // Чорний ринок (повстанці)
  function blackMarketHtml(f) {
    return `      <div><h3 style="margin:0 0 6px;font-size:13px">Чорний ринок</h3>
        <div class="form-row">
          <label for="bmItem">Товар</label><select id="bmItem">${Object.entries(CONFIG.blackMarket.items).map(([k, it]) => `<option value="${esc(k)}">${esc(Recruit.itemName(k))} — ${it.n} ${esc(Recruit.itemUnit(k))} за ${it.price} грн</option>`).join('')}</select>
          <label for="bmQty">Партій</label><input type="number" id="bmQty" value="1" min="1" max="20" style="width:70px;padding:4px 6px;background:var(--bg);border:1px solid var(--line)">
          <label for="bmStore">Доставка</label><select id="bmStore">${Logistics.facilities(state).filter(x => Logistics.isStore(x) && x.owner === f && !x.destroyed).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
          <button type="button" class="primary" id="bmBuy">Замовити</button>
        </div>
        <p class="notice">Оплата одразу, доставка через ${CONFIG.blackMarket.deliveryHours} год. Якщо склад доставки втратите — партія пропаде.</p>
        ${Recruit.orders(state).filter(o => o.faction === f).length ? `<ul class="list">${Recruit.orders(state).filter(o => o.faction === f).map(o => `<li><span>${esc(Recruit.itemName(o.key))} — ${o.n} ${esc(Recruit.itemUnit(o.key))}</span><span>прибуде о ${esc(Engine.timeLabel(Engine.addHours(state.time, o.arrive - state.time.turn)))}</span></li>`).join('')}</ul>` : ''}
      </div>`;
  }
  // Аеропорт і БПЛА (ДП)
  function airHtml(f) {
    const ap = Air.airport(state, f), ar = Air.airportReason(state, f), u = Air.uav(state, f), U = CONFIG.air.uav;
    const why = Air.uavReason(state, f, null);
    return `<div><h3 style="margin:0 0 6px;font-size:13px">${esc(ap.name)} і повітряна розвідка</h3>
      <p class="notice">Аеропорт (${esc(Engine.grid(state).label(ap.idx))}): ${ar ? `<span style="color:var(--bad)">${esc(ar)}</span>` : `працює — ПВК і закупівлі прибувають удвічі швидше вантажними рейсами`}.</p>
      ${u.unlocked ? `<div class="form-row"><button type="button" class="primary" id="uavGo" ${why ? `disabled title="${esc(why)}"` : ''}>Виліт ${esc(U.name)}</button>
        <span class="notice">Апаратів: ${u.airframes}. ${why ? esc(why) : `Готовий. Радіус спостереження ${U.radius} гекс. до кінця години, вночі не літає, базовий ризик втрати ${U.lossBase}% (більше біля ворожих «Утьосів»).`}</span></div>`
        : `<p class="notice">${esc(U.name)} — після рішення «Повітряна розвідка НАТО» (Політика → Рішення).</p>`}
    </div>`;
  }
  // Іноземні інвестиції (повстанці): гроші від спонсора; може відмовити, сума й шанс — за стосунками
  function investHtml(f) {
    const I = CONFIG.geopolitics.investment;
    const left = Foreign.investCooldownLeft(state, f);
    const pend = Foreign.investOrders(state).filter(o => o.faction === f);
    return `<div><h3 style="margin:0 0 6px;font-size:13px">Іноземні інвестиції — ${esc(Foreign.sponsor(f).name)}</h3>
      <div class="form-row"><button type="button" class="primary" id="invReq" ${left > 0 ? 'disabled' : ''}>Подати заявку (≈${Foreign.investAmount(state, f)} грн)</button></div>
      <p class="notice">Шанс схвалення ${Math.round(Foreign.investChance(state, f))}%, сума ${Foreign.investAmount(state, f)} грн (обидва залежать від стосунків). Гроші надходять через ${I.deliveryHours} год. Заявка — раз на ${I.cooldownHours} год${left > 0 ? ` (наступна через ${left} год)` : ''}.</p>
      ${pend.length ? `<ul class="list">${pend.map(o => `<li><span>${o.amount} грн</span><span>надійде через ${Math.max(0, o.arrive - state.time.turn)} год</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }
  // Торгівля з РФ (соц. влада): закупівля — офіційні запити (РФ може відмовити); продаж нафти,
  // пального й продукції заводів через перехід «Росія».
  function rfTradeHtml(f) {
    const stores = Logistics.facilities(state).filter(x => Logistics.isStore(x) && x.owner === f && !x.destroyed);
    const OS = CONFIG.officialSupply, RT = CONFIG.russiaTrade;
    const fmt = n => Math.round(n).toLocaleString('uk-UA');
    // порядок у списках: майно (нафта, пальне…) → боєприпаси → зброя
    const KO = { goods: 0, ammo: 1, weapons: 2 };
    const sorted = items => Object.entries(items).sort((a, b) => KO[a[1].kind] - KO[b[1].kind]);
    const unit = k => CONFIG.ammo[k] ? 'шт.' : CONFIG.goods[k] ? CONFIG.goods[k].unit : 'шт.';
    const offLeft = Foreign.officialCooldownLeft(state, f), saleLeft = Foreign.saleCooldownLeft(state, f);
    const border = Foreign.borderReason(state, f, null);
    const orders = Foreign.officialOrders(state).filter(o => o.faction === f);
    const sales = Foreign.saleOrders(state).filter(o => o.faction === f);
    const t = state.time.turn;
    return `<div><h3 style="margin:0 0 6px;font-size:13px">Торгівля з РФ — через ${esc(Foreign.entryName(state, f))}</h3>
      ${border ? `<p class="notice" style="color:var(--bad)">${esc(border)}</p>` : ''}
      <h4 style="margin:6px 0 4px;font-size:12.5px">Закупівля (офіційний запит)</h4>
      <div class="form-row">
        <label for="rfBuyItem">Товар</label><select id="rfBuyItem">${sorted(OS.items).map(([k, it]) => `<option value="${esc(k)}">${esc(Foreign.officialItemName(k))} — ${it.n} ${esc(unit(k))} за ${it.price} грн</option>`).join('')}</select>
        <label for="rfBuyQty">Партій</label><input type="number" id="rfBuyQty" value="1" min="1" max="20" style="width:70px;padding:4px 6px;background:var(--bg);border:1px solid var(--line)">
        <label for="rfBuyStore">Доставка</label><select id="rfBuyStore">${stores.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
        <button type="button" class="primary" id="rfBuy" ${offLeft > 0 ? 'disabled' : ''}>Надіслати запит</button>
      </div>
      <p class="notice">РФ схвалює запит із шансом ${Math.round(Foreign.officialChance(state, f))}% (залежить від стосунків). Оплата лише за схвалену партію, доставка за ${OS.deliveryHours} год, запит — раз на ${OS.cooldownHours} год${offLeft > 0 ? ` (наступний через ${offLeft} год)` : ''}.</p>
      ${orders.length ? `<ul class="list">${orders.map(o => `<li><span>${esc(Foreign.officialItemName(o.key))} ×${o.n}</span><span>прибуде через ${Math.max(0, o.arrive - t)} год</span></li>`).join('')}</ul>` : ''}
      <h4 style="margin:10px 0 4px;font-size:12.5px">Продаж (експорт)</h4>
      <div class="form-row">
        <label for="rfSellItem">Товар</label><select id="rfSellItem">${sorted(RT.items).map(([k, it]) => `<option value="${esc(k)}">${esc(Foreign.officialItemName(k))} — ${it.n} ${esc(unit(k))} за ${Foreign.salePrice(state, f, k)} грн (є ${fmt(Foreign.saleAvailable(state, f, k))})</option>`).join('')}</select>
        <label for="rfSellQty">Партій</label><input type="number" id="rfSellQty" value="1" min="1" max="${RT.maxBatches}" style="width:70px;padding:4px 6px;background:var(--bg);border:1px solid var(--line)">
        <button type="button" class="primary" id="rfSell" ${saleLeft > 0 || border ? 'disabled' : ''}>Продати</button>
      </div>
      <p class="notice">Товар береться з ваших складів, НПЗ і нафтового термінала, пов’язаних своєю територією з переходом. Гроші — коли партія перетне кордон (≈${RT.deliveryHours} год); якщо перехід втратите раніше — партія пропаде. Ціна ×${Engine.fmt(Foreign.salePriceMult(state, f))} від базової (залежить від стосунків). Партія на експорт — раз на ${RT.cooldownHours} год${saleLeft > 0 ? ` (наступна через ${saleLeft} год)` : ''}.</p>
      ${sales.length ? `<ul class="list">${sales.map(o => `<li><span>${esc(Foreign.officialItemName(o.key))} ×${o.n} → ${o.price} грн</span><span>на кордоні через ${Math.max(0, o.arrive - t)} год</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function openEconomy() {
    if (handover) return;
    const f = pf();
    const S = Logistics.summary(state, f);
    const fmt = n => Math.round(n).toLocaleString('uk-UA');
    const st = S.total;
    const list = (o, name) => Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `<tr><td>${esc(name(k))}</td><td class="n">${fmt(n)}</td></tr>`).join('');
    const prod = S.prod.map(p => `<tr><td>${esc(p.f.name)}</td><td>${p.working ? (p.offline > 0 ? `простій ${p.offline} год` : 'працює') : 'зупинено (немає контролю або зруйновано)'}</td><td class="n">${p.f.condition}%</td><td class="n">${p.def.cost}</td></tr>`).join('');
    // Рішення автора (запит гравця): жива статистика втрат, доступна будь-коли, а не лише в
    // підсумку кампанії — хто кому скільки завдав, скільки взято в полон і скільки своїх
    // загиблих лишається не забраними з поля.
    const enemies = [0, 1, 2].filter(x => x !== f);
    const lossRows = enemies.map(o => `<tr><td>${esc(CONFIG.factions[o].name)}</td><td class="n">${state.stats.killedOf[f][o]}</td><td class="n">${state.stats.woundedOf[f][o]}</td><td class="n">${state.stats.killedOf[o][f]}</td><td class="n">${state.stats.woundedOf[o][f]}</td></tr>`).join('');
    const prisHeld = state.prisoners.filter(p => p.holder === f).reduce((a, p) => a + p.count, 0);
    const prisLost = state.prisoners.filter(p => p.origin === f).reduce((a, p) => a + p.count, 0);
    const uncollected = Object.values(Loot.caches(state)).reduce((a, c) => a + ((c.dead && c.dead[f]) || 0), 0);
    openModal(`Економіка — ${CONFIG.factions[f].name}`, `
      <div class="eco-grid">
        <div class="eco-tile"><span>Кошти</span><b>${fmt(S.eco.money)}</b></div>
        <div class="eco-tile"><span>Доходи / год</span><b>+${fmt(S.income)}</b></div>
        <div class="eco-tile"><span>Витрати / год</span><b>−${fmt(S.expense)}</b></div>
        <div class="eco-tile"><span>Резерв людей</span><b>${fmt(S.eco.manpower)}</b></div>
        <div class="eco-tile"><span>Поранені / у шпиталях</span><b>${S.wounded} / ${S.patients}</b></div>
        <div class="eco-tile"><span>У зоні постачання</span><b>${S.inSupply} / ${S.units}</b></div>
      </div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Прогноз коштів на 6 годин</h3><p class="notice" style="font-size:13px">${S.forecast.map((m, k) => `+${k + 1} год: ${fmt(m)}`).join(' · ')}. Поповнення людьми коштує ${CONFIG.economy.recruitCost} за бійця.</p></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Підприємства</h3><div class="tablewrap"><table><thead><tr><th>Об’єкт</th><th>Робота</th><th>Стан</th><th>Витр./год</th></tr></thead><tbody>${prod || '<tr><td colspan="4">Немає підприємств</td></tr>'}</tbody></table></div></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Запаси на всіх своїх об’єктах</h3><div class="tablewrap"><table><tbody>
        ${list(st.ammo, k => CONFIG.ammo[k].name)}${list(st.weapons, k => k)}${list(st.goods, k => CONFIG.goods[k].name + ', ' + CONFIG.goods[k].unit)}
      </tbody></table></div></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Втрати (станом на зараз)</h3><div class="tablewrap"><table><thead><tr><th>Супротивник</th><th>Ми вбили</th><th>Ми ранили</th><th>Вони вбили</th><th>Вони ранили</th></tr></thead><tbody>
        ${lossRows}
      </tbody></table></div>
      <p class="notice">У полоні тримаємо: ${fmt(prisHeld)} чол. Наших у полоні: ${fmt(prisLost)} чол.${uncollected > 0 ? ` Непоховані тіла своїх у полі (тиснуть на мораль, поки не забрані): ${fmt(uncollected)}.` : ''}</p></div>
      ${f === 0 ? rfTradeHtml(f) : blackMarketHtml(f)}
      <div><h3 style="margin:0 0 6px;font-size:13px">Геополітика</h3>
        <p class="notice">Прикордонний перехід: <b>${esc(Foreign.entryName(state, f))}</b> (${esc(Engine.grid(state).label(Foreign.entryIdx(state, f)))})${(() => { const br = Foreign.borderReason(state, f, null); return br ? ` — <span style="color:#b3261e">${esc(br)}</span>` : ' — відкритий.'; })()} Стосунки зі спонсором (<b>${esc(Foreign.sponsor(f).name)}</b>): <b>${Math.round(Foreign.geo(state, f))}%</b> — впливають на ціни, шанси й кулдауни нижче.</p>
      </div>
      <div><h3 style="margin:0 0 6px;font-size:13px">ПВК — «${esc(Foreign.patron(f).name)}»</h3>
        ${(() => { const left = Foreign.pmcCooldownLeft(state, f); return left > 0 ? `<p class="notice">Найняти знову можна через ${left} год.</p>` : ''; })()}
        <div class="form-row">
          <label for="pmcStore">Прибуття</label><select id="pmcStore">${Logistics.facilities(state).filter(x => Logistics.isStore(x) && x.owner === f && !x.destroyed).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
        </div>
        <p class="notice">Замовлення (ціна залежить від стосунків із патроном, раз на ${CONFIG.geopolitics.pmc.cooldownHours} год — обирайте, що саме прибуде, під час самого заклику):</p>
        ${(() => {
          const defStore = Logistics.facilities(state).find(x => Logistics.isStore(x) && x.owner === f && !x.destroyed);
          return `<div class="orders">
          ${Object.entries(Foreign.pmcItems(f)).map(([key, item]) => { const w = Foreign.pmcReason(state, f, defStore, key); return `<button type="button" class="mini" data-act="pmcHire" data-item="${key}" ${w ? `disabled title="${esc(w)}"` : ''}>${esc(item.label)} (${Foreign.pmcPrice(state, f, key)} грн)</button>`; }).join('')}
          </div>`;
        })()}
        <p class="notice">Прибуває за ${CONFIG.geopolitics.pmc.deliveryHours} год на обраний склад, одразу з досвідом «${esc(CONFIG.experience[CONFIG.geopolitics.pmc.experience])}» й мораллю ${CONFIG.geopolitics.pmc.morale}${Foreign.patron(f).ammo ? `; піхотний взвод додатково привозить ${esc(CONFIG.ammo[Foreign.patron(f).ammo.key].name)} ×${Foreign.patron(f).ammo.n}` : ''}. Видима присутність ПВК щоразу підриває підтримку групи «${Foreign.patron(f).penaltyGroup === 'yug' ? 'юготарці' : Foreign.patron(f).penaltyGroup === 'rus' ? 'росіяни' : 'кавказці'}» у всіх ваших пунктах (−${CONFIG.geopolitics.pmc.supportPenalty}%), але покращує стосунки з патроном.</p>
        ${Foreign.queue(state).filter(o => o.faction === f && o.kind === 'pmc').length ? `<ul class="list">${Foreign.queue(state).filter(o => o.faction === f && o.kind === 'pmc').map(o => `<li><span>${esc(o.itemLabel || 'ПВК')} від «${esc(Foreign.patron(f).name)}»</span><span>прибуде о ${esc(Engine.timeLabel(Engine.addHours(state.time, o.arrive - state.time.turn)))}</span></li>`).join('')}</ul>` : ''}
      </div>
      ${f !== 0 ? investHtml(f) : ''}
      ${Air.airport(state, f) ? airHtml(f) : ''}
      <div><h3 style="margin:0 0 6px;font-size:13px">Добровольці — ${esc(Foreign.sponsor(f).volunteers.toLowerCase())}</h3>
        ${(() => { const left = Foreign.volCooldownLeft(state, f); return left > 0 ? `<p class="notice">Заклик знову можливий через ${left} год.</p>` : ''; })()}
        <div class="form-row">
          <button type="button" class="primary" id="volCall">Закликати добровольців${Foreign.volCost(state, f) > 0 ? ` (${Foreign.volCost(state, f)} грн)` : ' (безкоштовно)'}</button>
        </div>
        <p class="notice">Прибудуть на прикордонний перехід через ${CONFIG.geopolitics.volunteers.deliveryHours} год, недосвідчені, без політичної ціни. Звільнення населеного пункту, що був під ворогом, само по собі викликає безкоштовну хвилю добровольців і підтримки — закликати додатково не потрібно. Кулдаун і ціна спроби залежать від стосунків із патроном.</p>
        ${Foreign.queue(state).filter(o => o.faction === f && o.kind === 'volunteers').length ? `<ul class="list">${Foreign.queue(state).filter(o => o.faction === f && o.kind === 'volunteers').map(o => `<li><span>${esc(o.why || 'Добровольці')}</span><span>прибудуть о ${esc(Engine.timeLabel(Engine.addHours(state.time, o.arrive - state.time.turn)))}</span></li>`).join('')}</ul>` : ''}
      </div>
      <p class="notice">Доходи враховують підтримку населення та страйки. Загинули від ран: ${S.eco.deadOfWounds}. Одужали й повернулися в резерв: ${S.eco.recovered}. Доходи дають підконтрольні місто (${CONFIG.economy.income.city}/год) і села (${CONFIG.economy.income.village}/год).</p>`, root => {
      const rb = root.querySelector('#rfBuy');
      if (rb) rb.onclick = () => {
        const r = Foreign.officialRequest(state, f, $('rfBuyItem').value, Math.floor(Number($('rfBuyQty').value) || 1), Number($('rfBuyStore').value));
        if (!r.ok) toast(r.reason, true); else { toast(r.approved ? 'Запит схвалено — партію в дорозі.' : 'РФ відхилила запит.', !r.approved); renderAll(); openEconomy(); }
      };
      const rs = root.querySelector('#rfSell');
      if (rs) rs.onclick = () => {
        const r = Foreign.sellRF(state, f, $('rfSellItem').value, Math.floor(Number($('rfSellQty').value) || 1));
        if (!r.ok) toast(r.reason, true); else { toast(`Партія вирушила до кордону — оплата ${r.price} грн після доставки.`); renderAll(); openEconomy(); }
      };
      const b = root.querySelector('#bmBuy');
      if (b) b.onclick = () => {
        const r = Recruit.buy(state, f, $('bmItem').value, Math.floor(Number($('bmQty').value) || 1), Number($('bmStore').value));
        if (!r.ok) toast(r.reason, true); else { toast('Замовлено.'); renderAll(); openEconomy(); }
      };
      const ug = root.querySelector('#uavGo');
      if (ug) ug.onclick = () => { closeModal(); resetSelection(); mode = 'uav'; renderAll(); };
      const ib = root.querySelector('#invReq');
      if (ib) ib.onclick = () => {
        const r = Foreign.requestInvestment(state, f);
        if (!r.ok) toast(r.reason, true); else { toast(r.approved ? `Інвестиції схвалено: ${r.amount} грн надійде через ${CONFIG.geopolitics.investment.deliveryHours} год.` : 'Заявку на інвестиції відхилено.', !r.approved); renderAll(); openEconomy(); }
      };
      const vb = root.querySelector('#volCall');
      if (vb) vb.onclick = () => {
        const r = Foreign.callVolunteers(state, f);
        if (!r.ok) toast(r.reason, true); else { toast('Заклик надіслано.'); renderAll(); openEconomy(); }
      };
    });
    const md = $('modalRoot').querySelector('.modal'); if (md) md.classList.add('wide');
  }

  function openHelp() {
    const fmt = Engine.fmt;
    const rows = CONFIG.terrain.map(t => `<tr><td>${esc(t.name)}</td>${['foot', 'wheeled', 'tracked'].map(c => `<td class="n">${CONFIG.moveCost[c][t.key] == null ? '—' : fmt(CONFIG.moveCost[c][t.key])}</td>`).join('')}<td class="n">${Math.round((CONFIG.combat.cover[t.key] || 0) * 100)}%</td><td class="n">${CONFIG.detection.concealment[t.key] || 0}</td></tr>`).join('');
    const roads = ['roadDirt', 'roadAsphalt'].map(k => `<tr><td>${k === 'roadDirt' ? 'Ґрунтова дорога' : 'Асфальтована дорога'}</td>${['foot', 'wheeled', 'tracked'].map(c => `<td class="n">${fmt(CONFIG.moveCost[c][k])}</td>`).join('')}<td></td><td></td></tr>`).join('');
    const units = Object.values(CONFIG.unitTypes).map(u => `<tr><td>${esc(u.name)}</td><td class="n">${u.personnel}</td><td>${esc(CONFIG.moveClassNames[u.move])}</td><td class="n">${u.mp}</td></tr>`).join('');
    const weapons = Object.entries(CONFIG.weapons).map(([n, w]) => `<tr><td>${esc(n)}</td><td class="n">${w.range}</td><td class="n">${w.accuracy}</td><td class="n">${w.fp}</td><td class="n">${w.at}</td><td class="n">${w.ammoPerHour}</td><td>${esc(w.spec)}</td></tr>`).join('');
    const C = CONFIG.combat, Dt = CONFIG.detection;
    openModal('Довідка та параметри', `
      <div><h3 style="margin:0 0 6px;font-size:13px">Боти</h3><ul>
        <li>У меню (кнопка «Меню») для кожної фракції обирається, хто нею керує: людина, легкий або важкий бот.</li>
        <li><b>Легкий</b> іде до найближчого чужого пункту й стріляє в першого видимого ворога, не зважаючи на співвідношення сил.</li>
        <li><b>Важкий</b> тримає центри своїх пунктів, вибиває ворога зі своїх пунктів, розподіляє ударні сили між цілями й не кидає їх туди-сюди, зосереджує вогонь, відводить зламані підрозділи, поповнює боєприпаси, підвозить піхоту машинами, формує нові підрозділи й відповідає на дипломатичні пропозиції.</li>
        <li>Обидва чесні: бачать лише те, що бачить їхня розвідка, і віддають ті самі накази, що й гравець.</li>
        <li>Одна людина проти ботів — боти ходять одразу, а картка «Ваш хід» показує, що ви помітили за цей час. Без людей — режим глядача з паузою, кроком, темпом і вибором, чиїми очима дивитися.</li>
      </ul></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Як грати</h3><ol>
        <li>Фази: Соціалістична влада → Демократичні повстанці → Націоналістичні повстанці → завершення години. Між фазами карта ховається — передайте пристрій наступному гравцю.</li>
        <li>Кожна фракція бачить лише свої підрозділи, противника в полі зору та застарілі позначки «?» з віком даних.</li>
        <li><b>Рух</b>: оберіть кінцевий гекс, перевірте маршрут і ризики, підтвердьте. Якщо по дорозі виявлено нового противника, рух зупиняється.</li>
        <li><b>Атака</b>: оберіть ціль, обведену червоним, та інтенсивність вогню. Бій розраховується одразу, звіт пояснює всі 6 кроків. Атака забирає решту години, для неї потрібно ≥${C.attackMinMp * 100}% очок руху.</li>
        <li><b>Оборона</b>: щогодини на місці +1 рівень позицій (до ${C.fortMax}), кожен +${C.fortCoverPerLevel * 100}% укриття; обладнана оборона стріляє першою.</li>
        <li><b>Розвідка</b>: спостереження на місці, дальність +${Dt.observeBonus}, маскування +${Dt.stanceConcealment}.</li>
        <li><b>Відступ</b>: гра сама пропонує тиловий гекс у межах години руху — подалі від відомого противника, ближче до своїх, переважно дорогою; маршрут обходить гекси поруч із ворогом. Можна обрати інший гекс. Вимушений відступ після бою (мораль нижче порога) працює так само, але це короткий ривок — лише ${C.retreatMpShare * 100}% МР (на піхоту ~1-2 гекси), і про нього приходить окреме сповіщення «ВІДСТУП» із позицією.</li>
        <li>Міномет стріляє без прямої видимості по виявленому противнику або застарілих позначках (точність −${C.indirectFreshnessPerHour * 100}% за кожну годину).</li>
        <li>Мораль (пороги для «регулярних», Досвідчений): нижче ${C.retreatBelow} — відступ після втрат, нижче ${C.disperseBelow} — розсіювання, ${C.surrenderBelow} і нижче в оточенні чи з ≤25% складу — капітуляція. Залежно від досвіду пороги інші: новобранці («Недосвідчений») ламаються вже за середньої моралі (${Math.round(C.retreatBelow * C.experienceResolve[0])}/${Math.round(C.disperseBelow * C.experienceResolve[0])}/${Math.round(C.surrenderBelow * C.experienceResolve[0])}), ветерани та еліта — лише за дуже низької (${Math.round(C.retreatBelow * C.experienceResolve[3])}/${Math.round(C.disperseBelow * C.experienceResolve[3])}/${Math.round(C.surrenderBelow * C.experienceResolve[3])} і нижче). Відсталі повертаються щогодини, якщо поруч немає противника, інакше потрапляють у полон.</li>
        <li><b>Транспорт</b>: піший підрозділ у гексі своєї машини сідає через «Посадка» (${CONFIG.transport.boardShare * 100}% години машині й пасажирам), далі наказ руху віддається машині. Висадка — теж ${CONFIG.transport.boardShare * 100}% години. Місткість: МТ-ЛБ 10, УАЗ 4, КамАЗ 20 осіб. Пасажири стріляють з машини ×${CONFIG.transport.passengerFireMult}. Броня МТ-ЛБ захищає від стрілецької зброї; якщо машину знищено, кожен усередині — загиблий або поранений.</li>
        <li><b>Пальне</b>: УАЗ ${CONFIG.unitTypes.veh_uaz.vehicle.fuelPerHour}, КамАЗ ${CONFIG.unitTypes.veh_kamaz.vehicle.fuelPerHour}, МТ-ЛБ ${CONFIG.unitTypes.veh_mtlb.vehicle.fuelPerHour} л за годину руху. Без пального машина зупиняється.</li>
        <li><b>Місця боїв</b>: загиблі («200») лишають у гексі свою зброю та частку набоїв, знищені підрозділи — усе майно. На карті це позначка «200×N», жовта крапка — є трофеї, ▲ — уламки техніки. Підрозділ у гексі може «Забрати трофеї» (${CONFIG.loot.actionShare * 100}% години): спершу озброюються бійці без зброї, набої свого калібру йдуть у боєкомплект, решта — у вантаж (1 од. зброї на бійця; КамАЗ ${CONFIG.loot.vehicleCargo.veh_kamaz}, МТ-ЛБ ${CONFIG.loot.vehicleCargo.veh_mtlb}, УАЗ ${CONFIG.loot.vehicleCargo.veh_uaz}).</li>
        <li><b>Постачання</b>: склад нічого не виробляє — запаси дають заводи. Зона автопостачання (кнопка «Постач.» на карті) рахується не гексами, а вартістю шляху: дорогою вона сягає ≈${Math.round(CONFIG.logistics.supplyBudget/CONFIG.logistics.supplyCost.road)} гекс. (${Math.round(CONFIG.logistics.supplyBudget/CONFIG.logistics.supplyCost.road*CONFIG.hexMeters/1000*10)/10} км), полем — лише ≈${Math.round(CONFIG.logistics.supplyBudget/CONFIG.logistics.supplyCost.offroad)} гекс., лісом і бездоріжжям ще менше. Підрозділи в цій зоні (через свою чи нічийну територію без противника) щогодини отримують до ${CONFIG.logistics.resupplyShare * 100}% боєкомплекту, пальне й до ${CONFIG.logistics.replacementsPerHour} новобранців із резерву (зброя — зі складу). Поза зоною — вантажівками: «Завантажити» на складі, «Видати запаси» або «Розвантажити» (польовий склад). <b>Поза дорогами, без вантажівки</b>: інженерне відділення (до ${CONFIG.logistics.footCargoKg.eng_squad} кг) і «${CONFIG.unitTypes.supply_team.name}» (до ${CONFIG.logistics.footCargoKg.supply_team} кг) можуть самі завантажитися на складі й нести запаси пішки — повільніше й менше за раз, але без машини й дороги. Захоплений склад переходить переможцю разом із запасами; власник може знищити його.</li>
        <li><b>Медицина</b>: поранені без допомоги помирають (${CONFIG.medical.untreatedDeathPerHour * 100}%/год), поруч з евакгрупою — майже ні. Евакгрупа забирає до ${CONFIG.medical.medevacCapacity} поранених. У зоні постачання поранені самі їдуть у шпиталь (${CONFIG.facilities.hospital.beds} ліжок, потрібні медзапаси); одужалі повертаються в резерв фракції.</li>
        <li><b>Загиблі</b>: тіла залишаються в гексі боя й тиснуть на мораль будь-якого підрозділу, що там стоїть (−${CONFIG.combat.deadMoraleLoss}/год, поки лежать). Будь-який боєздатний підрозділ (не лише евакгрупа) може «Забрати загиблих» — це прибирає тіла з гекса й знімає дебаф. Живу статистику втрат (хто кого скільки вбив/ранив, скільки в полоні) видно в «Економіка» → «Втрати».</li>
        <li><b>Економіка</b>: кнопка «Економіка» — кошти, доходи, витрати, прогноз на 6 годин, підприємства й запаси. Нафта з родовища йде на НПЗ, пальне — на склад; ремонтна база лагодить техніку в сусідніх гексах за запчастини.</li>
        <li><b>Тривоги</b>: коли ваш підрозділ атакують чи обстрілюють, коли ваш вогонь убиває цивільних (підтримка падає) або ви втрачаєте пункт, у журналі з’являється виділений запис. Кнопка «→ гекс» переносить до місця й вибирає підрозділ. Фільтр «лише тривоги» показує тільки їх, а на екрані передачі ходу видно, що сталося, поки вас не було. Картка населеного пункту показує історію змін підтримки з причинами.</li>
        <li><b>Зони</b> (перемикач «Зони» на карті): для вибраного підрозділу світла заливка з суцільним контуром — куди він дійде цієї години, пунктирний контур — куди дійде за повну годину; червоне — зона ураження (заливка — гекси з лінією видимості для прямого вогню, пунктир — дальність навісної зброї).</li>
        <li><b>Вогонь по площі</b>: міномет і АГС можуть бити по будь-якому гексу в зоні, навіть без виявленого противника (кнопка «Атака», потім гекс). Точність: ${Math.round(CONFIG.combat.areaFire.observed * 100)}% якщо гекс бачать ваші підрозділи, ${Math.round(CONFIG.combat.areaFire.blind * 100)}% наосліп — і тоді результат невідомий. Б’ють по всіх, хто там є, включно з цивільними; по гексу зі своїми або союзниками стріляти не можна.</li>
        <li><b>Вогонь на придушення</b>: окрема, дешевша й слаболетальна інтенсивність вогню (перемикач «Вогонь» у картці підрозділу). На відміну від звичайної атаки, дозволяє прямій зброї (автомати, кулемети тощо, не лише міномету) бити по гексу БЕЗ виявленого живого противника — по застарілій позначці або просто по ймовірній позиції (потрібні дальність і лінія видимості, як для звичайної атаки). Якщо там справді хтось є — його придушать і, можливо, зачеплять; якщо ні — боєприпаси просто витрачено. По відомому противнику теж можна стріляти на придушення — дешевше й менш летально, але супротивник відповість зі звичайною силою.</li>
        <li><b>Пристрілка</b>: якщо навісна зброя, не рухаючись, б’є по тій самій точці годину за годиною, точність зростає — 1-й постріл ×${CONFIG.combat.zeroing.first}, 2-й ×${CONFIG.combat.zeroing.second}, 3-й і далі ×${CONFIG.combat.zeroing.third} (видно в попередньому перегляді атаки). Пропуск години, зміна цілі або рух скидають пристрілку до початку.</li>
        <li><b>Контрбатарейне виявлення</b>: якщо дальняк влучає по вас ${CONFIG.combat.counterBattery.hitsForDetect}-й раз поспіль з однієї позиції, ви отримуєте приблизну позицію (звук вильоту + час підльоту — напрямок точний, дистанція із похибкою ±${CONFIG.combat.counterBattery.distanceErrorShare * 100}%) як невпізнаний «?» у списку розвідки. Це лише здогад — справжнє виявлення (пряма видимість) завжди точніше й перекриває його.</li>
        <li><b>Засідка</b>: наказ для підрозділів із прямою зброєю. Підрозділ завмирає й підпускає ворога, що рухається поруч: вогонь відкривається, коли той дійде до найближчої до засідки точки свого маршруту (а не на межі дальності). Тоді разом б’ють усі ваші підрозділи в засідці, що дістають до цілі, — шквальним вогнем з укриття, перший вогонь ×${CONFIG.combat.ambushPositionAttacker}, відповідь цілі лише ×${CONFIG.combat.ambushPositionDefender}; рух цілі переривається. Спрацьовує раз на годину на підрозділ; рух, атака чи інший наказ скасовують засідку. Якщо в підрозділу є нерозгорнута групова зброя (АГС, «Утьос») — вона розгортається автоматично разом із засідкою чи обороною; без цього засідка стріляла б лише особистою зброєю бійців (майже без ефекту по техніці).</li>
        <li><b>Інженери</b>: понтонний міст (${CONFIG.engineering.bridge.hours} год), бліндаж у гексі (+${CONFIG.engineering.shelter.cover * 100}% укриття всім, до ${CONFIG.engineering.shelter.max} рівнів; захищає й польовий склад під ним), мінні поля (${CONFIG.engineering.mineAp.name.toLowerCase()}, ${CONFIG.engineering.mineAt.name.toLowerCase()}) та розмінування, ремонт своїх об’єктів, підрив мостів, відновлення уламків техніки. Матеріали — інженерне майно, запчастини або міни: зі складу поруч, у зоні постачання або з ВЛАСНОГО вантажу відділення (до ${CONFIG.logistics.footCargoKg.eng_squad} кг) — завантажте їх самостійно на складі заздалегідь («Завантажити» в картці відділення), і можна будувати будь-де, не чекаючи на підвіз.</li>
        <li><b>Окопи й укриття</b>: піхота й інженери в наказі «Оборона» самі «обладнують позиції» (до ${CONFIG.combat.fortMax} рівнів, +${CONFIG.combat.fortCoverPerLevel * 100}% укриття/рівень) — але лише в полі чи лісі, не в горах (копати нема чим) і без потреби в забудові (там своя висока cover). Техніка окопів не копає. Бліндаж (інженерний проєкт вище) діє скрізь і не зникає, коли підрозділ іде геть.</li>
        <li><b>Мінні поля</b>: інженер мінує гекс, у якому стоїть (протипіхотні ПМН-2 — б'ють по піхоті, протитанкові ТМ-62М — пошкоджують чи знищують техніку). Хто наступає на чужі міни — отримує удар; свої міни підрозділ не чіпає. Частина поля детонує й витрачається за прохід, решта лишається. Інженер може розмінувати гекс («Розмінування»), знищивши чужі міни там.</li>
        <li><b>Відбудова населеного пункту</b>: інженерне відділення у своєму пошкодженому пункті поступово (−${CONFIG.engineering.rebuild.amount}%/год на всі категорії, витрачаючи ${CONFIG.engineering.rebuild.eng} інж. майна/год) усуває руйнування житла, води, транспорту й промисловості — набагато швидше за пасивне відновлення (${CONFIG.population.repairPerHour}%/год без бою).</li>
        <li><b>АГС-17</b> і <b>«Утьос»</b>: спершу «Розгорнути» (${CONFIG.deployShare * 100}% години); рух згортає. АГС б’є навісним вогнем як міномет (до 1700 м), «Утьос» — прямим до 1500 м і пробиває легку техніку. З гір дальність +${CONFIG.heightRangeBonus * 100}%.</li>
        <li><b>Техніка</b>: пікап (3 пасажири, можна встановити ПКМ, «Утьос» чи АГС), легковик (швидкий на дорогах, грузне в полі), бусик (10 пасажирів). Цивільні машини реквізують у підконтрольних пунктах. Машина без екіпажу лишається в гексі — її може забрати будь-яка сторона, виділивши екіпаж з пішого підрозділу. Уламки відновлюють інженери. У Соціалістичної влади є військовий автопарк з УАЗами.</li>
        <li><b>Одноразові ПТГ</b> стріляють лише по техніці; використана труба викидається, нові видає склад.</li>
        <li><b>Набір</b>: на своєму складі — «Сформувати» (люди з резерву, зброя зі складу, гроші, кілька годин підготовки; підрозділ недосвідчений). <b>Національні ополчення</b> — у картці пункту, з конкретної групи (юготари, росіяни, кавказці) за високої підтримки цієї групи; удома стійкіші. <b>Підпільна майстерня</b> у прихильному пункті споряджає набої й міни, робить запчастини, ремонтує й переобладнує машини. <b>Чорний ринок</b> — у «Економіці»: оплата одразу, доставка на склад.</li>
        <li><b>Геополітика, ПВК, добровольці</b> (у «Економіці»): кожна фракція має прикордонний перехід «з-за кордону» — ним іде і ПВК, і добровольці; якщо ворог його захопить або розсіче вашу територію між ним і пунктом прибуття, підтримка не дійде. <b>ПВК</b> (Соц. влада — «Вагнер», Демократи — «Атлантик Шилд» з набоями від НАТО, Націоналісти — «Легіон «Вовк»») купується раз на ${CONFIG.geopolitics.pmc.cooldownHours} год — сам заклик відкриває меню замовлення: піхотний взвод, кулеметний або гранатометний розрахунок, а у «Вагнера» ще й МТ-ЛБ з екіпажем; усі професіонали (${esc(CONFIG.experience[CONFIG.geopolitics.pmc.experience])}), ціна своя для кожного типу й залежить від стосунків. Кожне замовлення щоразу трохи підриває підтримку відповідної групи населення по всіх ваших пунктах і водночас покращує стосунки з патроном. <b>Добровольці</b> безкоштовні й без політичної ціни (${esc(CONFIG.experience[CONFIG.geopolitics.volunteers.experience])}): або самі приходять хвилею разом з хвилею підтримки після звільнення населеного пункту, що був під ворогом, або гравець сам намагається «закликати діаспору». <b>Стосунки з патроном</b> (0–100%) ростуть від найму ПВК і звільнень, і визначають ціну ПВК та кулдаун/ціну заклику добровольців — чим гірші стосунки, тим дорожче й довше.</li>
        <li><b>Населення</b>: у кожному пункті юготари, росіяни й кавказькі народи з власною підтримкою кожної фракції. Вона змінює доходи й мобілізацію, дає донесення про противника, викликає протести, страйки й саботаж. Бої в забудові (особливо міни) вбивають цивільних, руйнують житло, женуть біженців і знижують підтримку того, хто стріляв. Допомагають гуманітарні конвої; за високої підтримки можна зібрати ополчення.</li>
        <li><b>Пропаганда</b>: дешевший за гум. допомогу спосіб піднести підтримку в пункті (${CONFIG.population.propaganda.money} грн, раз на ${CONFIG.population.propaganda.cooldownHours} год на пункт). Якщо ворог нещодавно (до ${CONFIG.population.propaganda.outrageWindowHours} год тому) там зачепив цивільних — ефект підсилюється ×${CONFIG.population.propaganda.outrageMult} і трохи підриває підтримку звинуваченої фракції там само («ворог убиває цивільних»).</li>
        <li><b>Дипломатія</b> («Політика» → «Дипломатія»): пропозиція надсилається у своїй фазі, отримувач відповідає у своїй. Перемир’я, обмін полоненими, гуманітарні коридори, союз (спільна розвідка, постачання й операції), обмін розвідданими, спільне постачання, передача території, політичні угоди. Атака попри угоду — порушення з втратою репутації й підтримки.</li>
        <li><b>Перемога</b>: очки за цілі (утримання пунктів і об’єктів, підтримка населення, втрати противника, репутація). Дострокова — 80 очок, військова чи політична; інакше — підсумок наприкінці ${CONFIG.campaign.days}-ї доби. Після завершення — хроніка кампанії.</li>
        <li><b>Реорганізація</b>: зі взводу можна виділити відділення з ${CONFIG.organization.squadSize} осіб (зброя й набої діляться пропорційно); піхотні підрозділи в одному гексі можна об’єднати, від ${CONFIG.organization.platoonMin} осіб це взвод. Кожна дія — ${CONFIG.organization.actionShare * 100}% години.</li>
        <li>Гекс переходить під контроль, якщо до кінця години в ньому лише ваші підрозділи. Ніч (${Dt.night.from}:00–0${Dt.night.to}:59) зменшує дальність огляду на ${Dt.night.penalty}.</li>
      </ol></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Невирішені параметри</h3><ul>${CONFIG.unresolved.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Озброєння</h3><div class="tablewrap"><table>
        <thead><tr><th>Зброя</th><th>м</th><th>Точн.</th><th>Ефект</th><th>ПТ</th><th>Витр./год</th><th>Призначення</th></tr></thead><tbody>${weapons}</tbody></table></div></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Місцевість</h3><div class="tablewrap"><table>
        <thead><tr><th>Місцевість</th><th>Пішки</th><th>Колісна</th><th>Гусен.</th><th>Укриття</th><th>Маск.</th></tr></thead><tbody>${rows}${roads}
        <tr><td>Річка без переправи</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td></td><td></td></tr></tbody></table></div></div>
      <div><h3 style="margin:0 0 6px;font-size:13px">Каталог підрозділів</h3><div class="tablewrap"><table>
        <thead><tr><th>Підрозділ</th><th>Осіб</th><th>Пересування</th><th>ОР/год</th></tr></thead><tbody>${units}</tbody></table></div></div>`);
  }

  // ---------------------------------------------------- онлайн (85_net.js)
  let online = false;
  function setOnline(on) {
    online = on;
    $('btnChat').hidden = !on;
    closeMainMenuForce();
  }
  function closeMainMenuForce() { const el = $('mainmenu'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  // Нова картина фракції з сервера: замінюємо стан, зберігаючи вибір і камеру
  function applyView(st) {
    const first = !state;
    const prevF = state ? Engine.phaseFaction(state) : null, prevTurn = state ? state.time.turn : null;
    state = st;
    window.__state = state;
    if (selectedId != null && !Engine.unitById(state, selectedId)) resetSelection();
    if (selectedEnemy != null && !Intel.knownList(state, pf(), { allies: 'all' }).some(m => m.id === selectedEnemy)) selectedEnemy = null;
    applyViewer();
    if (first) { focusFaction(); leftTab = 'own'; }
    const f = Engine.phaseFaction(state), me = Net.faction();
    if (f !== me) handover = false;
    else if (!first && (prevF !== f || prevTurn !== state.time.turn)) handover = newAlerts(f).length > 0;
    else if (first) handover = false;
    zoneCache = null;
    invalidateBase();
    renderAll();
  }
  function leaveOnlineGame() { state = null; resetSelection(); dirty = true; }
  function renderOnlineBar() { if (state) { renderTop(); renderBotbar(); } }

  return { init, setState, openMainMenu, applyView, setOnline, leaveOnlineGame, renderOnlineBar, getState: () => state, toast, renderAll, __test: { hexClick: (i, b = 0) => onHexClick(i, b), select: id => selectUnit(id, true), center: i => centerOn(i) } };
})();

// ------------------------------------------------------------------ запуск
(function boot() {
  const start = data => {
    UI.init();
    let st = null;
    if (data && data.save) {
      const r = SaveSystem.deserialize(data.save);
      if (r.ok) st = r.state;
    }
    // #quickstart — одразу гра трьох людей (для UI-тестів і швидкої перевірки), інакше — меню.
    // Сторінку віддав сервер онлайн-гри — лобі мультиплеєра (85_net.js).
    if (st) { UI.setState(st); return; }
    if (location.hash === '#quickstart') { UI.setState(Engine.newGame(1999)); return; }
    Net.detect().then(on => { if (on) Net.boot(); else UI.openMainMenu(); });
  };
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ save: UI.getState() ? SaveSystem.serialize(UI.getState()) : null }));
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
