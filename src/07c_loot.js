// ============================================================================
// МОДУЛЬ: МІСЦЯ БОЇВ І ТРОФЕЇ
// Загиблі («200») залишають у гексі свою зброю та частку боєприпасів.
// Знищені підрозділи й машини залишають усе майно. Будь-який підрозділ
// у гексі може забрати трофеї: спершу переозброїти бійців без зброї,
// решту — у вантаж (обмежений кількістю людей).
// ============================================================================
const Loot = (() => {
  const L = () => CONFIG.loot;

  function isHolder(model) { const w = CONFIG.weapons[model]; return !!w && w.holder !== false; }
  function holders(u) { let n = 0; for (const [m, k] of Object.entries(u.weapons)) if (isHolder(m)) n += k; return n; }
  function count(obj) { return Object.values(obj || {}).reduce((a, b) => a + b, 0); }
  function add(dst, src) { for (const [k, n] of Object.entries(src || {})) if (n > 0) dst[k] = (dst[k] || 0) + n; }
  function ensureCargo(u) { if (!u.cargo) u.cargo = { weapons: {}, ammo: {}, goods: {} }; if (!u.cargo.goods) u.cargo.goods = {}; return u.cargo; }

  function caches(state) { if (!state.caches) state.caches = {}; return state.caches; }
  function cacheAt(state, idx, create) {
    const c = caches(state);
    if (!c[idx] && create) c[idx] = { idx, weapons: {}, ammo: {}, goods: {}, dead: [0, 0, 0], wrecks: [], vehicles: [], knownBy: [], seen: [null, null, null], created: { day: state.time.day, hour: state.time.hour } };
    if (c[idx] && !c[idx].goods) c[idx].goods = {};   // старі збереження/кеші без цього поля (рішення автора: піший вантаж тепер може нести «goods»)
    return c[idx] || null;
  }
  function isEmpty(c) { return !c || (count(c.weapons) === 0 && count(c.ammo) === 0 && count(c.goods) === 0); }

  // Пропорційний вибір k одиниць зброї (найбільший залишок, детерміновано)
  function pickWeapons(weapons, k, onlyHolders) {
    const list = Object.entries(weapons).filter(([m, n]) => n > 0 && (!onlyHolders || isHolder(m)));
    const total = list.reduce((a, [, n]) => a + n, 0);
    const out = {};
    if (total <= 0 || k <= 0) return out;
    k = Math.min(k, total);
    const parts = list.map(([m, n]) => { const q = n * k / total; return { m, n, base: Math.floor(q), rem: q - Math.floor(q) }; });
    let left = k - parts.reduce((a, p) => a + p.base, 0);
    parts.sort((a, b) => b.rem - a.rem || b.n - a.n || (a.m < b.m ? -1 : 1));
    for (const p of parts) { let t = p.base; if (left > 0 && t < p.n) { t++; left--; } if (t > 0) out[p.m] = t; }
    return out;
  }

  // Загинули k бійців: їхня особиста зброя й частка набоїв лишаються в гексі
  function onKilled(state, u, k, fitBefore) {
    if (k <= 0) return;
    const c = cacheAt(state, u.idx, true);
    c.dead[u.faction] += k;
    const drop = pickWeapons(u.weapons, Math.min(k, holders(u)), true);
    for (const [m, n] of Object.entries(drop)) { u.weapons[m] -= n; if (u.weapons[m] <= 0) delete u.weapons[m]; }
    add(c.weapons, drop);
    const share = fitBefore > 0 ? k / fitBefore : 1;
    for (const [cat, n] of Object.entries(u.ammo)) {
      const d = Math.floor(n * share);
      if (d > 0) { u.ammo[cat] -= d; c.ammo[cat] = (c.ammo[cat] || 0) + d; }
    }
    // вантаж загиблих теж лишається (зброя, набої і — рішення автора — тепер і goods:
    // інженерне майно/боєприпаси, які самі несли інженери чи логістична група)
    if (u.cargo) {
      const cw = pickWeapons(u.cargo.weapons, Math.round(count(u.cargo.weapons) * share), false);
      for (const [m, n] of Object.entries(cw)) { u.cargo.weapons[m] -= n; if (u.cargo.weapons[m] <= 0) delete u.cargo.weapons[m]; }
      add(c.weapons, cw);
      for (const [cat, n] of Object.entries(u.cargo.ammo || {})) {
        const d = Math.floor(n * share);
        if (d > 0) { u.cargo.ammo[cat] -= d; c.ammo[cat] = (c.ammo[cat] || 0) + d; }
      }
      for (const [k, n] of Object.entries(u.cargo.goods || {})) {
        const d = Math.floor(n * share);
        if (d > 0) { u.cargo.goods[k] -= d; c.goods[k] = (c.goods[k] || 0) + d; }
      }
    }
  }

  // Підрозділ вибув: усе майно лишається в гексі (рішення автора: тепер і goods з вантажу —
  // раніше піший вантаж goods не існував, тож ця гілка не враховувала його й воно просто
  // зникало при знищенні інженерів/логістичної групи, що несли матеріали)
  function dropAll(state, u) {
    const c = cacheAt(state, u.idx, true);
    if (u.vehicle) Field.leaveVehicle(state, u);   // машина (ціла чи уламки) лишається в гексі
    add(c.weapons, u.weapons); add(c.ammo, u.ammo);
    if (u.cargo) { add(c.weapons, u.cargo.weapons); add(c.ammo, u.cargo.ammo); add(c.goods, u.cargo.goods); }
    u.weapons = {}; u.ammo = {}; u.cargo = { weapons: {}, ammo: {}, goods: {} };
  }

  function cargoCap(u) {
    if (u.vehicle) {   // техніка: за масою вантажу
      const c = ensureCargo(u);
      return count(c.weapons) + Math.max(0, Math.floor((Logistics.cargoCapKg(u) - Logistics.cargoKg(u)) / CONFIG.weaponKg));
    }
    return Math.max(0, u.personnel.fit) * L().extraWeaponsPerPerson;
  }

  // Видати майно підрозділу: переозброєння → вантаж → решта в гекс
  function give(state, u, weapons, ammo, goods) {
    const usedCats = new Set(Object.keys(u.weapons).map(m => CONFIG.weapons[m] && CONFIG.weapons[m].ammo).filter(Boolean));
    const cargo = ensureCargo(u);
    const res = { armed: {}, cargo: {}, ammo: {}, cargoAmmo: {}, cargoGoods: {}, left: { weapons: {}, ammo: {} } };
    const pool = Object.assign({}, weapons);
    // 1. переозброєння бійців без особистої зброї
    let deficit = Math.max(0, u.personnel.fit - holders(u));
    if (deficit > 0) {
      const own = Object.keys(u.weapons);
      const order = Object.keys(pool).filter(m => isHolder(m)).sort((a, b) => (own.includes(b) - own.includes(a)) || (a < b ? -1 : 1));
      for (const m of order) {
        if (deficit <= 0) break;
        const t = Math.min(pool[m], deficit);
        if (t > 0) { u.weapons[m] = (u.weapons[m] || 0) + t; pool[m] -= t; deficit -= t; res.armed[m] = t; usedCats.add(CONFIG.weapons[m].ammo); }
      }
    }
    // 2. вантаж
    let room = cargoCap(u) - count(cargo.weapons);
    for (const m of Object.keys(pool).sort()) {
      const t = Math.min(pool[m], Math.max(0, room));
      if (t > 0) { cargo.weapons[m] = (cargo.weapons[m] || 0) + t; pool[m] -= t; room -= t; res.cargo[m] = t; }
      if (pool[m] > 0) res.left.weapons[m] = pool[m];
    }
    // 3. набої: свої калібри — у боєкомплект, інші — у вантаж
    for (const [cat, n] of Object.entries(ammo || {})) {
      if (n <= 0) continue;
      if (usedCats.has(cat)) { u.ammo[cat] = (u.ammo[cat] || 0) + n; res.ammo[cat] = n; }
      else { cargo.ammo[cat] = (cargo.ammo[cat] || 0) + n; res.cargoAmmo[cat] = n; }
    }
    // боєприпаси з вантажу, які тепер підходять до нової зброї
    for (const cat of usedCats) if (cargo.ammo[cat]) { u.ammo[cat] = (u.ammo[cat] || 0) + cargo.ammo[cat]; res.ammo[cat] = (res.ammo[cat] || 0) + cargo.ammo[cat]; delete cargo.ammo[cat]; }
    // 4. goods (інженерне майно, пальне тощо, якщо трапилися в кеші) — у вантаж, без вагового
    // ліміту, так само спрощено, як і набої вище (рішення автора).
    if (!cargo.goods) cargo.goods = {};
    for (const [k, n] of Object.entries(goods || {})) { if (n > 0) { cargo.goods[k] = (cargo.goods[k] || 0) + n; res.cargoGoods[k] = n; } }
    return res;
  }

  function describe(res) {
    const w = o => Object.entries(o).map(([m, n]) => `${m} ×${n}`).join(', ');
    const a = o => Object.entries(o).map(([c, n]) => `${CONFIG.ammo[c] ? CONFIG.ammo[c].name : c} ${n}`).join(', ');
    const parts = [];
    if (count(res.armed)) parts.push(`переозброєно: ${w(res.armed)}`);
    if (count(res.ammo)) parts.push(`набої: ${a(res.ammo)}`);
    if (count(res.cargo)) parts.push(`у вантаж: ${w(res.cargo)}`);
    if (count(res.cargoAmmo)) parts.push(`набої у вантаж: ${a(res.cargoAmmo)}`);
    if (res.cargoGoods && count(res.cargoGoods)) parts.push(`майно у вантаж: ${Object.entries(res.cargoGoods).map(([k, n]) => `${CONFIG.goods[k] ? CONFIG.goods[k].name : k} ${n}`).join(', ')}`);
    if (count(res.left.weapons)) parts.push(`не вмістилося й лишилося в гексі: ${w(res.left.weapons)}`);
    return parts.join('; ') || 'нічого';
  }

  function lootReason(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    const c = cacheAt(state, u.idx, false);
    if (isEmpty(c)) return 'У цьому гексі немає майна.';
    if (u.embarked != null) return 'Спершу висадіть підрозділ із машини.';
    if (u.personnel.fit <= 0) return 'Немає боєздатних бійців.';
    const cost = Engine.mpMax(u) * L().actionShare;
    if (u.mp < cost - 1e-9) return `Збір трофеїв займає ${L().actionShare * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
    if (u.attackedTurn === state.time.turn) return 'Підрозділ уже вів бій цієї години.';
    return null;
  }

  function loot(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    const why = lootReason(state, u);
    if (why) return { ok: false, reason: why };
    const c = cacheAt(state, u.idx, false);
    const res = give(state, u, c.weapons, c.ammo, c.goods);
    c.weapons = res.left.weapons; c.ammo = {}; c.goods = {};
    u.mp -= Engine.mpMax(u) * L().actionShare;
    u.movedThisPhase = true;
    const text = describe(res);
    Engine.log(state, `${u.name}: зібрано трофеї в ${Engine.grid(state).label(u.idx)} — ${text}.`, 'order', u.faction);
    remember(state, u.faction, c);
    return { ok: true, text };
  }

  function dropCargo(state, unitId) {
    const u = Engine.unitById(state, unitId);
    if (!u || u.faction !== Engine.phaseFaction(state)) return { ok: false, reason: 'Накази можна віддавати лише у фазі своєї фракції.' };
    const cargo = ensureCargo(u);
    if (!count(cargo.weapons) && !count(cargo.ammo) && !count(cargo.goods)) return { ok: false, reason: 'Вантаж порожній.' };
    const c = cacheAt(state, u.idx, true);
    add(c.weapons, cargo.weapons); add(c.ammo, cargo.ammo); add(c.goods, cargo.goods);
    u.cargo = { weapons: {}, ammo: {}, goods: {} };
    Engine.log(state, `${u.name}: вантаж залишено в ${Engine.grid(state).label(u.idx)}.`, 'order', u.faction);
    remember(state, u.faction, c);
    return { ok: true };
  }

  // Рішення автора (запит гравця): «забрати загиблих» — окрема дія від збору трофеїв і від
  // евакуації поранених (медевак). Прибирає тіла своєї фракції з гекса (знімає пов'язаний
  // дебаф моралі CONFIG.combat.deadMoraleLoss) і веде рахунок на статистику втрат.
  function recoverDeadReason(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    const c = cacheAt(state, u.idx, false);
    if (!c || !c.dead || !c.dead[u.faction]) return 'У цьому гексі немає тіл вашої фракції.';
    if (u.embarked != null) return 'Спершу висадіть підрозділ із машини.';
    if (u.personnel.fit <= 0) return 'Немає боєздатних бійців.';
    const cost = Engine.mpMax(u) * L().actionShare;
    if (u.mp < cost - 1e-9) return `Забрати загиблих займає ${L().actionShare * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
    if (u.attackedTurn === state.time.turn) return 'Підрозділ уже вів бій цієї години.';
    return null;
  }
  function recoverDead(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    const why = recoverDeadReason(state, u);
    if (why) return { ok: false, reason: why };
    const c = cacheAt(state, u.idx, true);
    const n = c.dead[u.faction] || 0;
    c.dead[u.faction] = 0;
    if (typeof Politics !== 'undefined' && state.stats && state.stats.recovered) state.stats.recovered[u.faction] += n;
    u.mp -= Engine.mpMax(u) * L().actionShare;
    u.movedThisPhase = true;
    Engine.log(state, `${u.name}: забрано тіла загиблих (${n}) у ${Engine.grid(state).label(u.idx)} — мораль підрозділів у гексі більше не тиснутиме через це.`, 'order', u.faction);
    remember(state, u.faction, c);
    return { ok: true, n };
  }

  // Що фракція знає про місце бою (оновлюється, коли гекс під спостереженням)
  function remember(state, f, c) {
    if (!c.knownBy.includes(f)) c.knownBy.push(f);
    c.seen[f] = { day: state.time.day, hour: state.time.hour, turn: state.time.turn, weapons: count(c.weapons), ammo: count(c.ammo), dead: c.dead.slice(), wrecks: (c.vehicles || []).length, vehicles: (c.vehicles || []).map(v => ({ model: v.model, wreck: v.wreck })) };
  }
  function updateKnowledge(state) {
    const cs = caches(state);
    for (const key of Object.keys(cs)) {
      const c = cs[key];
      for (let f = 0; f < 3; f++) if (Intel.hexObserved(state, f, c.idx)) remember(state, f, c);
      if (isEmpty(c) && !c.dead.some(Boolean) && !(c.vehicles || []).length) delete cs[key];
    }
  }
  function known(state, f) {
    return Object.values(caches(state)).filter(c => c.knownBy.includes(f)).map(c => ({ c, seen: c.seen[f], now: Intel.hexObserved(state, f, c.idx) }));
  }

  return { isHolder, holders, onKilled, dropAll, give, describe, loot, lootReason, dropCargo, recoverDead, recoverDeadReason, cacheAt, caches, remember, updateKnowledge, known, cargoCap, ensureCargo, count, isEmpty, add };
})();
