// ============================================================================
// МОДУЛЬ: ПРАВИЛА СИМУЛЯЦІЇ (без доступу до інтерфейсу)
// Фази, години/доби, маршрути, рух, накази, контроль гексів.
// Бій — модуль Combat, розвідка — модуль Intel.
// Усе детерміновано: однакові дії дають однаковий результат.
// ============================================================================
const Engine = (() => {
  const gridCache = new WeakMap();
  function grid(state) {
    let g = gridCache.get(state.map);
    if (!g) { g = new Grid(state.map.w, state.map.h); gridCache.set(state.map, g); }
    return g;
  }

  const PHASE_NAMES = ['Соціалістична влада', 'Демократичні повстанці', 'Націоналістичні повстанці', 'Завершення години'];
  const ORDER_NAMES = { move: 'Рух', retreat: 'Відступ', defend: 'Оборона', observe: 'Розвідка', attack: 'Атака', ambush: 'Засідка' };

  // Порядок фаз у межах години обертається щогодини (endPhase), щоб жодна фракція не мала
  // постійної переваги першого ходу — тому «чия зараз фаза» йде через phaseOrder, а не напряму
  // через лічильник state.phase. Старі збереження без phaseOrder трактуються як [0,1,2].
  function phaseFaction(state) { if (state.phase >= 3) return null; const order = state.phaseOrder || [0, 1, 2]; return order[state.phase]; }
  function unitType(u) { return CONFIG.unitTypes[u.type]; }
  function moveClass(u) { return unitType(u).move; }
  function mpMax(u) { return unitType(u).mp; }
  function unitById(state, id) { return state.units.find(u => u.id === id) || null; }
  function timeLabel(t) { return `День ${t.day}, ${String(t.hour).padStart(2, '0')}:00`; }
  function fname(f) { return CONFIG.factions[f].name; }
  function canAct(u) { return u.personnel.fit > 0 && u.dispersal < 3; }

  // ---------------------------------------------------------------- журнал
  // visibleTo: масив фракцій, яким видно запис; null — усім.
  // ref: { at: гекс, uid: підрозділ } — запис можна клацнути й перейти на карті
  function log(state, text, kind = 'info', faction = null, visibleTo, ref) {
    const vis = visibleTo !== undefined ? visibleTo : (faction === null ? null : [faction]);
    const e = { id: state.nextLogId++, day: state.time.day, hour: state.time.hour, phase: state.phase, faction, kind, text, vis };
    if (ref && ref.at != null && ref.at >= 0) e.at = ref.at;
    if (ref && ref.uid != null) e.uid = ref.uid;
    state.log.push(e);
    if (state.log.length > 4000) state.log.splice(0, state.log.length - 4000);
  }

  // ---------------------------------------------------------- присутність
  function occupancy(state) {
    const m = new Map();
    for (const u of state.units) {
      if (!m.has(u.idx)) m.set(u.idx, []);
      m.get(u.idx).push(u);
    }
    return m;
  }
  function unitsAt(state, idx) { return state.units.filter(u => u.idx === idx); }
  function hasForeign(occ, idx, faction) {
    const list = occ.get(idx);
    return !!list && list.some(u => u.faction !== faction);
  }
  function ownCount(occ, idx, faction, exceptId) {
    const list = occ.get(idx);
    return list ? list.filter(u => u.faction === faction && u.id !== exceptId).length : 0;
  }
  // Гекси, де фракція ЗНАЄ про чужі підрозділи (бачить зараз)
  function knownForeignHexes(state, faction) {
    const s = new Set();
    for (const id of Intel.visibleIds(state, faction)) {
      const e = unitById(state, id);
      if (e) s.add(e.idx);
    }
    return s;
  }

  // ------------------------------------------------------------ місцевість
  function terrainKey(state, idx) { return CONFIG.terrain[state.map.terrain[idx]].key; }

  function roadBetween(state, from, dir, to) {
    const m = state.map;
    if (!(m.roadDirs[from] & (1 << dir))) return 0;
    if (!(m.roadDirs[to] & (1 << Hex.opposite(dir)))) return 0;
    return Math.min(m.road[from], m.road[to]);
  }

  // Вартість входу в гекс `to` із сусіднього `from`. Infinity = непрохідно.
  function stepCost(state, cls, from, dir, to) {
    const m = state.map;
    const table = CONFIG.moveCost[cls];
    if (m.river[to] && !m.bridge[to]) return Infinity;   // річка без переправи
    const base = table[terrainKey(state, to)];
    if (base == null) return Infinity;
    const road = roadBetween(state, from, dir, to);
    if (road === 2) return Math.min(base, table.roadAsphalt);
    if (road === 1) return Math.min(base, table.roadDirt);
    return base;
  }

  function hexPassable(state, cls, idx) {
    if (state.map.river[idx] && !state.map.bridge[idx]) return false;
    return CONFIG.moveCost[cls][terrainKey(state, idx)] != null;
  }

  // ----------------------------------------------------------------- маршрут
  // A* за вартістю руху. Блокують лише чужі підрозділи, ВІДОМІ фракції.
  // opts.avoidEnemy — відступ: штраф за гекси поруч із відомим ворогом.
  function findPath(state, unit, from, target, opts = {}) {
    const g = grid(state);
    const cls = moveClass(unit);
    const maxStep = mpMax(unit);
    const occ = occupancy(state);
    const limit = CONFIG.rules.stackLimit;
    const table = CONFIG.moveCost[cls];
    const blocked = opts.realOccupancy ? null : knownForeignHexes(state, unit.faction);
    const isBlocked = n => opts.realOccupancy ? hasForeign(occ, n, unit.faction) : blocked.has(n);
    let danger = null;
    if (opts.avoidEnemy) {
      danger = new Set();
      for (const h of knownForeignHexes(state, unit.faction)) for (let d = 0; d < 6; d++) { const n = g.neighbor(h, d); if (n >= 0) danger.add(n); }
    }
    let minCost = Infinity;
    for (const v of Object.values(table)) if (v != null && v < minCost) minCost = v;

    const N = g.size;
    const gs = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    gs[from] = 0; heap.push(0, from);
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      if (cur === target) break;
      closed[cur] = 1;
      for (let d = 0; d < 6; d++) {
        const n = g.neighbor(cur, d);
        if (n < 0 || closed[n]) continue;
        if (CONFIG.rules.blockForeignHexes && isBlocked(n)) continue;
        if (limit != null && n === target && ownCount(occ, n, unit.faction, unit.id) >= limit) continue;
        const c = stepCost(state, cls, cur, d, n);
        if (!isFinite(c) || c > maxStep) continue;
        const pen = danger && danger.has(n) ? 6 : 0;
        const ng = gs[cur] + c + pen;
        if (ng < gs[n] - 1e-9) {
          gs[n] = ng; came[n] = cur;
          heap.push(ng + g.dist(n, target) * minCost + n * 1e-9, n);
        }
      }
    }
    if (from === target || came[target] < 0) return null;
    const path = [];
    for (let c = target; c !== from; c = came[c]) path.push(c);
    path.reverse();
    const costs = [];
    let prev = from, total = 0;
    for (const i of path) { const c = stepCost(state, cls, prev, g.dirTo(prev, i), i); costs.push(c); total += c; prev = i; }
    return { path, costs, total };
  }

  // Досяжність: куди підрозділ може дійти цієї години (now) і за повну годину руху з поточного гекса (next).
  // Ті самі правила, що й у findPath: річки, непрохідна місцевість, відомі чужі підрозділи, пальне.
  function reachable(state, unit) {
    const g = grid(state);
    const out = { now: new Map(), next: new Map(), firstMp: 0, pending: false, reason: null };
    if (!unit || !canAct(unit)) { out.reason = 'Підрозділ не може рухатися.'; return out; }
    if (unit.embarked != null) { out.reason = 'Підрозділ у машині — рух визначає машина.'; return out; }
    const cls = moveClass(unit);
    const maxStep = mpMax(unit);
    // «Відкладено» лише якщо цієї години вже нічого не лишилось (бій забрав усі ОР) —
    // кілька наказів руху поспіль у межах тих самих ОР виконуються одразу, без очікування години.
    const pending = unit.mp <= 1e-9 || unit.attackedTurn === state.time.turn;
    const firstMp = pending ? 0 : unit.mp;
    out.firstMp = firstMp; out.pending = pending;
    let budget = Math.max(firstMp, maxStep);
    let fuelCap = Infinity;
    if (unit.vehicle) {
      const per = Transport.fuelPerMp(unit);
      if (per > 0) fuelCap = unit.vehicle.fuel / per;
    }
    budget = Math.min(budget, fuelCap);
    const blocked = CONFIG.rules.blockForeignHexes ? knownForeignHexes(state, unit.faction) : new Set();
    const N = g.size;
    const gs = new Float64Array(N).fill(Infinity);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    gs[unit.idx] = 0; heap.push(0, unit.idx);
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (let d = 0; d < 6; d++) {
        const n = g.neighbor(cur, d);
        if (n < 0 || closed[n] || blocked.has(n)) continue;
        const c = stepCost(state, cls, cur, d, n);
        if (!isFinite(c) || c > maxStep) continue;
        const ng = gs[cur] + c;
        if (ng > budget + 1e-9) continue;
        if (ng < gs[n] - 1e-9) { gs[n] = ng; heap.push(ng, n); }
      }
    }
    // now — залишок ОР цієї години; next — повна година руху з поточного гекса
    for (let i = 0; i < N; i++) {
      if (i === unit.idx || !isFinite(gs[i])) continue;
      if (gs[i] <= firstMp + 1e-9) out.now.set(i, gs[i]);
      else out.next.set(i, gs[i]);
    }
    out.fuelLimited = fuelCap < maxStep;
    return out;
  }

  function splitByHours(costs, firstMp, fullMp) {
    const hourOf = [];
    let hour = 0, mp = firstMp;
    for (const c of costs) {
      if (c > mp + 1e-9) { hour++; mp = fullMp; }
      mp -= c;
      hourOf.push(hour);
    }
    return hourOf;
  }

  // opts.anyPhase — для реактивного вогню (засідка): підрозділ стріляє НЕ у своїй фазі,
  // у відповідь на рух противника в чужій фазі, тож перевірку фази пропускаємо.
  // opts.allowDispersed — рішення автора (запит гравця): розсіяний («збентежений»)
  // підрозділ усе ще можна посадити в машину й евакуювати, навіть доки бійці не зібралися —
  // саме це йому і потрібно. Повного зникнення (fit<=0) це не стосується.
  function checkCommandable(state, u, opts = {}) {
    if (!u) return 'Підрозділ не знайдено.';
    if (!opts.anyPhase) {
      const pf = phaseFaction(state);
      if (pf === null || u.faction !== pf) return 'Накази можна віддавати лише у фазі своєї фракції.';
    }
    if (u.personnel.fit <= 0) return 'Підрозділ розсіяний і не виконує наказів, доки не повернуться бійці.';
    if (!opts.allowDispersed && u.dispersal >= 3) return 'Підрозділ розсіяний і не виконує наказів, доки не повернуться бійці.';
    return null;
  }

  // ---------------------------------------------------- попередній перегляд
  function previewMove(state, unitId, target, kind = 'move') {
    const u = unitById(state, unitId);
    const err = checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    if (u.embarked != null) return { ok: false, reason: 'Підрозділ їде в машині. Віддайте наказ машині або спершу висадіть його.' };
    const g = grid(state);
    if (target < 0 || target >= g.size) return { ok: false, reason: 'Гекс поза картою.' };
    if (target === u.idx) return { ok: false, reason: 'Підрозділ уже перебуває в цьому гексі.' };
    const cls = moveClass(u);
    if (!hexPassable(state, cls, target)) {
      return { ok: false, reason: `Кінцевий гекс непрохідний для класу «${CONFIG.moveClassNames[cls]}».` };
    }
    if (knownForeignHexes(state, u.faction).has(target)) {
      return { ok: false, reason: 'У кінцевому гексі ворожий підрозділ. Використайте наказ «Атака».' };
    }
    const res = findPath(state, u, u.idx, target, { avoidEnemy: kind === 'retreat' });
    if (!res) return { ok: false, reason: 'Маршрут неможливий: шлях перекрито річкою без мостів, непрохідною місцевістю або відомими ворожими підрозділами.' };

    const pending = u.mp <= 1e-9 || u.attackedTurn === state.time.turn;
    const firstMp = pending ? mpMax(u) : u.mp;
    const hourOf = splitByHours(res.costs, firstMp, mpMax(u));
    const hours = hourOf.length ? hourOf[hourOf.length - 1] + 1 : 0;
    const startHourOffset = pending ? 1 : 0;

    // Ризики — лише за відомими фракції даними
    const risks = [];
    const foreignCtl = res.path.filter(i => state.map.control[i] >= 0 && state.map.control[i] !== u.faction);
    if (foreignCtl.length) {
      const byF = {};
      for (const i of foreignCtl) byF[state.map.control[i]] = (byF[state.map.control[i]] || 0) + 1;
      for (const [f, n] of Object.entries(byF)) risks.push(`Маршрут проходить ${n} гекс(ів) під контролем: ${fname(f)}.`);
    }
    const known = Intel.knownList(state, u.faction);
    const near = new Set(), stale = new Set();
    for (const i of res.path) {
      for (const k of known) {
        if (g.dist(i, k.idx) <= 1) (k.visible ? near : stale).add(k.id);
      }
    }
    if (near.size) risks.push(`Маршрут проходить поруч із ${near.size} виявленим(и) ворожим(и) підрозділом(ами) — можливий бій.`);
    if (stale.size) risks.push(`Поблизу маршруту є ${stale.size} застаріла(і) позначка(и) противника.`);
    const unseen = res.path.filter(i => !Intel.hexObserved(state, u.faction, i)).length;
    if (unseen > res.path.length * 0.5) risks.push(`Понад половина маршруту (${unseen} гекс.) поза спостереженням — можлива зустріч із невиявленим противником.`);
    const bridges = res.path.filter(i => state.map.bridge[i]).length;
    if (bridges) risks.push(`Маршрут проходить через міст(и): ${bridges}. Мости — вузькі місця.`);
    const slow = res.path.filter(i => ['swamp', 'denseForest', 'mountains'].includes(terrainKey(state, i))).length;
    if (slow) risks.push(`Важка місцевість на маршруті: ${slow} гекс(ів).`);
    if (u.fort > 0) risks.push(`Підрозділ залишить обладнані позиції (рівень оборони ${u.fort}).`);
    let fuel = null;
    if (u.vehicle) {
      const need = Math.round(res.total * Transport.fuelPerMp(u) * 10) / 10;
      fuel = { need, have: u.vehicle.fuel };
      if (need > u.vehicle.fuel + 1e-9) risks.push(`Пального не вистачить: потрібно ≈${fmt(need)} л, є ${fmt(u.vehicle.fuel)} л. Машина зупиниться на маршруті.`);
      const pass = Transport.passengers(state, u);
      if (pass.length && (near.size || stale.size)) risks.push(`У машині ${Transport.load(state, u)} осіб: якщо машину знищать, усі вони стануть загиблими або пораненими${Combat.armorOf(u) === 'armored' ? '' : ', а небронована машина вразлива навіть для стрілецької зброї'}.`);
    }
    if (!risks.length) risks.push('Суттєвих ризиків за наявними даними не виявлено.');

    return {
      ok: true, kind, unitId, target, path: res.path, costs: res.costs, total: res.total, fuel,
      hourOf, hours, pending, startHourOffset, risks,
      firstMp, arrive: addHours(state.time, hours - 1 + startHourOffset)
    };
  }

  function addHours(t, n) {
    let h = t.hour + n, d = t.day;
    while (h >= CONFIG.hoursPerDay) { h -= CONFIG.hoursPerDay; d++; }
    return { day: d, hour: h };
  }

  // ------------------------------------------------------------------ накази
  function issueMoveOrder(state, unitId, target, kind = 'move') {
    const p = previewMove(state, unitId, target, kind);
    if (!p.ok) return p;
    const u = unitById(state, unitId);
    const order = {
      type: kind, target, path: p.path.slice(), status: 'active',
      issued: { day: state.time.day, hour: state.time.hour }
    };
    const g = grid(state);
    const nm = ORDER_NAMES[kind];
    if (p.pending) {
      u.pendingOrder = order;
      log(state, `${u.name}: новий наказ «${nm} → ${g.label(target)}» прийнято. Поточна дія цієї години вже виконана, новий наказ почне виконуватися з наступної години.`, 'order', u.faction);
      snapshot(state, u);
      return { ok: true, pending: true, preview: p };
    }
    u.order = order;
    u.pendingOrder = null;
    if (u.project) Field.cancelProject(state, u, 'відділення отримало наказ руху');
    leavePosition(state, u);
    log(state, `${u.name}: наказ «${nm} → ${g.label(target)}» (маршрут ${p.path.length} гекс., ${fmt(p.total)} ОР, ≈${p.hours} год).`, 'order', u.faction);
    const r = executeMove(state, u);
    return { ok: true, pending: false, preview: p, result: r };
  }

  function leavePosition(state, u) {
    if (u.fort > 0) log(state, `${u.name}: залишає обладнані позиції (рівень ${u.fort}).`, 'order', u.faction);
    u.fort = 0;
    u.stance = 'none';
  }

  // Оборона / розвідка — стани на місці
  function setStance(state, unitId, stance) {
    const u = unitById(state, unitId);
    const err = checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    if (u.embarked != null) return { ok: false, reason: 'Підрозділ їде в машині. Спершу висадіть його.' };
    if (u.stance === stance && !u.order) return { ok: false, reason: 'Підрозділ уже виконує цей наказ.' };
    const nm = ORDER_NAMES[stance];
    if (u.order && u.mp <= 1e-9) {
      u.pendingOrder = { type: stance, issued: { day: state.time.day, hour: state.time.hour } };
      log(state, `${u.name}: наказ «${nm}» прийнято. Підрозділ завершує рух цієї години, наказ почне діяти з наступної.`, 'order', u.faction);
      return { ok: true, pending: true };
    }
    if (u.order) { u.order = null; log(state, `${u.name}: рух припинено.`, 'order', u.faction); }
    if (u.stance !== stance && stance !== 'defend') u.fort = 0;
    if (stance !== 'defend' && u.fort) u.fort = 0;
    u.stance = stance;
    u.pendingOrder = null;
    const g = grid(state);
    // Засідка й оборона: групову зброю (АГС, «Утьос», міномет), яку ще не розгорнуто, розгортаємо
    // одразу — інакше підрозділ «стріляє» лише особистою зброєю, що по техніці майже без ефекту.
    let autoDeployed = '';
    if ((stance === 'defend' || stance === 'ambush') && typeof Combat !== 'undefined' && Combat.needsDeploy(u) && !u.deployed) {
      const dcost = mpMax(u) * CONFIG.deployShare;
      if (u.mp >= dcost - 1e-9) { u.mp -= dcost; u.deployed = true; autoDeployed = ' Групову зброю розгорнуто автоматично.'; }
      else autoDeployed = ' УВАГА: не вистачає очок руху, щоб одразу розгорнути групову зброю — вона поки не стрілятиме (розгорніть наказом «Розгорнути»).';
    }
    if (stance === 'defend') log(state, `${u.name}: наказ «Оборона» у ${g.label(u.idx)}. Кожна повна година на місці додає рівень обладнаних позицій (макс. ${CONFIG.combat.fortMax}).${autoDeployed}`, 'order', u.faction);
    else if (stance === 'ambush') log(state, `${u.name}: наказ «Засідка» у ${g.label(u.idx)} — підрозділ завмер і чекає. Підпустить ворога, що рухається поруч, до найближчої точки його маршруту й відкриє вогонь першим разом з іншими засідками, що дістають, — рух ворога перерветься. Один постріл за годину; будь-який рух чи атака скасовує засідку.${autoDeployed}`, 'order', u.faction);
    else log(state, `${u.name}: наказ «Розвідка» — спостереження з ${g.label(u.idx)}, дальність +${CONFIG.detection.observeBonus}, маскування +${CONFIG.detection.stanceConcealment}.`, 'order', u.faction);
    Intel.update(state);
    snapshot(state, u);
    return { ok: true, pending: false };
  }

  // Розгорнути групову зброю (АГС, «Утьос», міномет)
  function deploy(state, unitId) {
    const u = unitById(state, unitId);
    const err = checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    if (!Combat.needsDeploy(u)) return { ok: false, reason: 'У підрозділу немає групової зброї, яку треба розгортати.' };
    if (u.deployed) return { ok: false, reason: 'Зброя вже розгорнута.' };
    if (u.embarked != null) return { ok: false, reason: 'Спершу висадіть розрахунок.' };
    const cost = mpMax(u) * CONFIG.deployShare;
    if (u.mp < cost - 1e-9) return { ok: false, reason: `Розгортання займає ${CONFIG.deployShare * 100}% години (залишилось ${fmt(u.mp)} ОР).` };
    if (u.order) { u.order = null; log(state, `${u.name}: рух припинено для розгортання.`, 'order', u.faction); }
    u.mp -= cost; u.deployed = true; u.movedThisPhase = true;
    log(state, `${u.name}: зброю розгорнуто в ${grid(state).label(u.idx)}${terrainKey(state, u.idx) === 'mountains' ? ' — позиція на висоті, дальність +' + CONFIG.heightRangeBonus * 100 + '%' : ''}.`, 'order', u.faction);
    return { ok: true };
  }

  function cancelOrder(state, unitId) {
    const u = unitById(state, unitId);
    if (!u) return { ok: false, reason: 'Підрозділ не знайдено.' };
    const pf = phaseFaction(state);
    if (pf === null || u.faction !== pf) return { ok: false, reason: 'Накази можна змінювати лише у фазі своєї фракції.' };
    if (u.project) { Field.cancelProject(state, u, 'наказ командира'); return { ok: true }; }
    if (!u.order && !u.pendingOrder && u.stance === 'none') return { ok: false, reason: 'Активних наказів немає.' };
    const hadPending = !!u.pendingOrder;
    u.pendingOrder = null;
    if (u.order) {
      u.order = null;
      log(state, `${u.name}: наказ скасовано${u.movedThisPhase ? ' — рух цієї години вже завершено, підрозділ зупиняється в гексі ' + grid(state).label(u.idx) : ''}.`, 'order', u.faction);
    } else if (u.stance !== 'none') {
      log(state, `${u.name}: наказ «${ORDER_NAMES[u.stance]}» скасовано.${u.fort ? ' Обладнані позиції збережено, доки підрозділ не зрушить.' : ''}`, 'order', u.faction);
      u.stance = 'none';
    } else if (hadPending) {
      log(state, `${u.name}: відкладений наказ скасовано.`, 'order', u.faction);
    }
    snapshot(state, u);
    return { ok: true };
  }

  // ------------------------------------------------------------- виконання
  // Засідка: підрозділи інших фракцій у наказі «Засідка», що саме зараз (цього кроку) вперше
  // побачили рухомого й дістають до нього прямим вогнем, не стріляючи цієї години раніше.
  function ambushersAt(state, mover) {
    const g = grid(state);
    const out = [];
    for (const w of state.units) {
      if (w.faction === mover.faction || w.stance !== 'ambush' || !canAct(w) || w.attackedTurn === state.time.turn || w.embarked != null) continue;
      if (typeof Politics !== 'undefined' && state.diplomacy && Politics.allied(state, w.faction, mover.faction)) continue;
      const dist = g.dist(w.idx, mover.idx);
      const armor = Combat.armorOf(mover.embarked != null ? (unitById(state, mover.embarked) || mover) : mover);
      if (!Combat.weaponsInRange(w, dist, false, { state, targetArmor: armor }).length) continue;
      // Засідка стежить за місцевістю цілеспрямовано: бачить усе в межах дальності зброї,
      // якщо лінію вогню не перекриває місцевість — а не лише в межах звичної побіжної
      // дальності виявлення (яка часто коротша за дальність зброї).
      if (dist > 1 && !Intel.lineOfSight(state, w.idx, mover.idx, terrainKey(state, w.idx) === 'mountains').ok) continue;
      out.push(w);
    }
    return out;
  }

  // Гекси маршруту, які підрозділ ще пройде цієї години (за залишком ОР і пального)
  function pathAheadThisHour(state, u, path) {
    const g = grid(state), cls = moveClass(u);
    const out = [];
    let mp = u.mp, cur = u.idx;
    for (const next of path) {
      const dir = g.dirTo(cur, next);
      const c = dir < 0 ? Infinity : stepCost(state, cls, cur, dir, next);
      if (!isFinite(c) || c > mp + 1e-9) break;
      mp -= c; out.push(next); cur = next;
    }
    return out;
  }

  function executeMove(state, u) {
    const g = grid(state);
    const o = u.order;
    if (!o || (o.type !== 'move' && o.type !== 'retreat') || (o.status !== 'active' && o.status !== 'blocked' && o.status !== 'contact')) return { moved: 0 };
    if (!canAct(u)) return { moved: 0 };
    const cls = moveClass(u);
    let moved = 0, spent = 0;
    const startIdx = u.idx;
    let reason = '';
    let retried = false;
    const seenBefore = new Set(Intel.visibleIds(state, u.faction));
    let contact = [];
    while (o.path.length) {
      const next = o.path[0];
      const occ = occupancy(state);
      const dir = g.dirTo(u.idx, next);
      const foreignThere = hasForeign(occ, next, u.faction);
      let blocked = dir < 0 || foreignThere;
      let cost = blocked ? Infinity : stepCost(state, cls, u.idx, dir, next);
      if (!isFinite(cost)) blocked = true;
      if (blocked) {
        if (foreignThere) { Intel.update(state); }
        if (!retried) {
          retried = true;
          const re = findPath(state, u, u.idx, o.target, { avoidEnemy: o.type === 'retreat' });
          if (re && re.path[0] !== next) { o.path = re.path; log(state, `${u.name}: маршрут перекрито, прокладено обхід (${re.path.length} гекс.).`, 'move', u.faction); continue; }
        }
        o.status = 'blocked';
        reason = foreignThere ? 'попереду противник, обхідного шляху немає — підрозділ чекає' : 'маршрут перекрито, обхідного шляху немає — підрозділ чекає';
        break;
      }
      if (cost > u.mp + 1e-9) { reason = 'вичерпано очки руху цієї години'; break; }
      if (u.vehicle && !Transport.burnFuel(state, u, cost)) { o.status = 'blocked'; reason = `закінчилося пальне (залишок ${fmt(u.vehicle.fuel)} л) — машина зупинилася`; break; }
      u.mp -= cost; spent += cost;
      u.idx = next;
      if (u.carrying && u.carrying.length) Transport.syncPassengers(state, u);
      o.path.shift();
      o.status = 'active';
      moved++;
      u.movedThisPhase = true;
      u.movedTurn = state.time.turn;
      if (u.fort) u.fort = 0;
      if (u.deployed && !u.vehicle) u.deployed = false;
      if (CONFIG.rules.controlOnEnter && state.map.control[next] !== u.faction) state.map.control[next] = u.faction;
      // Мінне поле: заходимо на чужі міни
      const mineHit = Mines.checkTrigger(state, u);
      if (mineHit) {
        if (mineHit.destroyed || !state.units.includes(u)) {
          return { moved, spent, reason: `підрозділ наштовхнувся на мінне поле в ${g.label(next)} — техніку знищено.`, contact, mined: true };
        }
        o.status = 'contact';
        reason = `перешкода в ${g.label(next)}: ${mineHit.lines.join('; ')}.`;
        break;
      }
      // Засідка: хтось у стансі «Засідка» саме тепер побачив нас і стріляє першим
      // Вогневий мішок: стріляють УСІ засідники, що дістають до цілі (запит гравця), шквальним
      // вогнем; якщо на шквальний не вистачає боєприпасів — звичайним. Ціль знищено/розсіяно —
      // решта не стріляє.
      const ambushers = ambushersAt(state, u);
      // «Підпустити ближче» (запит гравця): засідка не стріляє, щойно ціль зайшла в дальність,
      // а чекає, поки та дійде до найближчої до засідника точки маршруту, яку пройде цієї
      // години. Якщо далі вона лише віддалятиметься (або зупиниться тут) — вогонь.
      const ahead = pathAheadThisHour(state, u, o.path);
      const trigger = ambushers.some(w => ahead.every(i => g.dist(i, w.idx) >= g.dist(u.idx, w.idx)));
      ambushers.sort((a, b) => g.dist(a.idx, u.idx) - g.dist(b.idx, u.idx) || a.id - b.id);
      if (ambushers.length && trigger) {
        const fired = [];
        for (const w of ambushers) {
          if (!state.units.includes(u) || u.personnel.fit <= 0) break;
          Intel.update(state);   // Combat.attack читає кеш видимості — оновлюємо його під нову позицію
          const opts = { anyPhase: true, forceVisible: true, ambushPosition: true };
          let r = Combat.attack(state, w.id, { unitId: u.id }, 'high', opts);
          if (!r.ok) r = Combat.attack(state, w.id, { unitId: u.id }, 'normal', opts);
          if (r.ok) fired.push(w);
        }
        if (fired.length) {
          const names = fired.map(w => w.name).join(', ');
          if (!state.units.includes(u)) {
            reason = `засідка біля ${g.label(u.idx)}: вогонь відкрили ${names}.`;
            return { moved, spent, reason, contact: fired, ambushed: true };
          }
          contact = fired;
          o.status = 'contact';
          reason = `засідка! Першими відкрили вогонь ${names} — рух зупинено.`;
          break;
        }
      }
      // Розвідка після кожного кроку: новий контакт зупиняє рух
      const fresh = Intel.stepUpdate(state, u, seenBefore);
      if (fresh.length && o.path.length) {
        contact = fresh;
        o.status = 'contact';
        reason = `виявлено противника (${fresh.length}) — рух зупинено, підрозділ чекає рішення командира`;
        break;
      }
    }
    if (moved > 0) u.movedThisPhase = true;
    if (u.carrying && u.carrying.length) Transport.syncPassengers(state, u);
    Intel.update(state);
    const from = g.label(startIdx), to = g.label(u.idx);
    const nm = ORDER_NAMES[o.type];
    if (!o.path.length) {
      log(state, `${u.name}: прибув у ${to} (${nm.toLowerCase()}, пройдено ${moved} гекс., витрачено ${fmt(spent)} ОР${u.vehicle ? `, пальне ${fmt(u.vehicle.fuel)} л` : ''}${u.carrying && u.carrying.length ? `, пасажирів ${Transport.load(state, u)}` : ''}). Наказ виконано, підрозділ чекає наступного.`, 'move', u.faction);
      u.order = null;
    } else if (moved > 0) {
      log(state, `${u.name}: ${from} → ${to}, пройдено ${moved} гекс., витрачено ${fmt(spent)} ОР; ${reason}. Залишок маршруту: ${o.path.length} гекс.`, contact.length ? 'warn' : 'move', u.faction);
    } else {
      log(state, `${u.name}: рух неможливий — ${reason || 'немає очок руху'}.`, o.status === 'blocked' ? 'warn' : 'move', u.faction);
    }
    snapshot(state, u);
    return { moved, spent, reason, contact };
  }

  // Останній доклад командуванню (зв’язок поки завжди є)
  function snapshot(state, u) {
    if (!u.comm.connected) return;
    u.lastReport = {
      day: state.time.day, hour: state.time.hour, idx: u.idx,
      fit: u.personnel.fit, morale: u.morale,
      order: u.order ? `${u.order.type}:${u.order.target}` : null
    };
  }

  // -------------------------------------------------------------------- фази
  function startFactionPhase(state) {
    const f = phaseFaction(state);
    if (f === null) return;
    log(state, `Фаза: ${fname(f)}.`, 'phase', f, null);
    for (const u of state.units) {
      if (u.faction !== f) continue;
      u.mp = mpMax(u);
      u.movedThisPhase = false;
      if (u.pendingOrder) {
        const po = u.pendingOrder; u.pendingOrder = null;
        if (po.type === 'defend' || po.type === 'observe') {
          u.order = null; u.stance = po.type;
          log(state, `${u.name}: розпочато виконання відкладеного наказу «${ORDER_NAMES[po.type]}».`, 'order', f);
        } else {
          u.order = po; leavePosition(state, u);
          log(state, `${u.name}: розпочато виконання відкладеного наказу «${ORDER_NAMES[po.type]}».`, 'order', f);
        }
      }
    }
    for (const u of state.units) if (u.faction === f && u.carrying && u.carrying.length) Transport.syncPassengers(state, u);
    Intel.update(state);
    for (const u of state.units) {
      if (u.faction === f && u.order && (u.order.type === 'move' || u.order.type === 'retreat')) executeMove(state, u);
    }
    Intel.update(state);
  }

  function endPhase(state) {
    const f = phaseFaction(state);
    if (f === null) return { ok: false, reason: 'Невідома фаза.' };
    if (state.campaign && state.campaign.over) return { ok: false, reason: 'Кампанію завершено. Почніть нову гру або завантажте збереження.' };
    log(state, `Фазу «${fname(f)}» завершено.`, 'phase', f, null);
    state.phase++;
    let hourEnded = false;
    if (state.phase === 3) {
      endOfHour(state);
      hourEnded = true;
      state.phase = 0;
      // Уникаємо постійної переваги першого ходу: порядок фаз зсувається на один крок щогодини
      // (хто був першим, стає останнім) — за 3 години кожна фракція рівно по разу ходить
      // першою, другою й третьою.
      const order = state.phaseOrder || (state.phaseOrder = [0, 1, 2]);
      state.phaseOrder = [order[1], order[2], order[0]];
      log(state, `Новий порядок фаз на цю годину: ${state.phaseOrder.map(fname).join(' → ')}.`, 'phase', null, null);
    }
    startFactionPhase(state);
    return { ok: true, hourEnded };
  }

  function isNight(hour) {
    const n = CONFIG.detection.night;
    return n.from > n.to ? (hour >= n.from || hour <= n.to) : (hour >= n.from && hour <= n.to);
  }

  function endOfHour(state) {
    const prev = timeLabel(state.time);
    const g = grid(state);
    const C = CONFIG.combat;
    const turn = state.time.turn;
    const occ = occupancy(state);

    // 1. Контроль: гекс утримано до кінця години лише однією фракцією
    if (CONFIG.rules.controlByHolding) {
      const changed = [0, 0, 0];
      for (const [idx, list] of occ) {
        const fs = new Set(list.filter(u => u.personnel.fit > 0).map(u => u.faction));
        if (fs.size !== 1) continue;
        const f = [...fs][0];
        if (state.map.control[idx] !== f) { state.map.control[idx] = f; changed[f]++; }
      }
      changed.forEach((n, f) => { if (n) log(state, `${fname(f)}: утримано й взято під контроль ${n} гекс.`, 'event', f); });
    }
    if (CONFIG.rules.settlementControlByCenter) {
      for (const s of state.map.settlements) {
        const c = state.map.control[s.center];
        if (c !== s.control) {
          const was = s.control >= 0 ? fname(s.control) : 'нікого';
          const prevCtl = s.control;
          s.control = c;
          Politics.onCapture(state, s, prevCtl, c);
          log(state, `${s.name}: контроль перейшов від «${was}» до «${c >= 0 ? fname(c) : 'нікого'}» (центральний гекс).`, 'event', c, null);
          // Звільнення (взяли в живого ворога, не щойно відкрили «нічийний» пункт) —
          // хвиля підтримки й добровольці з-за кордону (07h_foreign.js).
          if (c >= 0 && prevCtl >= 0 && prevCtl !== c) Foreign.onLiberate(state, c, s, prevCtl);
          // Рішення автора: узяли центр — решту села вручну обходити не треба. Усі гекси
          // цього населеного пункту, де немає живого ворога, одразу переходять під контроль
          // нового господаря; гекс, де ще сидить противник, залишається спірним до бою/виходу.
          if (c >= 0 && CONFIG.rules.settlementAutoCapture) {
            let flipped = 0, contested = 0;
            for (let idx = 0; idx < state.map.settlement.length; idx++) {
              if (state.map.settlement[idx] !== s.id) continue;
              if (state.map.control[idx] === c) continue;
              const list = occ.get(idx);
              const hasEnemy = list && list.some(u => u.faction !== c && u.personnel.fit > 0);
              if (hasEnemy) { contested++; continue; }
              state.map.control[idx] = c; flipped++;
            }
            if (flipped) log(state, `${s.name}: після взяття центру решта пункту (${flipped} гекс.) теж перейшла під контроль «${fname(c)}»${contested ? `; ще ${contested} гекс. утримує противник` : ''}.`, 'event', c, null);
          }
          // Рішення автора: разом із селом переходить і дорога до нього — вузька смуга,
          // не ціле поле навколо. Йдемо вздовж дорожньої мережі від центру, не далі
          // налаштованого ліміту гексів, і одразу зупиняємось, щойно впираємось у чужий
          // населений пункт — щоб «порожня» дорога ніколи не дотягувалась до міста ворога.
          if (c >= 0 && CONFIG.rules.roadCaptureMaxHexes) {
            const maxD = CONFIG.rules.roadCaptureMaxHexes;
            const roadHexes = new Set();
            const dist = new Map([[s.center, 0]]);
            const queue = [s.center];
            while (queue.length) {
              const cur = queue.shift();
              const dCur = dist.get(cur);
              if (dCur >= maxD) continue;
              for (let d = 0; d < 6; d++) {
                const n = g.neighbor(cur, d);
                if (n < 0 || dist.has(n)) continue;
                if (!roadBetween(state, cur, d, n)) continue;
                if (state.map.settlement[n] >= 0 && state.map.settlement[n] !== s.id) continue;
                dist.set(n, dCur + 1); roadHexes.add(n); queue.push(n);
              }
            }
            const buf = CONFIG.rules.roadCaptureBuffer || 0;
            let frontier = new Set(roadHexes);
            for (let step = 0; step < buf; step++) {
              const next = new Set();
              for (const idx of frontier) {
                for (let d = 0; d < 6; d++) {
                  const n = g.neighbor(idx, d);
                  if (n < 0 || roadHexes.has(n)) continue;
                  if (state.map.settlement[n] >= 0 && state.map.settlement[n] !== s.id) continue;
                  next.add(n);
                }
              }
              for (const n of next) roadHexes.add(n);
              frontier = next;
            }
            let rFlipped = 0, rContested = 0;
            for (const idx of roadHexes) {
              if (state.map.control[idx] === c) continue;
              // об’єкти поза пунктами (заводи, польові склади на трасі) разом із селом не
              // переходять — їх треба взяти окремо, утримавши гекс
              if (typeof Logistics !== 'undefined' && Logistics.facilityAt(state, idx).length) continue;
              const list = occ.get(idx);
              const hasEnemy = list && list.some(u => u.faction !== c && u.personnel.fit > 0);
              if (hasEnemy) { rContested++; continue; }
              state.map.control[idx] = c; rFlipped++;
            }
            if (rFlipped) log(state, `${s.name}: контроль поширився на дорогу до села й узбіччя (${rFlipped} гекс.)${rContested ? `; ще ${rContested} гекс. утримує противник` : ''}.`, 'event', c, null);
          }
        }
      }
    }

    // 2. Стан підрозділів: укріплення, придушення, мораль, відсталі
    for (const u of state.units.slice()) {
      const adjEnemies = adjacentEnemies(state, u, occ);
      const enemyAdj = adjEnemies.length > 0;
      const inCombat = u.combatTurn === turn;
      // обладнання позицій
      // Окопи: лише піхота/інженери (не техніка) і лише в полі/лісі — не в горах (копати
      // скалу нічим) і не в забудові (там своя cover, див. CONFIG.combat.cover).
      if (u.stance === 'defend' && u.movedTurn !== turn && u.fort < C.fortMax && canAct(u)
          && unitType(u).move === 'foot' && CONFIG.engineering.trenchTerrain.includes(terrainKey(state, u.idx))) {
        u.fort++;
        log(state, `${u.name}: обладнано окопи, рівень оборони ${u.fort}.`, 'info', u.faction);
      }
      // придушення спадає
      if (u.suppression > 0) u.suppression = Math.max(0, u.suppression - C.suppressionDecayPerHour);
      // непоховані тіла своїх загиблих у гексі тиснуть на мораль, поки їх не забрали; поки вони
      // лежать поруч, звичне відновлення моралі також не йде (інакше воно одразу ж компенсує
      // втрату — втрата й відновлення мали б рівну величину, й дебаф непомітно гасився б сам).
      const deadHere = Loot.cacheAt(state, u.idx, false);
      const deadPenalty = !!(deadHere && deadHere.dead && deadHere.dead[u.faction] > 0);
      if (deadPenalty) u.morale = Math.max(0, u.morale - C.deadMoraleLoss);
      // мораль відновлюється без бою та контакту
      if (!inCombat && !enemyAdj && !deadPenalty && u.morale < u.baseMorale) {
        const home = u.ethnic && Politics.homeFactor(state, u) < 1 ? CONFIG.population.militia.homeRecover : 0;
        // Командний пункт (запит гравця): у радіусі moraleRadius від свого діючого КП підрозділи
        // відновлюють мораль швидше — зв’язок зі штабом підтримує бойовий дух.
        const cpCfg = CONFIG.facilities.cp;
        const nearCP = Logistics.facilities(state).some(f => f.type === 'cp' && f.owner === u.faction && !f.destroyed && f.condition > 0 && grid(state).dist(f.idx, u.idx) <= cpCfg.moraleRadius);
        const cp = nearCP ? cpCfg.moraleBonus : 0;
        const add = Math.min(C.moraleRecoverPerHour + (u.stance === 'defend' ? 1 : 0) + home + cp, u.baseMorale - u.morale);
        u.morale += add;
      }
      // відсталі бійці
      const p = u.personnel;
      if (p.straggling > 0) {
        if (enemyAdj) {
          // Рішення автора: відсталі боєздатні бійці біля живого ворога не просто «зникають
          // безвісти» — їх бере в полон найближчий противник, як і покинутих поранених.
          const lost = Math.ceil(p.straggling * C.stragglerLostShare);
          p.straggling -= lost;
          const captor = adjEnemies[0];
          p.captured += lost;
          Politics.recordCaptured(state, captor.faction, lost);
          state.prisoners.push({ holder: captor.faction, origin: u.faction, count: lost, unit: u.name, day: state.time.day, hour: state.time.hour });
          log(state, `${u.name}: ${lost} відсталих бійців потрапили в полон до «${fname(captor.faction)}».`, 'warn', u.faction, [u.faction, captor.faction]);
        } else {
          const back = Math.max(1, Math.ceil(p.straggling * C.stragglerReturnShare));
          const n = Math.min(back, p.straggling);
          p.straggling -= n; p.fit += n;
          log(state, `${u.name}: повернулися ${n} відсталих бійців (відновлено зв’язок із підрозділом).`, 'info', u.faction);
          if (p.straggling === 0 && u.dispersal > 0) { u.dispersal = 0; log(state, `${u.name}: підрозділ знову зібраний.`, 'info', u.faction); }
          else if (u.dispersal === 3 && p.fit > 0) u.dispersal = 2;
        }
      }
      u.surrounded = false;
      snapshot(state, u);
    }
    Combat.cleanup(state);
    Logistics.endOfHour(state);
    Field.endOfHour(state);
    Recruit.endOfHour(state);
    Foreign.hourForeign(state);
    if (typeof Decisions !== 'undefined') Decisions.hour(state);
    Politics.endOfHour(state);

    // Умовні події — етап 4
    state.time.hour++;
    state.time.turn++;
    if (state.time.hour >= CONFIG.hoursPerDay) {
      state.time.hour = 0;
      state.time.day++;
      log(state, `Розпочалася доба ${state.time.day}.`, 'day', null);
    }
    Intel.update(state);
    Politics.checkCampaign(state);
    log(state, `Завершення години (${prev}). Настала ${timeLabel(state.time)}${isNight(state.time.hour) ? ' — ніч, видимість знижена' : ''}.`, 'hour', null);
  }

  function adjacentEnemies(state, u, occ) {
    const g = grid(state);
    const out = [];
    occ = occ || occupancy(state);
    for (let d = 0; d < 6; d++) {
      const n = g.neighbor(u.idx, d); if (n < 0) continue;
      const list = occ.get(n);
      if (list) for (const e of list) if (e.faction !== u.faction && e.personnel.fit > 0) out.push(e);
    }
    return out;
  }

  // Пропозиція для наказу «Відступ»: найкращий тиловий гекс у межах години руху
  function suggestRetreat(state, unitId) {
    const u = unitById(state, unitId);
    if (!u || u.embarked != null) return null;
    const g = grid(state);
    let threat = -1, best = Infinity;
    for (const m of Intel.knownList(state, u.faction)) { const d = g.dist(u.idx, m.idx); if (d < best) { best = d; threat = m.idx; } }
    const r = Combat.findRetreatHex(state, u, threat, 1);
    return r.idx >= 0 ? r.idx : null;
  }

  function newGame(seed) {
    const state = Scenario.build(seed);
    log(state, `Кампанію розпочато: ${state.meta.scenario}, карта ${state.map.w}×${state.map.h} гексів (seed ${seed}).`, 'event', null);
    Intel.update(state);
    startFactionPhase(state);
    return state;
  }

  function controlStats(state) {
    const s = [0, 0, 0, 0];
    for (let i = 0; i < state.map.control.length; i++) {
      const c = state.map.control[i];
      if (state.map.terrain[i] === TERRAIN_ID.sea) continue;
      if (c >= 0) s[c]++; else s[3]++;
    }
    return s;
  }

  function fmt(x) { return (Math.round(x * 100) / 100).toString().replace('.', ','); }

  // Допоміжне: прокрутити фази до початку фази конкретної фракції (бо через ротацію порядку
  // фаз «фаза №0» вже не завжди означає фракцію 0). Обмежено 3 кроками — довше не буває.
  function advanceToFaction(state, f) {
    let k = 0;
    while (phaseFaction(state) !== f && k++ < 3) endPhase(state);
    return state;
  }

  return {
    PHASE_NAMES, ORDER_NAMES, grid, phaseFaction, unitType, moveClass, mpMax, unitById, timeLabel, fname, canAct, log,
    occupancy, unitsAt, terrainKey, roadBetween, stepCost, hexPassable, adjacentEnemies, knownForeignHexes,
    findPath, reachable, previewMove, issueMoveOrder, suggestRetreat, deploy, setStance, cancelOrder, executeMove, startFactionPhase, checkCommandable,
    endPhase, endOfHour, newGame, controlStats, addHours, fmt, isNight, snapshot, leavePosition, advanceToFaction
  };
})();
