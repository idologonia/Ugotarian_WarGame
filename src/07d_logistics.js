// ============================================================================
// МОДУЛЬ: ЛОГІСТИКА, МЕДИЦИНА, ЕКОНОМІКА (етап 3)
// Усі запаси фізичні: лежать на складах, у вантажі техніки або в підрозділах.
// Склад нічого не створює сам; виробляють лише підприємства.
// Тилова мережа: об’єкти й підрозділи, з’єднані своєю територією без противника.
// ============================================================================
const Logistics = (() => {
  const LG = () => CONFIG.logistics;
  const MD = () => CONFIG.medical;
  const EC = () => CONFIG.economy;
  const EN = () => CONFIG.engineering;
  const FT = () => CONFIG.facilities;
  const CV = () => CONFIG.convoy;
  const g = s => Engine.grid(s);
  const r1 = x => Math.round(x * 10) / 10;
  const sumObj = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const addObj = (dst, src, k = 1) => { for (const [key, n] of Object.entries(src || {})) { const v = Math.floor(n * k); if (v > 0) dst[key] = (dst[key] || 0) + v; } };

  function emptyStock() { return { ammo: {}, weapons: {}, goods: {} }; }
  function stockKg(st) {
    let kg = 0;
    for (const [c, n] of Object.entries(st.ammo || {})) kg += n * (CONFIG.ammo[c] ? CONFIG.ammo[c].kg : 0);
    kg += sumObj(st.weapons) * CONFIG.weaponKg;
    for (const [k, n] of Object.entries(st.goods || {})) kg += n * (CONFIG.goods[k] ? CONFIG.goods[k].kg : 0);
    return kg;
  }

  // ------------------------------------------------------------- об’єкти
  function facilities(state) { if (!state.facilities) state.facilities = []; return state.facilities; }
  function facilityAt(state, idx) { return facilities(state).filter(f => f.idx === idx && !f.destroyed); }
  function byId(state, id) { return facilities(state).find(f => f.id === id) || null; }
  function isStore(f) { return f.type === 'depot' || f.type === 'fieldDepot'; }

  function makeFacility(state, type, idx, owner, name) {
    const def = FT()[type];
    if (!state.nextFacilityId) state.nextFacilityId = 1;
    const f = {
      id: state.nextFacilityId++, type, idx, owner, name: name || def.name, condition: 100, offline: 0,
      stock: emptyStock(), patients: 0, acc: { die: 0, rec: 0 }, knownBy: [owner], seen: [null, null, null], destroyed: false
    };
    facilities(state).push(f);
    return f;
  }

  // Розміщення об’єктів тестового сценарію (детерміновано за картою)
  function placeScenario(state) {
    const m = state.map, grid = g(state);
    const S = m.settlements;
    const city = S[0];
    const cityHexes = [], indHexes = [];
    for (let i = 0; i < m.terrain.length; i++) {
      if (m.settlement[i] !== 0 || m.river[i]) continue;
      if (m.terrain[i] === TERRAIN_ID.city) cityHexes.push(i);
      if (m.terrain[i] === TERRAIN_ID.industrial) indHexes.push(i);
    }
    const byDist = (list, c) => list.slice().sort((a, b) => grid.dist(a, c) - grid.dist(b, c) || a - b);
    const ch = byDist(cityHexes, city.center), ih = byDist(indHexes, city.center);
    const owner = i => m.control[i];
    const used = new Set();
    const fallback = byDist(grid.within(city.center, 4).filter(i => passableFoot(state, i)), city.center);
    const pick = (list, k = 0) => {
      for (const i of list.slice(k).concat(fallback)) if (!used.has(i)) { used.add(i); return i; }
      return city.center;
    };
    const soc = city.control >= 0 ? city.control : 0;
    makeFacility(state, 'depot', pick(ch, 1), soc, 'Центральний склад');
    makeFacility(state, 'hospital', pick(ch, 3), soc, 'Міська лікарня');
    // Запит гравця: «заводи слід зробити не в одному місті, а розкидати — інфраструктура не
    // може бути тільки в одній зоні». Промислові об’єкти соц. влади тепер шукають місце не
    // лише біля міста, а по черзі («round-robin») між УСІМА населеними пунктами, якими соц.
    // влада реально керує (напр. і місто, і залежне село) — кожен наступний об’єкт воліє
    // потрапити в ІНШИЙ пункт, ніж попередній. Промзона (TERRAIN_ID.industrial) — у пріоритеті,
    // де є; картогенерація (03_mapgen.js) кладе її лише в місто, тож для залежних сіл без
    // власної промзони беремо будь-який прохідний гекс біля центру того села (запасний варіант
    // «pick(ih)» нижче лишається лише якщо соц. влада керує рівно одним пунктом узагалі).
    const indBySettlement = {};
    for (let i = 0; i < S.length; i++) if (S[i].control === soc) {
      let list = [];
      for (let j = 0; j < m.terrain.length; j++) {
        if (m.river[j] || m.settlement[j] !== i) continue;
        if (m.terrain[j] === TERRAIN_ID.industrial) list.push(j);
      }
      if (!list.length) list = grid.within(S[i].center, 3).filter(j => m.settlement[j] === i && passableFoot(state, j) && m.terrain[j] !== TERRAIN_ID.city);
      if (list.length) indBySettlement[i] = list;
    }
    const spreadSids = Object.keys(indBySettlement).map(Number).sort((a, b) => grid.dist(S[a].center, city.center) - grid.dist(S[b].center, city.center));
    for (const sid of spreadSids) indBySettlement[sid] = byDist(indBySettlement[sid], city.center);
    let rr = 0;
    const pickSpread = () => {
      for (let tries = 0; tries < spreadSids.length; tries++) {
        const sid = spreadSids[(rr + tries) % spreadSids.length];
        const list = indBySettlement[sid];
        while (list.length && used.has(list[0])) list.shift();
        if (list.length) { const i = list.shift(); used.add(i); rr = (rr + tries + 1) % spreadSids.length; return i; }
      }
      return pick(ih);
    };
    makeFacility(state, 'ammo_plant', pickSpread(), owner(ih[0]) >= 0 ? soc : soc);
    makeFacility(state, 'arms_plant', pickSpread());
    makeFacility(state, 'repair_base', pickSpread());
    makeFacility(state, 'refinery', pickSpread());
    for (const f of facilities(state)) if (f.owner == null) f.owner = soc;
    // нафтове родовище — термінал на узбережжі, найближчий до міста
    const coast = [];
    for (let i = 0; i < m.terrain.length; i++) if (m.terrain[i] === TERRAIN_ID.coast && !m.river[i] && m.settlement[i] < 0) coast.push(i);
    const of = byDist(coast, city.center).find(i => grid.dist(i, city.center) >= 5) || coast[0];
    if (of != null) { used.add(of); makeFacility(state, 'oil_field', of, m.control[of] >= 0 ? m.control[of] : soc, 'Нафтовий термінал'); }
    // повстанці: склад і польовий шпиталь у своїх селах
    [[1, S[1]], [2, S[2]]].forEach(([fac, st]) => {
      const around = grid.within(st.center, 2).filter(i => m.terrain[i] !== TERRAIN_ID.sea && !m.river[i] && !used.has(i)).sort((x, y) => grid.dist(x, st.center) - grid.dist(y, st.center) || x - y);
      const a = around[0], b = around[1] != null ? around[1] : around[0];
      used.add(a); used.add(b);
      makeFacility(state, 'depot', a, fac, `Склад (${st.name})`);
      makeFacility(state, 'hospital', b, fac, `Польовий шпиталь (${st.name})`);
    });
    // стартові запаси (ЗАГЛУШКИ сценарію)
    const fill = (f, st) => { addObj(f.stock.ammo, st.ammo); addObj(f.stock.weapons, st.weapons); addObj(f.stock.goods, st.goods); };
    for (const f of facilities(state)) {
      if (f.type === 'depot' && f.owner === 0) fill(f, { ammo: { '545': 20000, '762s': 8000, '762r': 10000, 'pg7': 60, 'atd': 30, 'm81': 200, '918': 1000, 'g30': 600, '127': 2000 }, weapons: { 'АК-74': 20, 'АКС-74У': 10, 'РПК': 4, 'ПКМ': 2, 'АГС-17': 1, 'НСВ «Утьос»': 2 }, goods: { fuel: 5000, med: 120, parts: 40, eng: 60 } });
      else if (f.type === 'depot') fill(f, { ammo: { '545': 3000, '762s': 12000, '762r': 4000, 'pg7': 30, 'atd': 20, 'm81': f.owner === 2 ? 120 : 0, '918': 300, 'g30': f.owner === 2 ? 300 : 0, '127': f.owner === 1 ? 800 : 300 }, weapons: { 'АКМ': 15 }, goods: { fuel: 1500, med: 40, parts: 10, eng: 20 } });
      else if (f.type === 'hospital') fill(f, { goods: { med: f.owner === 0 ? 60 : 20 } });
      else if (f.type === 'refinery') fill(f, { goods: { crude: 2000 } });
    }
    // Запит гравця: «на території де немає соціалістів(а де повстанці) поставити пусті
    // заводи/склади не захоплені — щоб підняти шанси повстанців боротись, крім цього
    // інфраструктура не може бути тільки в одній зоні». Додано ПІСЛЯ fill() вище — тому
    // лишаються порожніми (f.owner===-1 — нейтральні, у fill-циклі вище не враховані взагалі).
    // НЕ переходять автоматично власнику гекса (endOfHour нижче пропускає f.owner===-1) —
    // лише ручна дія Logistics.claimFacility у гексі справді «захоплює» (заявляє на) об’єкт.
    S.forEach((st, sid) => {
      // Примітка: тут (placeScenario) це викликається ДО Politics.init — st.pop ще не існує,
      // тож перевіряємо control/kind, не населення.
      if (st.control < 0 || st.control === soc) return;
      const near = grid.within(st.center, 2).filter(i => m.terrain[i] !== TERRAIN_ID.sea && !m.river[i] && !used.has(i)).sort((x, y) => grid.dist(x, st.center) - grid.dist(y, st.center) || x - y);
      if (!near.length) return;
      used.add(near[0]);
      makeFacility(state, sid % 2 ? 'repair_base' : 'depot', near[0], -1, `Покинутий об’єкт (${st.name})`);
    });
  }

  function ensureEconomy(state) {
    if (!state.economy) state.economy = [0, 1, 2].map(f => ({ money: EC().startMoney[f], manpower: EC().startManpower[f], manAcc: 0, deadOfWounds: 0, recovered: 0, last: null }));
    return state.economy;
  }

  // ---------------------------------------------------- тилова мережа
  function passableFoot(state, i) {
    if (state.map.terrain[i] === TERRAIN_ID.sea) return false;
    if (state.map.river[i] && !state.map.bridge[i]) return false;
    return true;
  }
  // Компоненти своєї території без противника; відстані від складів мережі
  function network(state, f) {
    const grid = g(state), N = grid.size, m = state.map;
    const enemy = new Uint8Array(N);
    for (const u of state.units) if (u.faction !== f && u.personnel.fit > 0) enemy[u.idx] = 1;
    const comp = new Int32Array(N).fill(-1);
    let nc = 0;
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0 || m.control[s] !== f || enemy[s] || !passableFoot(state, s)) continue;
      const q = [s]; comp[s] = nc;
      while (q.length) {
        const c = q.pop();
        for (let d = 0; d < 6; d++) {
          const n = grid.neighbor(c, d);
          if (n < 0 || comp[n] >= 0 || m.control[n] !== f || enemy[n] || !passableFoot(state, n)) continue;
          comp[n] = nc; q.push(n);
        }
      }
      nc++;
    }
    const own = facilities(state).filter(x => x.owner === f && !x.destroyed && comp[x.idx] >= 0);
    const stores = own.filter(isStore);
    const storeComps = new Set(stores.map(x => comp[x.idx]));
    // «Відстань» рахується вартістю, не гексами: дорога дешева, бездоріжжя й важка місцевість — дорогі.
    // Дорогами постачання сягає далеко, полем і лісом — набагато ближче.
    const dist = new Float32Array(N).fill(-1);
    const budget = LG().supplyBudget;
    const heap = new MinHeap();
    for (const st of stores) { if (dist[st.idx] < 0) { dist[st.idx] = 0; heap.push(0, st.idx); } }
    const closed = new Uint8Array(N);
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(c, d);
        if (n < 0 || closed[n] || enemy[n] || !passableFoot(state, n)) continue;
        if (m.control[n] >= 0 && m.control[n] !== f) continue;
        const nd = dist[c] + hexSupplyCost(state, n);
        if (nd > budget + 1e-9) continue;
        if (dist[n] < 0 || nd < dist[n] - 1e-9) { dist[n] = nd; heap.push(nd, n); }
      }
    }
    return { comp, own, stores, storeComps, dist };
  }
  function hexSupplyCost(state, i) {
    const SC = LG().supplyCost;
    if (state.map.road[i] >= 1) return SC.road;
    const k = Engine.terrainKey(state, i);
    return SC[k] != null ? SC[k] : SC.offroad;
  }

  function nearestStore(state, net, idx) {
    const grid = g(state);
    let best = null, bd = Infinity;
    for (const st of net.stores) { const d = grid.dist(st.idx, idx); if (d < bd) { bd = d; best = st; } }
    return best;
  }

  // ------------------------------------------- потреби підрозділу
  function basicLoad(u) {
    const need = {};
    for (const [m, n] of Object.entries(u.weapons)) { const w = CONFIG.weapons[m]; if (w && !w.disposable) need[w.ammo] = (need[w.ammo] || 0) + w.basicLoad * n; }
    return need;
  }
  function supplyLevel(u) {
    const need = basicLoad(u);
    let worst = 1;
    for (const [c, n] of Object.entries(need)) if (n > 0) worst = Math.min(worst, (u.ammo[c] || 0) / n);
    return worst;
  }
  function supplyText(state, u, inNet) {
    const lvl = supplyLevel(u);
    const pct = Math.round(lvl * 100);
    const ammo = lvl >= 0.9 ? 'повний боєкомплект' : lvl >= 0.5 ? `боєкомплект ${pct}%` : lvl > 0 ? `мало набоїв (${pct}%)` : 'немає набоїв';
    return `${inNet ? 'у зоні постачання' : 'поза зоною постачання'}, ${ammo}`;
  }

  // Видати підрозділу запаси зі сховища (склад або вантаж). share — частка боєкомплекту за раз.
  function resupplyFrom(state, u, stock, share, opts = {}) {
    const need = basicLoad(u);
    const got = { ammo: {}, fuel: 0, men: 0, weapons: {} };
    for (const [c, full] of Object.entries(need)) {
      const want = Math.max(0, Math.min(full - (u.ammo[c] || 0), Math.ceil(full * share)));
      const t = Math.min(want, stock.ammo[c] || 0);
      if (t > 0) { stock.ammo[c] -= t; u.ammo[c] = (u.ammo[c] || 0) + t; got.ammo[c] = t; }
    }
    // одноразові ПТГ: поповнення до квоти підрозділу
    if (u.atdQuota) {
      const have = u.weapons['Одноразовий ПТГ'] || 0;
      const t = Math.min(Math.max(0, u.atdQuota - have), stock.ammo.atd || 0);
      if (t > 0) { stock.ammo.atd -= t; u.weapons['Одноразовий ПТГ'] = have + t; u.ammo.atd = (u.ammo.atd || 0) + t; got.ammo.atd = t; }
    }
    if (u.vehicle) {
      const want = r1(u.vehicle.fuelMax - u.vehicle.fuel);
      const t = r1(Math.min(want, stock.goods.fuel || 0));
      if (t > 0) { stock.goods.fuel = r1(stock.goods.fuel - t); u.vehicle.fuel = r1(u.vehicle.fuel + t); got.fuel = t; }
    }
    // поповнення людьми: резерв фракції + особиста зброя зі сховища
    if (opts.replacements && !u.vehicle && u.embarked == null) {
      const eco = ensureEconomy(state)[u.faction];
      const p = u.personnel;
      const present = p.fit + p.wounded + p.straggling;     // поранені в строю теж займають місце
      let n = Math.min(opts.replacements, Math.max(0, p.assigned - present), Math.floor(eco.manpower), Math.floor(Math.max(0, eco.money) / EC().recruitCost));
      if (n > 0) {
        // зброя для новобранців
        let deficit = Math.max(0, p.fit + n - Loot.holders(u));
        const pref = Object.keys(u.weapons).filter(Loot.isHolder);
        const order = Object.keys(stock.weapons).filter(Loot.isHolder).sort((a, b) => (pref.includes(b) - pref.includes(a)) || (a < b ? -1 : 1));
        for (const m of order) { if (deficit <= 0) break; const t = Math.min(deficit, stock.weapons[m] || 0); if (t > 0) { stock.weapons[m] -= t; u.weapons[m] = (u.weapons[m] || 0) + t; got.weapons[m] = t; deficit -= t; } }
        n -= deficit;   // без зброї новобранців не приймають
        if (n > 0) {
          eco.manpower -= n; eco.money -= n * EC().recruitCost;
          // досвід розбавляється новобранцями
          const before = p.fit;
          p.fit += n; got.men = n;
          const t = CONFIG.combat.xpForLevel;
          u.xp = Math.floor(u.xp * before / Math.max(1, p.fit));
          let lvl = 0; while (lvl + 1 < t.length && u.xp >= t[lvl + 1]) lvl++;
          u.experience = Math.min(u.experience, lvl);
        }
      }
    }
    return got;
  }
  function gotText(got) {
    const parts = [];
    const a = Object.entries(got.ammo).map(([c, n]) => `${CONFIG.ammo[c].name} ${n}`);
    if (a.length) parts.push('набої: ' + a.join(', '));
    if (got.fuel) parts.push(`пальне ${Engine.fmt(got.fuel)} л`);
    if (got.men) parts.push(`поповнення ${got.men} ос.`);
    const w = Object.entries(got.weapons).map(([m, n]) => `${m} ×${n}`);
    if (w.length) parts.push('зброя: ' + w.join(', '));
    return parts.join('; ');
  }

  // ---------------------------------------------------- ручні дії
  function costCheck(state, u, what) {
    const cost = Engine.mpMax(u) * LG().actionShare;
    if (u.mp < cost - 1e-9) return `${what} займає ${LG().actionShare * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
    if (u.attackedTurn === state.time.turn) return 'Підрозділ уже вів бій цієї години.';
    return null;
  }
  function spend(u) { u.mp = Math.max(0, u.mp - Engine.mpMax(u) * LG().actionShare); u.movedThisPhase = true; }

  function storesNear(state, u) {
    const grid = g(state);
    return facilities(state).filter(f => isStore(f) && (f.owner === u.faction || Politics.sharesSupply(state, f.owner, u.faction)) && !f.destroyed && grid.dist(f.idx, u.idx) <= 1);
  }

  function resupplyReason(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    if (u.embarked != null) return 'Спершу висадіть підрозділ.';
    if (!storesNear(state, u).length) return 'Поруч немає свого складу (потрібно бути в гексі складу або поруч).';
    return costCheck(state, u, 'Поповнення');
  }
  function resupply(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u) || resupplyReason(state, u);
    if (err) return { ok: false, reason: err };
    const st = storesNear(state, u)[0];
    const got = resupplyFrom(state, u, st.stock, 1, { replacements: 0 });
    spend(u);
    const t = gotText(got) || 'нічого не знадобилося або на складі порожньо';
    Engine.log(state, `${u.name}: поповнення на «${st.name}» — ${t}.`, 'order', u.faction);
    return { ok: true, text: t };
  }

  // Вантаж техніки або піших носіїв (кг). Техніка — за кузовом; інженери/логістична група —
  // за footCargoKg (несуть на собі); решта піших підрозділів вантажу не носить (0).
  function cargoKg(u) { const c = Loot.ensureCargo(u); return stockKg({ ammo: c.ammo, weapons: c.weapons, goods: c.goods || {} }); }
  function cargoCapKg(u) { return LG().vehicleCargoKg[u.type] || (LG().footCargoKg && LG().footCargoKg[u.type]) || 0; }

  // Звідки можна вантажити: будь-який свій об’єкт у гексі (склад, завод, родовище, НПЗ, шпиталь)
  function sourcesAt(state, u) {
    return facilities(state).filter(f => f.idx === u.idx && !f.destroyed && (f.owner === u.faction || (isStore(f) && Politics.sharesSupply(state, f.owner, u.faction))) && stockKg(f.stock) > 0);
  }
  function loadReason(state, u) {
    if (!u || cargoCapKg(u) <= 0) return 'Цей підрозділ не може нести вантаж (лише техніка, інженери чи логістична група).';
    if (u.embarked != null) return 'Спершу висадіть підрозділ.';
    if (!sourcesAt(state, u).length) return 'Підрозділ має стояти в гексі свого об’єкта із запасами (склад, завод, родовище, НПЗ).';
    return costCheck(state, u, 'Завантаження');
  }
  // preset: ammo | fuel | med | mix
  function loadFromStore(state, unitId, preset) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u) || loadReason(state, u);
    if (err) return { ok: false, reason: err };
    const st = sourcesAt(state, u).find(f => preset === 'crude' ? (f.stock.goods.crude || 0) > 0 : true) || sourcesAt(state, u)[0];
    const c = Loot.ensureCargo(u); if (!c.goods) c.goods = {};
    let room = cargoCapKg(u) - cargoKg(u);
    const moved = { ammo: {}, goods: {} };
    const take = (kind, key, kgEach, limitKg) => {
      let have = st.stock[kind][key] || 0;
      if (preset === 'mix') have = Math.floor(have * LG().mixShare);
      if (have <= 0 || room <= 0) return;
      const n = Math.min(have, Math.floor(Math.min(room, limitKg) / kgEach));
      if (n <= 0) return;
      st.stock[kind][key] -= n; room -= n * kgEach;
      const dst = kind === 'ammo' ? c.ammo : c.goods;
      dst[key] = (dst[key] || 0) + n; moved[kind][key] = (moved[kind][key] || 0) + n;
    };
    const ammoKeys = Object.keys(st.stock.ammo).filter(k => st.stock.ammo[k] > 0);
    if (preset === 'ammo' || preset === 'mix') {
      const share = preset === 'mix' ? 0.6 : 1;
      const per = room * share / Math.max(1, ammoKeys.length);
      for (const k of ammoKeys) take('ammo', k, CONFIG.ammo[k].kg, per);
    }
    if (preset === 'fuel' || preset === 'mix') take('goods', 'fuel', CONFIG.goods.fuel.kg, preset === 'mix' ? room * 0.7 : room);
    if (preset === 'med' || preset === 'mix') take('goods', 'med', CONFIG.goods.med.kg, room);
    if (preset === 'crude') take('goods', 'crude', CONFIG.goods.crude.kg, room);
    if (preset === 'eng' || preset === 'mix') take('goods', 'eng', CONFIG.goods.eng.kg, preset === 'mix' ? room * 0.3 : room);
    if (preset === 'parts') take('goods', 'parts', CONFIG.goods.parts.kg, room);
    if (preset === 'all') {
      for (const k of Object.keys(st.stock.ammo)) take('ammo', k, CONFIG.ammo[k].kg, room);
      for (const k of Object.keys(st.stock.goods)) take('goods', k, CONFIG.goods[k].kg, room);
      for (const m of Object.keys(st.stock.weapons)) {
        const n = Math.min(st.stock.weapons[m] || 0, Math.floor(room / CONFIG.weaponKg));
        if (n > 0) { st.stock.weapons[m] -= n; room -= n * CONFIG.weaponKg; c.weapons[m] = (c.weapons[m] || 0) + n; moved.weapons = moved.weapons || {}; moved.weapons[m] = (moved.weapons[m] || 0) + n; }
      }
    }
    if (!sumObj(moved.ammo) && !sumObj(moved.goods) && !sumObj(moved.weapons)) return { ok: false, reason: 'На об’єкті немає потрібних запасів або машина повна.' };
    spend(u);
    const t = describeStock(moved);
    Engine.log(state, `${u.name}: завантажено на «${st.name}» — ${t}. Вантаж ${Math.round(cargoKg(u))}/${cargoCapKg(u)} кг.`, 'order', u.faction);
    return { ok: true, text: t };
  }

  // Запит гравця: «на складах можливість вибирати ЩО грузити і СКІЛЬКИ» — preset 'all' вище
  // розподіляє вантажний об’єм «жадібно» в порядку ключів об’єкта (саме тому, наприклад,
  // протитанкові міни, доданi пізніше за інші запаси, можуть не влізти, якщо решта вже забрала
  // весь об’єм). Ці дві функції — точковий вибір однієї позиції й кількості, незалежно від presets.
  function loadableItems(state, u) {
    const out = [];
    for (const st of sourcesAt(state, u)) {
      for (const [k, n] of Object.entries(st.stock.ammo || {})) if (n > 0) out.push({ kind: 'ammo', key: k, name: CONFIG.ammo[k].name, unit: 'шт.', have: n, kgEach: CONFIG.ammo[k].kg, storeId: st.id, storeName: st.name });
      for (const [k, n] of Object.entries(st.stock.goods || {})) if (n > 0) out.push({ kind: 'goods', key: k, name: CONFIG.goods[k].name, unit: CONFIG.goods[k].unit, have: n, kgEach: CONFIG.goods[k].kg, storeId: st.id, storeName: st.name });
      for (const [m, n] of Object.entries(st.stock.weapons || {})) if (n > 0) out.push({ kind: 'weapons', key: m, name: m, unit: 'шт.', have: n, kgEach: CONFIG.weaponKg, storeId: st.id, storeName: st.name });
    }
    return out;
  }
  function loadItem(state, unitId, storeId, kind, key, qty) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u) || loadReason(state, u);
    if (err) return { ok: false, reason: err };
    if (!['ammo', 'goods', 'weapons'].includes(kind)) return { ok: false, reason: 'Невідома категорія.' };
    const st = sourcesAt(state, u).find(f => f.id === storeId);
    if (!st) return { ok: false, reason: 'Об’єкт не знайдено поруч.' };
    const have = (st.stock[kind] && st.stock[kind][key]) || 0;
    if (have <= 0) return { ok: false, reason: 'На об’єкті цього немає.' };
    const kgEach = kind === 'weapons' ? CONFIG.weaponKg : kind === 'ammo' ? CONFIG.ammo[key].kg : CONFIG.goods[key].kg;
    const c = Loot.ensureCargo(u); if (!c.goods) c.goods = {};
    const room = cargoCapKg(u) - cargoKg(u);
    const n = Math.max(0, Math.min(Math.floor(qty) || 0, have, Math.floor(room / kgEach)));
    if (n <= 0) return { ok: false, reason: room < kgEach ? 'Немає вільного місця у вантажі.' : 'Вкажіть кількість більшу за нуль.' };
    st.stock[kind][key] -= n;
    const dst = kind === 'ammo' ? c.ammo : kind === 'goods' ? c.goods : c.weapons;
    dst[key] = (dst[key] || 0) + n;
    spend(u);
    const name = kind === 'weapons' ? key : kind === 'ammo' ? CONFIG.ammo[key].name : CONFIG.goods[key].name;
    Engine.log(state, `${u.name}: завантажено з «${st.name}» — ${name} ×${n}. Вантаж ${Math.round(cargoKg(u))}/${cargoCapKg(u)} кг.`, 'order', u.faction);
    return { ok: true, n };
  }

  function describeStock(st) {
    const parts = [];
    for (const [c, n] of Object.entries(st.ammo || {})) if (n > 0) parts.push(`${CONFIG.ammo[c].name} ${n}`);
    for (const [m, n] of Object.entries(st.weapons || {})) if (n > 0) parts.push(`${m} ×${n}`);
    for (const [k, n] of Object.entries(st.goods || {})) if (n > 0) parts.push(`${CONFIG.goods[k].name} ${Engine.fmt(r1(n))} ${CONFIG.goods[k].unit}`);
    return parts.join(', ') || 'нічого';
  }

  // Видати з вантажу машини підрозділам у тому ж гексі
  function issueReason(state, v) {
    if (!v || cargoCapKg(v) <= 0) return 'Видавати запаси може лише підрозділ, здатний нести вантаж (техніка, інженери чи логістична група).';
    const c = Loot.ensureCargo(v);
    if (!sumObj(c.ammo) && !(c.goods && sumObj(c.goods))) return 'Вантаж порожній.';
    if (!state.units.some(u => u !== v && u.faction === v.faction && u.idx === v.idx && u.embarked == null)) return 'У гексі немає своїх підрозділів.';
    return costCheck(state, v, 'Видача запасів');
  }
  function issueFromCargo(state, vehicleId) {
    const v = Engine.unitById(state, vehicleId);
    const err = Engine.checkCommandable(state, v) || issueReason(state, v);
    if (err) return { ok: false, reason: err };
    const c = Loot.ensureCargo(v); if (!c.goods) c.goods = {};
    const stock = { ammo: c.ammo, weapons: {}, goods: c.goods };
    const lines = [];
    for (const u of state.units.filter(x => x.faction === v.faction && x.idx === v.idx && x !== v)) {
      const got = resupplyFrom(state, u, stock, 1, {});
      const t = gotText(got);
      if (t) lines.push(`${u.name}: ${t}`);
    }
    // і собі пальне
    const own = resupplyFrom(state, v, stock, 1, {});
    if (gotText(own)) lines.push(`${v.name}: ${gotText(own)}`);
    spend(v);
    Engine.log(state, `${v.name}: видано запаси з вантажу — ${lines.join('; ') || 'нікому нічого не знадобилося'}.`, 'order', v.faction);
    return { ok: true, text: lines.join('; ') };
  }

  // Розвантажити вантаж на склад у гексі (або створити польовий склад)
  function unloadReason(state, v) {
    if (!v || cargoCapKg(v) <= 0) return 'Розвантажувати може лише підрозділ, здатний нести вантаж (техніка, інженери чи логістична група).';
    const c = Loot.ensureCargo(v);
    if (!sumObj(c.ammo) && !sumObj(c.weapons) && !(c.goods && sumObj(c.goods))) return 'Вантаж порожній.';
    return costCheck(state, v, 'Розвантаження');
  }
  function unloadToStore(state, vehicleId) {
    const v = Engine.unitById(state, vehicleId);
    const err = Engine.checkCommandable(state, v) || unloadReason(state, v);
    if (err) return { ok: false, reason: err };
    let st = facilityAt(state, v.idx).find(f => f.owner === v.faction && (isStore(f) || f.type === 'hospital' || f.type === 'refinery'));
    let created = false;
    if (!st) { st = makeFacility(state, 'fieldDepot', v.idx, v.faction, `Польовий склад ${g(state).label(v.idx)}`); created = true; }
    const c = Loot.ensureCargo(v);
    const moved = { ammo: Object.assign({}, c.ammo), weapons: Object.assign({}, c.weapons), goods: Object.assign({}, c.goods || {}) };
    if (st.type === 'hospital') { addObj(st.stock.goods, { med: (c.goods || {}).med || 0 }); if (c.goods) c.goods.med = 0; }
    else if (st.type === 'refinery') { addObj(st.stock.goods, { crude: (c.goods || {}).crude || 0 }); if (c.goods) c.goods.crude = 0; }
    else { addObj(st.stock.ammo, c.ammo); addObj(st.stock.weapons, c.weapons); addObj(st.stock.goods, c.goods); v.cargo = { weapons: {}, ammo: {}, goods: {} }; }
    spend(v);
    Engine.log(state, `${v.name}: розвантажено на «${st.name}»${created ? ' (створено польовий склад)' : ''} — ${describeStock(moved)}.`, 'order', v.faction);
    return { ok: true, created };
  }

  // Знищити власний склад, щоб не дістався противнику
  function destroyReason(state, u, f) {
    if (!u || !f) return 'Немає об’єкта.';
    if (f.owner !== u.faction) return 'Можна знищити лише власний об’єкт.';
    if (f.idx !== u.idx) return 'Підрозділ має бути в гексі об’єкта.';
    return costCheck(state, u, 'Знищення');
  }
  function destroyFacility(state, unitId, facilityId) {
    const u = Engine.unitById(state, unitId), f = byId(state, facilityId);
    const err = Engine.checkCommandable(state, u) || destroyReason(state, u, f);
    if (err) return { ok: false, reason: err };
    f.stock = emptyStock();
    if (isStore(f)) f.destroyed = true; else { f.condition = 0; f.offline = 999; }
    spend(u);
    Engine.log(state, `${u.name}: «${f.name}» знищено разом із запасами, щоб не дістався противнику.`, 'warn', u.faction, null);
    return { ok: true };
  }

  // Заявити (захопити) нейтральний об’єкт — «пусті заводи/склади не захоплені» в
  // повстанській території (placeScenario вище, owner===-1): на відміну від звичайного
  // захоплення об’єкта (endOfHour, за контролем гекса), нейтральний об’єкт НІКОЛИ не
  // переходить автоматично — потрібна ручна дія підрозділу в гексі, інакше лишається нічийним.
  function claimReason(state, u, f) {
    if (!u || !f) return 'Немає об’єкта.';
    if (f.owner !== -1) return 'Об’єкт уже має власника.';
    if (f.idx !== u.idx) return 'Підрозділ має бути в гексі об’єкта.';
    return costCheck(state, u, 'Заявка на об’єкт');
  }
  function claimFacility(state, unitId, facilityId) {
    const u = Engine.unitById(state, unitId), f = byId(state, facilityId);
    const err = Engine.checkCommandable(state, u) || claimReason(state, u, f);
    if (err) return { ok: false, reason: err };
    f.owner = u.faction;
    if (!f.knownBy.includes(u.faction)) f.knownBy.push(u.faction);
    spend(u);
    Engine.log(state, `${u.name}: заявлено права на нічийний об’єкт «${f.name}».`, 'event', u.faction, null);
    return { ok: true };
  }

  // ---------------------------------------------------- медицина
  function medevacsNear(state, u) {
    const grid = g(state);
    return state.units.filter(x => x.type === 'medevac' && x.faction === u.faction && x.personnel.fit > 0 && grid.dist(x.idx, u.idx) <= 1);
  }
  function pickupReason(state, mv) {
    if (!mv || mv.type !== 'medevac') return 'Лише евакуаційна медична група.';
    const room = MD().medevacCapacity - (mv.carriedWounded || 0);
    if (room <= 0) return `Група вже несе ${mv.carriedWounded} поранених (максимум ${MD().medevacCapacity}).`;
    if (!state.units.some(u => u !== mv && u.faction === mv.faction && u.idx === mv.idx && u.personnel.wounded > 0)) return 'У гексі немає своїх поранених.';
    return costCheck(state, mv, 'Евакуація');
  }
  function pickupWounded(state, mvId) {
    const mv = Engine.unitById(state, mvId);
    const err = Engine.checkCommandable(state, mv) || pickupReason(state, mv);
    if (err) return { ok: false, reason: err };
    let room = MD().medevacCapacity - (mv.carriedWounded || 0);
    const parts = [];
    for (const u of state.units.filter(x => x !== mv && x.faction === mv.faction && x.idx === mv.idx && x.personnel.wounded > 0)) {
      const n = Math.min(room, u.personnel.wounded);
      if (n <= 0) break;
      u.personnel.wounded -= n; u.personnel.evacuated = (u.personnel.evacuated || 0) + n;
      mv.carriedWounded = (mv.carriedWounded || 0) + n; room -= n;
      parts.push(`${u.name} — ${n}`);
    }
    spend(mv);
    Engine.log(state, `${mv.name}: забрано поранених (${parts.join(', ')}). Несе ${mv.carriedWounded}/${MD().medevacCapacity}.`, 'order', mv.faction);
    return { ok: true };
  }

  function hospitalsOf(state, f) { return facilities(state).filter(x => x.type === 'hospital' && x.owner === f && !x.destroyed && x.condition > 0); }
  function hospitalRoom(h) { return Math.max(0, FT().hospital.beds - h.patients); }

  // ---------------------------------------------------- конвої (запит гравця: «вразливі конвої
  // постачання»). Тилова передача підприємство → склад мережі (endOfHour, розділ 4) тепер не
  // телепортується миттєво: вантаж їде конвоєм кілька годин (CONFIG.convoy.speedHexPerHour) і
  // щогодини транзиту є ризик засідки — чим ближче ворог опиняється до маршруту (джерело,
  // приблизна середина, ціль), тим вищий шанс (детермінований hash2, не Math.random()).
  // Засідка забирає частку вантажу (lossShare), решта доїжджає; доставка не скасовується.
  function convoys(state) { if (!state.convoys) state.convoys = []; return state.convoys; }
  function queueConvoy(state, faction, fromFac, toFac, cargo) {
    const grid = g(state);
    const dist = grid.dist(fromFac.idx, toFac.idx);
    const hours = Math.max(CV().minHours, Math.ceil(dist / CV().speedHexPerHour));
    convoys(state).push({
      id: (state.nextConvoyId = (state.nextConvoyId || 0) + 1), faction,
      fromIdx: fromFac.idx, toIdx: toFac.idx, toId: toFac.id, fromName: fromFac.name, toName: toFac.name,
      cargo, depart: state.time.turn, arrive: state.time.turn + hours
    });
  }
  function hourConvoys(state) {
    if (!state.convoys || !state.convoys.length) return;
    const grid = g(state), CVc = CV();
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    for (const cv of convoys(state).slice()) {
      if (state.time.turn + 1 < cv.arrive) {
        // ще в дорозі — ризик засідки цієї години залежно від найближчого ворога до маршруту
        const midIdx = grid.idx(Math.round((grid.col(cv.fromIdx) + grid.col(cv.toIdx)) / 2), Math.round((grid.row(cv.fromIdx) + grid.row(cv.toIdx)) / 2));
        const pts = midIdx >= 0 ? [cv.fromIdx, cv.toIdx, midIdx] : [cv.fromIdx, cv.toIdx];
        let bestD = Infinity;
        for (const u of state.units) {
          if (u.faction === cv.faction || u.personnel.fit <= 0) continue;
          for (const p of pts) { const d = grid.dist(u.idx, p); if (d < bestD) bestD = d; }
        }
        if (bestD <= CVc.dangerRadius) {
          const t = bestD / CVc.dangerRadius;
          const chance = CVc.ambushChanceAtZero + (CVc.ambushChanceAtEdge - CVc.ambushChanceAtZero) * t;
          const roll = hash2(seed ^ Math.imul(cv.id + 1, 2654435761), state.time.turn, 919) * 100;
          if (roll < chance) {
            const lost = emptyStock();
            for (const cat of ['ammo', 'weapons', 'goods']) for (const k of Object.keys(cv.cargo[cat] || {})) {
              const take = Math.floor(cv.cargo[cat][k] * CVc.lossShare);
              if (take > 0) { cv.cargo[cat][k] -= take; lost[cat][k] = take; }
            }
            Engine.log(state, `Конвой «${cv.fromName}» → «${cv.toName}» потрапив у засідку поблизу ворога — втрачено: ${describeStock(lost)}.`, 'warn', cv.faction);
          }
        }
        continue;
      }
      state.convoys = convoys(state).filter(x => x !== cv);
      const dst = byId(state, cv.toId);
      if (!dst || dst.destroyed || dst.owner !== cv.faction) {
        Engine.log(state, `Конвой «${cv.fromName}» → «${cv.toName}» не доїхав — пункт прибуття вже не ваш.`, 'warn', cv.faction);
        continue;
      }
      addObj(dst.stock.ammo, cv.cargo.ammo); addObj(dst.stock.weapons, cv.cargo.weapons); addObj(dst.stock.goods, cv.cargo.goods);
      const t = describeStock(cv.cargo);
      if (t !== 'нічого') Engine.log(state, `Конвой прибув на «${dst.name}»: ${t}.`, 'supply', cv.faction);
    }
  }

  // ---------------------------------------------------- кінець години
  function endOfHour(state) {
    ensureEconomy(state);
    const report = [[], [], []];
    // 1. Захоплення об’єктів (контроль гекса вже оновлено). Польовий склад НЕ в бліндажі
    // захоплюється відразу, як і раніше, але частину запасів розграбовано/знищено в process
    // (exposedLossShare). Склад У бліндажі тримається довше (captureHours) — противник мусить
    // утримувати гекс поспіль кілька годин, перш ніж склад фактично перейде до нього.
    for (const f of facilities(state)) {
      if (f.destroyed) continue;
      if (f.owner === -1) continue;   // нейтральний об’єкт — лише claimFacility, не автоперехід за контролем гекса
      const c = state.map.control[f.idx];
      if (c >= 0 && c !== f.owner) {
        const bunkered = isStore(f) && (state.map.shelter[f.idx] || 0) > 0;
        if (bunkered) {
          const need = EN().shelter.captureHours;
          if (!f.captureHold || f.captureHold.by !== c) f.captureHold = { by: c, hours: 0 };
          f.captureHold.hours++;
          if (f.captureHold.hours < need) {
            Engine.log(state, `«${f.name}» у бліндажі тримається попри ворожий контроль гекса — ще ${need - f.captureHold.hours} год до захоплення.`, 'warn', c, [c, f.owner]);
            continue;
          }
        }
        const was = f.owner;
        f.owner = c;
        f.captureHold = null;
        if (!isStore(f) && f.type !== 'hospital') { f.condition = Math.max(0, f.condition - EC().capturedDamage); f.offline = EC().capturedOfflineHours; }
        let lossNote = '';
        if (isStore(f) && !bunkered) {
          const share = EN().shelter.exposedLossShare;
          for (const cat of ['ammo', 'weapons', 'goods']) for (const k of Object.keys(f.stock[cat] || {})) f.stock[cat][k] = Math.floor(f.stock[cat][k] * (1 - share));
          lossNote = ` Склад не в бліндажі — ${Math.round(share * 100)}% запасів утрачено/розграбовано під час захоплення.`;
        }
        if (f.type === 'hospital' && f.patients > 0) {
          state.prisoners.push({ holder: c, origin: was, count: f.patients, unit: f.name, day: state.time.day, hour: state.time.hour });
          Engine.log(state, `«${f.name}»: ${f.patients} поранених потрапили в полон.`, 'warn', c, [c, was]);
          f.patients = 0;
        }
        if (!f.knownBy.includes(c)) f.knownBy.push(c);
        Engine.log(state, `«${f.name}» захоплено: ${Engine.fname(c)}. Запаси переходять переможцю${!isStore(f) && f.type !== 'hospital' ? `; стан ${f.condition}%, простій ${f.offline} год` : ''}.${lossNote}`, 'event', c, [c, was]);
      } else if (f.captureHold) {
        f.captureHold = null; // контроль гекса повернувся власнику — прогрес захоплення скинуто
      }
    }
    for (let fac = 0; fac < 3; fac++) {
      const eco = state.economy[fac];
      const net = network(state, fac);
      const inNet = x => net.comp[x.idx] >= 0 && net.storeComps.has(net.comp[x.idx]);
      const income = { settlements: 0 }, expense = { production: 0 };
      // 2. Доходи й мобілізаційний ресурс
      for (const s of state.map.settlements) if (s.control === fac) {
        income.settlements += Math.round((EC().income[s.kind] || 0) * Politics.incomeMult(state, s));
        eco.manAcc += (EC().manpowerPerHour[s.kind] || 0) * Politics.manpowerMult(state, s);
      }
      eco.money += income.settlements;
      const wholeMen = Math.floor(eco.manAcc); eco.manAcc -= wholeMen; eco.manpower += wholeMen;
      // 3. Виробництво
      const produced = [];
      for (const f of facilities(state).filter(x => x.owner === fac && !x.destroyed)) {
        const def = FT()[f.type];
        if (f.offline > 0) { f.offline--; continue; }
        if (!def.cost && f.type !== 'refinery') continue;
        if (state.map.control[f.idx] !== fac || f.condition <= 0) continue;
        const sid = state.map.settlement[f.idx];
        const town = sid >= 0 ? state.map.settlements[sid] : null;
        if (town && town.unrest === 'strike') { produced.push(`${f.name}: страйк — робота зупинена`); continue; }
        const k = f.condition / 100 * (town && town.damage ? 1 - town.damage.industry / 200 : 1);
        const cost = def.cost || 0;
        if (eco.money < cost) { produced.push(`${f.name}: простій — бракує коштів`); continue; }
        if (f.type === 'refinery') {
          const crude = Math.min(f.stock.goods.crude || 0, Math.floor(def.crudeIn * k));
          if (crude <= 0) { produced.push(`${f.name}: простій — немає сирої нафти`); continue; }
          f.stock.goods.crude -= crude;
          const fuel = Math.floor(crude * def.fuelOut / def.crudeIn);
          f.stock.goods.fuel = (f.stock.goods.fuel || 0) + fuel;
          eco.money -= cost; expense.production += cost;
          produced.push(`${f.name}: ${crude} л нафти → ${fuel} л пального`);
          continue;
        }
        // Запит гравця: майстерню можна «перелаштувати» на інший рецепт і покращити — вихід
        // береться з CONFIG.workshop.recipes[f.recipe] (обраний гравцем), а не з фіксованого
        // facilities.workshop.out; покращена (f.level) дає множник outputMult.
        const out = f.type === 'workshop' ? (CONFIG.workshop.recipes[f.recipe] || CONFIG.workshop.recipes[Object.keys(CONFIG.workshop.recipes)[0]]).out : def.out;
        const wk = f.type === 'workshop' && f.level ? k * CONFIG.workshop.upgrade.outputMult : k;
        if (out.ammo) addObj(f.stock.ammo, out.ammo, wk);
        if (out.weapons) addObj(f.stock.weapons, out.weapons, wk);
        if (out.goods) addObj(f.stock.goods, out.goods, wk);
        eco.money -= cost; expense.production += cost;
        produced.push(`${f.name}: ${describeStock({ ammo: out.ammo ? scale(out.ammo, wk) : {}, weapons: out.weapons ? scale(out.weapons, wk) : {}, goods: out.goods ? scale(out.goods, wk) : {} })}`);
      }
      // 4. Тилова мережа: підприємства → склади, нафта → НПЗ
      const refineries = net.own.filter(x => x.type === 'refinery');
      for (const f of net.own) {
        if (!inNet(f) || isStore(f) || f.type === 'hospital') continue;
        const dst = net.stores.find(st => net.comp[st.idx] === net.comp[f.idx]);
        if (f.type === 'oil_field') {
          const ref = refineries.find(r => net.comp[r.idx] === net.comp[f.idx]);
          if (ref && f.stock.goods.crude) { ref.stock.goods.crude = (ref.stock.goods.crude || 0) + f.stock.goods.crude; f.stock.goods.crude = 0; }
          continue;
        }
        if (!dst) continue;
        const keepCrude = f.type === 'refinery' ? (f.stock.goods.crude || 0) : 0;
        const goods = Object.assign({}, f.stock.goods); delete goods.crude;
        const cargo = { ammo: Object.assign({}, f.stock.ammo), weapons: Object.assign({}, f.stock.weapons), goods };
        f.stock = emptyStock(); if (keepCrude) f.stock.goods.crude = keepCrude;
        if (sumObj(cargo.ammo) + sumObj(cargo.weapons) + sumObj(cargo.goods) > 0) queueConvoy(state, fac, f, dst, cargo);
      }
      // медзапаси в шпиталі мережі
      for (const h of net.own.filter(x => x.type === 'hospital' && inNet(x))) {
        const need = Math.ceil(Math.max(0, h.patients * MD().medPerPatientHour * 6 - (h.stock.goods.med || 0)));
        const st = net.stores.find(s => net.comp[s.idx] === net.comp[h.idx] && (s.stock.goods.med || 0) > 0);
        if (st && need > 0) { const t = Math.min(need, st.stock.goods.med); st.stock.goods.med -= t; h.stock.goods.med = (h.stock.goods.med || 0) + t; }
      }
      // 5. Автопостачання підрозділів
      const supplied = [];
      for (const u of state.units.filter(x => x.faction === fac)) {
        const d = u.embarked != null ? -1 : net.dist[u.idx];
        u.inSupply = d >= 0;
        if (!u.inSupply) continue;
        const st = nearestStore(state, net, u.idx);
        if (!st) continue;
        const got = resupplyFrom(state, u, st.stock, LG().resupplyShare, { replacements: u.combatTurn === state.time.turn ? 0 : LG().replacementsPerHour });
        const t = gotText(got);
        if (t) supplied.push(`${u.name}: ${t}`);
        // поранені — у шпиталь мережі
        const hs = hospitalsOf(state, fac).filter(h => net.comp[h.idx] >= 0 && net.comp[h.idx] === net.comp[st.idx]);
        for (const who of [u]) {
          const carried = who.type === 'medevac' ? (who.carriedWounded || 0) : 0;
          let wnd = who.personnel.wounded + carried;
          for (const h of hs) {
            if (wnd <= 0) break;
            const n = Math.min(wnd, hospitalRoom(h));
            if (n <= 0) continue;
            let fromCarried = Math.min(n, carried), fromUnit = n - fromCarried;
            if (who.type === 'medevac') who.carriedWounded -= fromCarried;
            who.personnel.wounded -= fromUnit; who.personnel.evacuated = (who.personnel.evacuated || 0) + fromUnit;
            h.patients += n; wnd -= n;
            supplied.push(`${who.name}: ${n} поранених відправлено в «${h.name}»`);
          }
        }
      }
      if (supplied.length) Engine.log(state, `Тилове постачання: ${supplied.join('; ')}.`, 'supply', fac);
      if (produced.length) Engine.log(state, `Виробництво: ${produced.join('; ')}.`, 'supply', fac);
      eco.last = { income: income.settlements, expense: expense.production };
    }
    hourConvoys(state);
    // 6. Медицина: поранені без допомоги, у евакгрупах, у шпиталях
    for (const u of state.units) {
      const p = u.personnel;
      const stab = medevacsNear(state, u).length > 0 || u.type === 'medevac';
      const rate = stab ? MD().stabilizedDeathPerHour : MD().untreatedDeathPerHour;
      const pool = p.wounded + (u.type === 'medevac' ? (u.carriedWounded || 0) : 0);
      if (pool <= 0) continue;
      u.acc.wdie = (u.acc.wdie || 0) + pool * rate;
      let n = Math.min(pool, Math.floor(u.acc.wdie + 1e-9));
      u.acc.wdie -= n;
      if (n > 0) {
        const fromUnit = Math.min(n, p.wounded);
        p.wounded -= fromUnit; p.killed += fromUnit;
        if (u.type === 'medevac') u.carriedWounded -= (n - fromUnit);
        ensureEconomy(state)[u.faction].deadOfWounds += n;
        Loot.cacheAt(state, u.idx, true).dead[u.faction] += n;
        Engine.log(state, `${u.name}: ${n} поранених померли${stab ? ' попри допомогу' : ' без медичної допомоги'}.`, 'warn', u.faction);
      }
    }
    for (const h of facilities(state).filter(x => x.type === 'hospital' && !x.destroyed && x.patients > 0)) {
      const eco = state.economy[h.owner];
      const medNeed = h.patients * MD().medPerPatientHour;
      const hasMed = (h.stock.goods.med || 0) >= medNeed - 1e-9;
      h.stock.goods.med = Math.max(0, r1((h.stock.goods.med || 0) - medNeed));
      h.acc.die += h.patients * (hasMed ? MD().hospitalDeathPerHour : MD().untreatedDeathPerHour);
      h.acc.rec += h.patients * (hasMed ? MD().hospitalRecoverPerHour : 0);
      const die = Math.min(h.patients, Math.floor(h.acc.die + 1e-9)); h.acc.die -= die; h.patients -= die;
      const rec = Math.min(h.patients, Math.floor(h.acc.rec + 1e-9)); h.acc.rec -= rec; h.patients -= rec;
      eco.deadOfWounds += die; eco.recovered += rec; eco.manpower += rec;
      if (die || rec || !hasMed) Engine.log(state, `«${h.name}»: ${rec ? `${rec} одужали й повернулися до резерву` : ''}${rec && die ? ', ' : ''}${die ? `${die} померли` : ''}${!hasMed ? (rec || die ? '; ' : '') + 'немає медзапасів — лікування зупинено' : ''}. Пацієнтів: ${h.patients}/${FT().hospital.beds}.`, 'supply', h.owner);
    }
    // 7. Ремонт техніки
    for (const rb of facilities(state).filter(x => x.type === 'repair_base' && !x.destroyed && x.condition > 0 && x.offline <= 0)) {
      const def = FT().repair_base;
      for (const v of state.units.filter(x => x.vehicle && x.faction === rb.owner && g(state).dist(x.idx, rb.idx) <= 1 && x.vehicle.condition < 100)) {
        const net = rb;
        const add = Math.min(def.repairPerHour, 100 - v.vehicle.condition);
        const st = facilities(state).find(s => isStore(s) && s.owner === rb.owner && (s.stock.goods.parts || 0) > 0) || rb;
        const parts = Math.ceil(add / def.repairPerHour * def.partsPerRepair);
        if ((st.stock.goods.parts || 0) < parts) continue;
        st.stock.goods.parts -= parts;
        v.vehicle.condition += add;
        Engine.log(state, `${v.name}: ремонт на «${rb.name}» +${add}% (стан ${v.vehicle.condition}%).`, 'supply', v.faction);
      }
    }
  }
  function scale(o, k) { const r = {}; for (const [a, n] of Object.entries(o)) { const v = Math.floor(n * k); if (v) r[a] = v; } return r; }

  // ---------------------------------------------------- знання про об’єкти
  function updateKnowledge(state) {
    for (const f of facilities(state)) {
      for (let fac = 0; fac < 3; fac++) {
        const seen = f.hidden ? state.units.some(u => u.faction === fac && u.personnel.fit > 0 && g(state).dist(u.idx, f.idx) <= 1) : Intel.hexObserved(state, fac, f.idx);
        if (f.owner === fac || seen) {
          if (!f.knownBy.includes(fac)) f.knownBy.push(fac);
          f.seen[fac] = { day: state.time.day, hour: state.time.hour, owner: f.owner, destroyed: f.destroyed };
        }
      }
    }
  }
  function known(state, fac) { return facilities(state).filter(f => f.knownBy.includes(fac)); }

  // Поточна зона постачання (для відображення)
  function refreshSupply(state, fac) {
    const net = network(state, fac);
    for (const u of state.units) if (u.faction === fac) u.inSupply = u.embarked == null && net.dist[u.idx] >= 0;
    return net;
  }

  // ---------------------------------------------------- огляд для панелі
  function summary(state, fac) {
    ensureEconomy(state);
    const eco = state.economy[fac];
    const own = facilities(state).filter(f => f.owner === fac && !f.destroyed);
    const total = emptyStock();
    for (const f of own) { addObj(total.ammo, f.stock.ammo); addObj(total.weapons, f.stock.weapons); addObj(total.goods, f.stock.goods); }
    // прогноз на 6 годин
    let income = 0, expense = 0;
    for (const s of state.map.settlements) if (s.control === fac) income += Math.round((EC().income[s.kind] || 0) * Politics.incomeMult(state, s));
    const prod = [];
    for (const f of own) {
      const def = FT()[f.type];
      if (!def.cost) continue;
      const working = f.condition > 0 && state.map.control[f.idx] === fac;
      const after = Math.max(0, f.offline);
      if (working) expense += def.cost;
      prod.push({ f, def, working, offline: after });
    }
    const forecast = [];
    let money = eco.money;
    for (let h = 1; h <= 6; h++) { money += income - expense; forecast.push(money); }
    const man = state.units.filter(u => u.faction === fac);
    const inSupply = man.filter(u => u.inSupply).length;
    const wounded = man.reduce((a, u) => a + u.personnel.wounded + (u.carriedWounded || 0), 0);
    const patients = own.filter(f => f.type === 'hospital').reduce((a, f) => a + f.patients, 0);
    return { eco, own, total, income, expense, forecast, prod, inSupply, units: man.length, wounded, patients };
  }

  return {
    facilities, facilityAt, byId, isStore, makeFacility, placeScenario, ensureEconomy, network, basicLoad, supplyLevel, supplyText,
    resupply, resupplyReason, loadFromStore, loadReason, loadableItems, loadItem, issueFromCargo, issueReason, unloadToStore, unloadReason,
    destroyFacility, destroyReason, claimFacility, claimReason, pickupWounded, pickupReason, medevacsNear, hospitalsOf, endOfHour, updateKnowledge, known,
    summary, refreshSupply, sourcesAt, stockKg, cargoKg, cargoCapKg, describeStock, storesNear, emptyStock, convoys
  };
})();
