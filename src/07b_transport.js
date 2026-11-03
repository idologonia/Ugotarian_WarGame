// ============================================================================
// МОДУЛЬ: ТРАНСПОРТ І ОРГАНІЗАЦІЯ ПІДРОЗДІЛІВ
// Посадка/висадка, пасажири, пальне, знищення машини з людьми.
// Виділення відділення зі взводу та об’єднання підрозділів.
// ============================================================================
const Transport = (() => {
  const T = () => CONFIG.transport;
  const O = () => CONFIG.organization;

  function vdef(u) { return CONFIG.unitTypes[u.type].vehicle || null; }
  function isVehicle(u) { return !!vdef(u); }
  function persons(u) { return u.personnel.fit + u.personnel.wounded; }
  function passengers(state, v) { return (v.carrying || []).map(id => Engine.unitById(state, id)).filter(Boolean); }
  function load(state, v) { return passengers(state, v).reduce((a, p) => a + persons(p), 0); }
  function capacity(v) { return v.vehicle ? v.vehicle.passengers : 0; }
  function carrierOf(state, u) { return u.embarked != null ? Engine.unitById(state, u.embarked) : null; }
  function fuelPerMp(v) { const d = vdef(v); return d ? d.fuelPerHour / CONFIG.unitTypes[v.type].mp : 0; }
  function r1(x) { return Math.round(x * 10) / 10; }

  // Пасажири рухаються разом із машиною; їхній час години = частка часу машини
  function syncPassengers(state, v) {
    for (const p of passengers(state, v)) {
      p.idx = v.idx;
      p.mp = Engine.mpMax(p) * (Engine.mpMax(v) ? v.mp / Engine.mpMax(v) : 0);
    }
  }

  function boardReason(state, u, v) {
    if (!v || !isVehicle(v)) return 'Це не транспортний засіб.';
    if (isVehicle(u)) return 'Техніку не можна завантажити в іншу техніку.';
    if (Engine.moveClass(u) !== 'foot') return 'Посадка можлива лише для пішого підрозділу.';
    if (u.embarked != null) return 'Підрозділ уже в машині.';
    if (v.faction !== u.faction) return 'Машина належить іншій фракції.';
    if (v.idx !== u.idx) return 'Машина має бути в тому самому гексі.';
    if (v.destroyed || v.personnel.fit <= 0) return 'У машини немає боєздатного екіпажу.';
    const free = capacity(v) - load(state, v);
    if (persons(u) > free) return `Не вистачає місць: потрібно ${persons(u)}, вільно ${free} з ${capacity(v)}.`;
    const cost = Engine.mpMax(u) * T().boardShare;
    if (u.mp < cost - 1e-9) return `Посадка займає ${T().boardShare * 100}% години, а в підрозділу залишилось ${Engine.fmt(u.mp)} з ${Engine.mpMax(u)} ОР.`;
    if (u.attackedTurn === state.time.turn) return 'Підрозділ уже вів бій цієї години.';
    return null;
  }

  function vehiclesFor(state, u) {
    return state.units.filter(v => isVehicle(v) && v.faction === u.faction && v.idx === u.idx && !v.destroyed)
      .map(v => ({ v, reason: boardReason(state, u, v), free: capacity(v) - load(state, v) }));
  }

  function board(state, unitId, vehicleId) {
    const u = Engine.unitById(state, unitId), v = Engine.unitById(state, vehicleId);
    // allowDispersed: розсіяний підрозділ усе ще можна евакуювати машиною (запит гравця).
    const err = Engine.checkCommandable(state, u, { allowDispersed: true });
    if (err) return { ok: false, reason: err };
    const why = boardReason(state, u, v);
    if (why) return { ok: false, reason: why };
    const share = T().boardShare;
    if (u.order || u.pendingOrder) Engine.log(state, `${u.name}: попередній наказ скасовано через посадку.`, 'order', u.faction);
    u.order = null; u.pendingOrder = null; u.stance = 'none'; u.fort = 0; u.deployed = false;
    u.embarked = v.id;
    v.carrying = (v.carrying || []).concat(u.id);
    v.mp = Math.max(0, v.mp - Engine.mpMax(v) * share);
    if (v.fort) v.fort = 0;
    syncPassengers(state, v);
    u.movedThisPhase = true; u.movedTurn = state.time.turn;
    Engine.log(state, `${u.name}: посадка в ${v.name} (${load(state, v)}/${capacity(v)} місць). Посадка зайняла ${share * 100}% години; машина може рухатися далі в межах решти часу.`, 'order', u.faction);
    Intel.update(state);
    return { ok: true };
  }

  function unload(state, u, v, cost) {
    v.carrying = (v.carrying || []).filter(id => id !== u.id);
    u.embarked = null;
    u.idx = v.idx;
    const frac = Engine.mpMax(v) ? v.mp / Engine.mpMax(v) : 0;
    u.mp = Math.max(0, Engine.mpMax(u) * frac - (cost ? Engine.mpMax(u) * T().boardShare : 0));
  }

  function disembark(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u);
    if (err && !(u && u.embarked != null && u.faction === Engine.phaseFaction(state))) return { ok: false, reason: err };
    if (!u || u.embarked == null) return { ok: false, reason: 'Підрозділ не перебуває в машині.' };
    const v = carrierOf(state, u);
    if (!v) { u.embarked = null; return { ok: true }; }
    v.mp = Math.max(0, v.mp - Engine.mpMax(v) * T().boardShare);
    unload(state, u, v, true);
    syncPassengers(state, v);
    Engine.log(state, `${u.name}: висадка з ${v.name} у ${Engine.grid(state).label(u.idx)}. Висадка зайняла ${T().boardShare * 100}% години.`, 'order', u.faction);
    Intel.update(state);
    return { ok: true };
  }

  function disembarkAll(state, vehicleId) {
    const v = Engine.unitById(state, vehicleId);
    if (!v) return { ok: false, reason: 'Машину не знайдено.' };
    if (v.faction !== Engine.phaseFaction(state)) return { ok: false, reason: 'Накази можна віддавати лише у фазі своєї фракції.' };
    const list = passengers(state, v);
    if (!list.length) return { ok: false, reason: 'У машині немає пасажирів.' };
    v.mp = Math.max(0, v.mp - Engine.mpMax(v) * T().boardShare);
    for (const p of list) unload(state, p, v, true);
    Engine.log(state, `${v.name}: висаджено ${list.map(p => p.name).join(', ')} у ${Engine.grid(state).label(v.idx)} (${T().boardShare * 100}% години).`, 'order', v.faction);
    Intel.update(state);
    return { ok: true, count: list.length };
  }

  // Примусова висадка (екіпаж вибув, машина зупинена)
  function forceUnloadAll(state, v, why) {
    const list = passengers(state, v);
    for (const p of list) unload(state, p, v, false);
    if (list.length) Engine.log(state, `${v.name}: ${why} — пасажири (${list.map(p => p.name).join(', ')}) залишили машину в ${Engine.grid(state).label(v.idx)}.`, 'warn', v.faction);
  }

  // Знищення машини: кожен, хто був усередині, — загиблий («200») або поранений («300»)
  function wreck(state, v, lines) {
    const share = T().destroyedKilledShare;
    const aboard = [v].concat(passengers(state, v));
    let k200 = 0, k300 = 0;
    for (const u of aboard) {
      const p = u.personnel;
      const n = p.fit;
      const killed = Math.round(n * share);
      const wounded = n - killed;
      p.fit = 0; p.killed += killed; p.wounded += wounded;
      if (killed > 0) Loot.onKilled(state, u, killed, n);
      k200 += killed; k300 += wounded;
      if (u !== v) {
        lines.push(`${u.name} (пасажири): «200» — ${killed}, «300» — ${wounded}.`);
        u.embarked = null;
      }
    }
    v.carrying = [];
    lines.push(`${v.name}: машину знищено разом з усіма, хто був усередині. Разом: загиблих ${k200}, поранених ${k300}.`);
  }

  // Вогонь по машині зачіпає пасажирів з тією ж інтенсивністю на людину
  function hitPassengers(state, v, perPersonRaw, suppGain, lines) {
    const out = [];
    for (const p of passengers(state, v)) {
      const raw = perPersonRaw * p.personnel.fit;
      const r = Combat.inflict(state, p, raw);
      p.suppression = Math.min(100, p.suppression + suppGain);
      p.lastLoss = r.cas; p.combatTurn = state.time.turn;
      const before = p.personnel.fit + r.cas;
      const m = Combat.moraleAfter(state, p, { cas: r.cas, fitBefore: before, supp: Math.round(suppGain * 10) / 10, cond: 0 }, {});
      lines.push(`${p.name} (пасажири ${v.name}): уражено ${r.cas} (загинули ${r.killed}, поранені ${r.wounded}), боєздатних ${p.personnel.fit}; мораль ${m.before} → ${m.after}.`);
      out.push({ p, r });
    }
    return out;
  }

  // Витрата пального на крок; повертає false, якщо пального не вистачає
  function burnFuel(state, v, cost) {
    if (!v.vehicle) return true;
    const need = cost * fuelPerMp(v);
    if (v.vehicle.fuel + 1e-9 < need) return false;
    v.vehicle.fuel = Math.max(0, r1(v.vehicle.fuel - need));
    return true;
  }

  // -------------------------------------------- залишення техніки екіпажем
  // Екіпаж можна зберегти пішим, не чекаючи, поки машину знищать разом із ним (наприклад,
  // машина пошкоджена, без пального або просто недоцільно ризикувати нею далі). Машина
  // лишається в гексі як трофей (Field.leaveVehicle) — її може підняти свій (новий екіпаж)
  // або противник (своїм екіпажем, Field.takeVehicle).
  function abandonReason(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    if (!u.vehicle) return 'Це не технічка.';
    if (u.destroyed) return 'Машину вже знищено.';
    if (u.personnel.fit <= 0) return 'У машині немає боєздатного екіпажу.';
    const cost = Engine.mpMax(u) * CONFIG.abandon.share;
    if (u.mp < cost - 1e-9) return `Залишення машини займає ${CONFIG.abandon.share * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
    if (u.attackedTurn === state.time.turn) return 'Підрозділ уже вів бій цієї години.';
    return null;
  }
  function abandonVehicle(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    const why = abandonReason(state, u);
    if (why) return { ok: false, reason: why };
    if (u.carrying && u.carrying.length) forceUnloadAll(state, u, 'екіпаж залишає машину');
    const crewN = u.personnel.fit;
    const idx = u.idx, faction = u.faction;
    Field.leaveVehicle(state, u);   // не знищена -> лишається цілою технікою-трофеєм, не уламками
    const n = nextNumber(state, 'crew', faction);
    const crew = Scenario.createUnit(state, 'crew', faction, idx, n);
    crew.personnel = { assigned: crewN, fit: crewN, wounded: u.personnel.wounded, killed: 0, captured: 0, missing: 0, straggling: 0 };
    crew.weapons = {}; crew.ammo = {};
    const arsenal = Scenario.arsenal[faction];
    if (arsenal) { crew.weapons[arsenal.carbine] = crewN; crew.ammo = Scenario.ammoFor(crew.weapons); }
    crew.morale = u.morale; crew.baseMorale = u.baseMorale; crew.experience = u.experience; crew.xp = u.xp;
    crew.mp = 0; crew.movedThisPhase = true; crew.movedTurn = state.time.turn;
    state.units.push(crew);
    const name = u.name, model = u.vehicle.model;
    state.units = state.units.filter(x => x !== u);
    Engine.log(state, `${name}: екіпаж (${crewN} ос.) залишає ${model} у ${Engine.grid(state).label(idx)} і йде пішим — тепер ${crew.name}. Машину може підняти будь-хто з екіпажем.`, 'order', faction);
    Intel.update(state);
    return { ok: true, unitId: crew.id };
  }

  // ------------------------------------------------- організація підрозділів
  const RIFLES = ['АК-74', 'АКМ', 'АКС-74У'];

  function nextNumber(state, typeId, faction) {
    let max = 0;
    const ut = CONFIG.unitTypes[typeId];
    const re = new RegExp('^' + ut.short.replace('.', '\\.') + ' №(\\d+)');
    for (const u of state.units.concat(state.lost || [])) {
      if (u.faction !== faction) continue;
      const m = re.exec(u.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  function splitReason(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    if (!O().splittable.includes(u.type)) return 'Виділяти відділення можна лише з піхотного взводу.';
    if (u.embarked != null) return 'Спершу висадіть підрозділ із машини.';
    const n = O().squadSize;
    if (u.personnel.fit < n * 2) return `Для виділення відділення потрібно щонайменше ${n * 2} боєздатних (зараз ${u.personnel.fit}).`;
    const cost = Engine.mpMax(u) * O().actionShare;
    if (u.mp < cost - 1e-9) return `Реорганізація займає ${O().actionShare * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
    if (u.attackedTurn === state.time.turn) return 'Підрозділ уже вів бій цієї години.';
    return null;
  }

  function splitSquad(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    const why = splitReason(state, u);
    if (why) return { ok: false, reason: why };
    const n = O().squadSize;
    // Зброя: 1 РПК (якщо є), автомати на решту, 1 одноразовий ПТГ (якщо є)
    const take = {};
    const grab = (m, k) => { const have = (u.weapons[m] || 0) - (take[m] || 0); const t = Math.min(have, k); if (t > 0) take[m] = (take[m] || 0) + t; return t; };
    let armed = grab('РПК', 1);
    for (const m of RIFLES) { if (armed >= n) break; armed += grab(m, n - armed); }
    for (const m of Object.keys(u.weapons)) { if (armed >= n) break; if (m === 'Одноразовий ПТГ') continue; armed += grab(m, n - armed); }
    grab('Одноразовий ПТГ', 1);
    // Боєприпаси — пропорційно до переданої зброї кожної категорії
    const ammo = {};
    const cats = {};
    for (const [m, k] of Object.entries(u.weapons)) { const w = CONFIG.weapons[m]; if (w) cats[w.ammo] = (cats[w.ammo] || 0) + k; }
    const moved = {};
    for (const [m, k] of Object.entries(take)) { const w = CONFIG.weapons[m]; if (w) moved[w.ammo] = (moved[w.ammo] || 0) + k; }
    for (const [c, k] of Object.entries(moved)) ammo[c] = Math.floor((u.ammo[c] || 0) * k / cats[c]);
    for (const [m, k] of Object.entries(take)) { u.weapons[m] -= k; if (u.weapons[m] <= 0) delete u.weapons[m]; }
    for (const [c, k] of Object.entries(ammo)) u.ammo[c] = (u.ammo[c] || 0) - k;
    const cost = Engine.mpMax(u) * O().actionShare;
    u.mp -= cost;
    u.personnel.fit -= n; u.personnel.assigned -= n;
    const s = Scenario.createUnit(state, 'inf_squad', u.faction, u.idx, nextNumber(state, 'inf_squad', u.faction));
    s.weapons = take; s.ammo = ammo;
    s.morale = u.morale; s.baseMorale = u.baseMorale; s.experience = u.experience; s.xp = u.xp;
    s.suppression = u.suppression; s.mp = u.mp; s.movedThisPhase = true; s.movedTurn = state.time.turn;
    s.fort = u.fort; s.stance = u.stance === 'defend' ? 'defend' : 'none';
    state.units.splice(state.units.indexOf(u) + 1, 0, s);
    Engine.log(state, `${u.name}: виділено ${s.name} (${n} осіб; ${Object.entries(take).map(([m, k]) => `${m} ×${k}`).join(', ')}). У взводі залишилось ${u.personnel.fit} боєздатних.`, 'order', u.faction);
    Engine.snapshot(state, u); Engine.snapshot(state, s);
    return { ok: true, newId: s.id };
  }

  function mergeReason(state, a, b) {
    if (!a || !b || a === b) return 'Оберіть два різні підрозділи.';
    if (a.faction !== b.faction) return 'Підрозділи належать різним фракціям.';
    if (a.idx !== b.idx) return 'Підрозділи мають бути в одному гексі.';
    if (!O().mergeable.includes(a.type) || !O().mergeable.includes(b.type)) return 'Об’єднувати можна піхотні підрозділи, кулеметні групи, гранатометників, розвідників, інженерів і логістичну групу.';
    if (a.embarked != null || b.embarked != null) return 'Спершу висадіть підрозділи з машини.';
    for (const u of [a, b]) {
      if (u.mp < Engine.mpMax(u) * O().actionShare - 1e-9) return `${u.name}: реорганізація займає ${O().actionShare * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
      if (u.attackedTurn === state.time.turn) return `${u.name}: уже вів бій цієї години.`;
    }
    return null;
  }

  function merge(state, intoId, fromId) {
    const a = Engine.unitById(state, intoId), b = Engine.unitById(state, fromId);
    const err = Engine.checkCommandable(state, a);
    if (err) return { ok: false, reason: err };
    const why = mergeReason(state, a, b);
    if (why) return { ok: false, reason: why };
    const pa = a.personnel, pb = b.personnel;
    const wFit = pa.fit + pb.fit || 1;
    const wAs = pa.assigned + pb.assigned || 1;
    const morale = Math.round((a.morale * pa.fit + b.morale * pb.fit) / wFit);
    const base = Math.round((a.baseMorale * pa.assigned + b.baseMorale * pb.assigned) / wAs);
    const xp = Math.floor((a.xp * pa.assigned + b.xp * pb.assigned) / wAs);
    for (const k of Object.keys(pa)) pa[k] += pb[k] || 0;
    for (const [m, n] of Object.entries(b.weapons)) a.weapons[m] = (a.weapons[m] || 0) + n;
    for (const [c, n] of Object.entries(b.ammo)) a.ammo[c] = (a.ammo[c] || 0) + n;
    // Рішення автора: вантаж (включно з goods — інженерне майно/БК, які тепер самі носять
    // інженери й логістична група) теж переходить до підрозділу, що приймає об’єднання, а не
    // зникає разом із поглинутим.
    if (b.cargo) { const ca = Loot.ensureCargo(a); for (const [m, n] of Object.entries(b.cargo.weapons)) ca.weapons[m] = (ca.weapons[m] || 0) + n; for (const [c, n] of Object.entries(b.cargo.ammo)) ca.ammo[c] = (ca.ammo[c] || 0) + n; for (const [k, n] of Object.entries(b.cargo.goods || {})) ca.goods[k] = (ca.goods[k] || 0) + n; }
    a.morale = morale; a.baseMorale = base; a.xp = xp;
    const t = CONFIG.combat.xpForLevel;
    let lvl = 0; while (lvl + 1 < t.length && xp >= t[lvl + 1]) lvl++;
    const expBefore = a.experience;
    a.experience = lvl;
    a.suppression = Math.max(a.suppression, b.suppression);
    a.mp = Math.max(0, Math.min(a.mp, b.mp) - Engine.mpMax(a) * O().actionShare);
    a.fort = Math.min(a.fort, b.fort);
    a.order = null; a.pendingOrder = null;
    a.movedThisPhase = true; a.movedTurn = state.time.turn;
    // Тип: досить людей — взвод
    let renamed = '';
    if (a.type !== 'inf_platoon' && pa.assigned >= O().platoonMin && ['inf_squad', 'inf_platoon'].includes(a.type)) {
      const old = a.name;
      a.type = 'inf_platoon';
      a.name = `${CONFIG.unitTypes.inf_platoon.short} №${nextNumber(state, 'inf_platoon', a.faction)} ${['СВ', 'ДП', 'НП'][a.faction]}`;
      renamed = ` Підрозділ переформовано у взвод: ${old} → ${a.name}.`;
    }
    state.units = state.units.filter(u => u !== b);
    Engine.log(state, `${b.name} влито до ${a.name}: тепер ${pa.fit} боєздатних із ${pa.assigned} за штатом, мораль ${a.morale}, досвід «${CONFIG.experience[a.experience]}»${a.experience < expBefore ? ' (новобранці знизили загальний рівень)' : ''}.${renamed}`, 'order', a.faction);
    Engine.snapshot(state, a);
    Intel.update(state);
    return { ok: true };
  }

  function mergeCandidates(state, u) {
    return state.units.filter(x => x !== u && x.faction === u.faction && x.idx === u.idx && O().mergeable.includes(x.type) && x.embarked == null)
      .map(x => ({ u: x, reason: mergeReason(state, u, x) }));
  }

  return {
    isVehicle, passengers, load, capacity, carrierOf, persons, syncPassengers, vehiclesFor, boardReason, board,
    disembark, disembarkAll, forceUnloadAll, wreck, hitPassengers, burnFuel, fuelPerMp,
    abandonReason, abandonVehicle,
    splitReason, splitSquad, mergeReason, merge, mergeCandidates
  };
})();
