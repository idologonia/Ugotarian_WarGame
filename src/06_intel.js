// ============================================================================
// МОДУЛЬ: РОЗВІДКА ТА ТУМАН ВІЙНИ
// Кожна фракція має власну картину: видимі зараз ворожі підрозділи та
// застарілі позначки з часом отримання й рівнем упевненості.
// Розвіддані поширюються на всю фракцію (зв’язок поки є завжди).
// ============================================================================
const Intel = (() => {
  const D = () => CONFIG.detection;
  const visCache = new WeakMap();   // state -> [Set, Set, Set] видимих зараз

  function ensure(state) {
    if (!state.intel) state.intel = [{}, {}, {}];
    return state.intel;
  }

  function isVehicle(u) { return !!CONFIG.unitTypes[u.type].vehicle; }

  // Дальність спостереження підрозділу (у гексах)
  function observeRange(state, u) {
    const det = D();
    let r = u.type === 'recon' ? det.baseRange.recon : isVehicle(u) ? det.baseRange.vehicle : det.baseRange.foot;
    if (u.stance === 'observe') r += det.observeBonus;
    if (Engine.terrainKey(state, u.idx) === 'mountains') r += det.mountainObserverBonus;
    // Прихований спостережний пункт (запит гравця): розвідка в стійці «Розвідка», що простояла
    // в гексі з природним укриттям без руху цієї години, бачить далі.
    if (u.type === 'recon' && u.stance === 'observe' && u.movedTurn !== state.time.turn && (det.concealment[Engine.terrainKey(state, u.idx)] || 0) > 0) r += det.coverObserverBonus;
    if (u.type === 'recon' && u.binoculars) r += det.binocularsBonus;
    // свій блокпост у гексі — пост спостереження
    if (Logistics.facilityAt(state, u.idx).some(f => f.type === 'checkpoint' && f.owner === u.faction)) r += CONFIG.engineering.checkpoint.observeBonus;
    if (Engine.isNight(state.time.hour)) r -= det.night.penalty;
    if (u.personnel.fit <= 0 || u.dispersal >= 3) r = 1;
    return Math.max(1, r);
  }

  // Маскування цілі
  function concealment(state, t) {
    const det = D();
    let c = det.concealment[Engine.terrainKey(state, t.idx)] || 0;
    if (isVehicle(t)) c += det.vehicleConcealment;
    if (t.stance === 'observe' || t.stance === 'ambush' || (t.stance === 'defend' && t.fort > 0)) c += det.stanceConcealment * (t.stance === 'ambush' ? 1.5 : 1);
    if (t.firedTurn === state.time.turn) c += det.firedConcealment;
    return Math.max(0, c);
  }

  // Гекси на лінії між двома гексами (без кінцевих точок)
  function lineHexes(state, a, b) {
    const g = Engine.grid(state);
    const A = Hex.toAxial(g.col(a), g.row(a)), B = Hex.toAxial(g.col(b), g.row(b));
    const n = g.dist(a, b);
    const out = [];
    for (let k = 1; k < n; k++) {
      const t = k / n;
      // невеликий зсув, щоб уникнути неоднозначності на межі гексів
      const q = A.q + (B.q - A.q) * t + 1e-6, r = A.r + (B.r - A.r) * t + 2e-6;
      const s = -q - r;
      let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
      const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
      if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
      const o = Hex.toOffset(rq, rr);
      const i = g.idx(o.col, o.row);
      if (i >= 0) out.push(i);
    }
    return out;
  }

  function lineOfSight(state, from, to, observerInMountains) {
    const blocks = D().blocksLOS;
    for (const i of lineHexes(state, from, to)) {
      const k = Engine.terrainKey(state, i);
      if (!blocks.includes(k)) continue;
      if (observerInMountains && k !== 'mountains') continue;
      return { ok: false, blocker: i };
    }
    return { ok: true };
  }

  // Чи бачить спостерігач ціль
  function canSee(state, obs, target) {
    const g = Engine.grid(state);
    const dist = g.dist(obs.idx, target.idx);
    if (dist === 0) return true;
    if (dist === 1) return true;   // близький контакт — виявлення автоматичне
    const range = observeRange(state, obs) - concealment(state, target);
    if (dist > range) return false;
    return lineOfSight(state, obs.idx, target.idx, Engine.terrainKey(state, obs.idx) === 'mountains').ok;
  }

  // Чи спостерігає фракція гекс (для зняття застарілих позначок)
  function hexObserved(state, faction, idx) {
    const g = Engine.grid(state);
    if (typeof Air !== 'undefined' && Air.sees(state, faction, idx)) return true;
    const conc = D().concealment[Engine.terrainKey(state, idx)] || 0;
    for (const u of state.units) {
      if (u.faction !== faction || u.personnel.fit <= 0) continue;
      const d = g.dist(u.idx, idx);
      if (d <= 1) return true;
      if (d > observeRange(state, u) - conc) continue;
      if (lineOfSight(state, u.idx, idx, Engine.terrainKey(state, u.idx) === 'mountains').ok) return true;
    }
    return false;
  }

  function describe(state, faction, e, observers) {
    const g = Engine.grid(state);
    const det = D();
    let minD = Infinity, recon = false;
    for (const o of observers) { const d = g.dist(o.idx, e.idx); if (d < minD) minD = d; if (o.type === 'recon') recon = true; }
    const identified = minD <= det.identifyRange || (recon && minD <= det.identifyRange + 1);
    const strength = minD <= det.strengthRange;
    const ut = CONFIG.unitTypes[e.type];
    return {
      id: e.id, faction: e.faction, idx: e.idx,
      day: state.time.day, hour: state.time.hour, turn: state.time.turn,
      cls: isVehicle(e) ? 'vehicle' : 'foot',
      type: identified ? e.type : null,
      label: identified ? ut.name : (isVehicle(e) ? 'Невідома техніка' : 'Невідомий піхотний підрозділ'),
      fit: strength ? e.personnel.fit : null,
      approx: strength ? null : (identified ? approxSize(ut.personnel) : null),
      dist: minD
    };
  }
  function describeDrone(state, e) {
    const ut = CONFIG.unitTypes[e.type];
    return { id: e.id, faction: e.faction, idx: e.idx, day: state.time.day, hour: state.time.hour, turn: state.time.turn,
      cls: isVehicle(e) ? 'vehicle' : 'foot', type: e.type, label: ut.name, fit: null, approx: approxSize(ut.personnel), dist: 0, drone: true };
  }
  function approxSize(n) { return n >= 15 ? 'взвод (~20)' : n >= 5 ? 'відділення (~5)' : 'група (2–4)'; }

  // Повне оновлення картини для всіх трьох фракцій
  function update(state) {
    const intel = ensure(state);
    const sets = [new Set(), new Set(), new Set()];
    const live = state.units.filter(u => (u.personnel.fit > 0 || u.personnel.straggling > 0) && u.embarked == null);  // пасажирів не видно ззовні
    for (let f = 0; f < 3; f++) {
      const observers = state.units.filter(u => u.faction === f && u.personnel.fit > 0);
      for (const e of live) {
        if (e.faction === f) continue;
        const seenBy = observers.filter(o => canSee(state, o, e));
        // БПЛА над районом (07j_air.js): бачить і впізнає тип, чисельність — приблизно
        const drone = !seenBy.length && typeof Air !== 'undefined' && Air.sees(state, f, e.idx);
        if (!seenBy.length && !drone) continue;
        sets[f].add(e.id);
        const prev = intel[f][e.id];
        const info = drone ? describeDrone(state, e) : describe(state, f, e, seenBy);
        // вже ідентифікований тип не «забувається»
        if (prev && prev.type && !info.type) { info.type = prev.type; info.label = prev.label; }
        intel[f][e.id] = info;
      }
      // Зняття позначок: ціль знищена або гекс оглянуто, а підрозділу там немає
      for (const id of Object.keys(intel[f])) {
        const m = intel[f][id];
        if (sets[f].has(Number(id))) continue;
        const real = state.units.find(u => u.id === Number(id));
        if (!real || real.faction === f) { delete intel[f][id]; continue; }
        if (hexObserved(state, f, m.idx) && real.idx !== m.idx) delete intel[f][id];
      }
    }
    // РЕР (радіоелектронна розвідка, запит гравця): окремий підрозділ (ew_team) раз на
    // cooldownHours годин пінгує ОДНУ (найближчу) активну ціль у межах дальності — активну,
    // тобто таку, що РУХАЛАСЯ чи СТРІЛЯЛА саме цієї години (мовчазний/нерухомий ворог «не чути»).
    // Позиція — завжди приблизна (той самий fuzz, що й звукова контрбатарейна розвідка), тип і
    // чисельність НЕ розкриваються (якщо вже впізнано раніше іншим способом — впізнання лишається).
    // Свідомо «слабкий» пін: не замінює справжню видимість (перевіряється тим-таки sets[f]).
    {
      const ewCfg = CONFIG.ew;
      const rangeHex = Math.floor(ewCfg.range / CONFIG.hexMeters);
      const g = Engine.grid(state);
      for (let f = 0; f < 3; f++) {
        // Запит гравця: РЕР пінгує лише коли сам підрозділ стоїть у стійці «розвідка» —
        // той самий u.stance==='observe', що й у розвідгрупи (гравець сам «включає» сканування).
        const stations = state.units.filter(u => u.faction === f && u.type === 'ew_team' && u.personnel.fit > 0 && u.embarked == null && u.stance === 'observe');
        for (const stn of stations) {
          if (stn.ewLast != null && state.time.turn - stn.ewLast < ewCfg.cooldownHours) continue;
          let best = null, bestDist = Infinity;
          for (const e of live) {
            if (e.faction === f || sets[f].has(e.id)) continue;
            if (e.movedTurn !== state.time.turn && e.firedTurn !== state.time.turn) continue;
            const d = g.dist(stn.idx, e.idx);
            if (d > rangeHex || d >= bestDist) continue;
            bestDist = d; best = e;
          }
          if (!best) continue;
          stn.ewLast = state.time.turn;
          // Похибка позиції росте з дистанцією: лінійна інтерполяція між minErrorShare (поруч)
          // і maxErrorShare (на межі rangeHex) — чим далі ціль, тим неточніший пін.
          const errShare = ewCfg.minErrorShare + (ewCfg.maxErrorShare - ewCfg.minErrorShare) * Math.min(1, bestDist / Math.max(1, rangeHex));
          const idx = soundFuzzIdx(state, stn.idx, best.idx, (best.id * 2654435761 + stn.id) >>> 0, errShare);
          const prev = intel[f][best.id];
          sets[f].add(best.id);
          intel[f][best.id] = {
            id: best.id, faction: best.faction, idx,
            day: state.time.day, hour: state.time.hour, turn: state.time.turn,
            cls: prev && prev.cls ? prev.cls : (isVehicle(best) ? 'vehicle' : 'foot'),
            type: prev && prev.type ? prev.type : null,
            label: prev && prev.type ? prev.label : 'Зафіксовано активність/переміщення радіообміну (РЕР)',
            fit: null, approx: null, dist: g.dist(stn.idx, idx), ew: true
          };
        }
      }
    }
    // Інформатори: населення з високою підтримкою доносить про противника в пункті
    if (typeof Politics !== 'undefined' && state.diplomacy) {
      const thr = CONFIG.population.informersAbove;
      for (let f = 0; f < 3; f++) {
        for (const s of state.map.settlements) {
          if (!s.pop || Politics.support(s, f) < thr) continue;
          for (const e of live) {
            if (e.faction === f || sets[f].has(e.id) || state.map.settlement[e.idx] !== s.id) continue;
            sets[f].add(e.id);
            const prev = intel[f][e.id];
            intel[f][e.id] = { id: e.id, faction: e.faction, idx: e.idx, day: state.time.day, hour: state.time.hour, turn: state.time.turn,
              cls: isVehicle(e) ? 'vehicle' : 'foot', type: prev && prev.type ? prev.type : null,
              label: prev && prev.type ? prev.label : `${isVehicle(e) ? 'Техніка' : 'Підрозділ'} (донесення мешканців ${s.name})`, fit: null, approx: null, dist: 99, informer: true };
          }
        }
      }
      // Обмін розвідданими між союзниками / за угодою
      for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
        if (!Politics.sharesIntel(state, a, b)) continue;
        for (const [x, y] of [[a, b], [b, a]]) {
          // власні підрозділи партнера видно повністю
          for (const p of state.units) {
            if (p.faction !== y || p.embarked != null) continue;
            sets[x].add(p.id);
            const ut = CONFIG.unitTypes[p.type];
            intel[x][p.id] = { id: p.id, faction: y, idx: p.idx, day: state.time.day, hour: state.time.hour, turn: state.time.turn,
              cls: isVehicle(p) ? 'vehicle' : 'foot', type: p.type, label: `${p.name} — ${ut.name}`, fit: p.personnel.fit, approx: null, dist: 0, partner: true, allied: Politics.allied(state, x, y) };
          }
          for (const id of [...sets[y]]) {
            const e = state.units.find(u => u.id === id);
            if (!e || e.faction === x) continue;
            sets[x].add(id);
            const rec = intel[y][id];
            if (rec && (!intel[x][id] || intel[x][id].turn <= rec.turn)) intel[x][id] = Object.assign({}, rec, { shared: y });
          }
        }
      }
    }
    for (let f = 0; f < 3; f++) for (const id of Object.keys(intel[f])) {
      const m = intel[f][id];
      if (m.partner && !(typeof Politics !== 'undefined' && state.diplomacy && Politics.sharesIntel(state, f, m.faction))) delete intel[f][id];
      else if (m.partner) m.allied = Politics.allied(state, f, m.faction);
    }
    visCache.set(state, sets);
    if (typeof Loot !== 'undefined') Loot.updateKnowledge(state);
    if (typeof Logistics !== 'undefined') Logistics.updateKnowledge(state);
    return sets;
  }

  // Після кроку руху: нові вороги, яких побачив саме цей підрозділ
  function stepUpdate(state, mover, seenBefore) {
    const fresh = [];
    for (const e of state.units) {
      if (e.faction === mover.faction || e.personnel.fit <= 0 || e.embarked != null) continue;
      if (seenBefore.has(e.id)) continue;
      if (typeof Politics !== 'undefined' && state.diplomacy && Politics.allied(state, mover.faction, e.faction)) continue;
      if (canSee(state, mover, e)) { fresh.push(e); seenBefore.add(e.id); }
    }
    // інші фракції помічають рухомий підрозділ на кожному кроці
    const intel = ensure(state);
    for (let f = 0; f < 3; f++) {
      if (f === mover.faction || mover.embarked != null) continue;
      const seenBy = state.units.filter(o => o.faction === f && o.personnel.fit > 0 && canSee(state, o, mover));
      if (seenBy.length) {
        const prev = intel[f][mover.id];
        const info = describe(state, f, mover, seenBy);
        if (prev && prev.type && !info.type) { info.type = prev.type; info.label = prev.label; }
        intel[f][mover.id] = info;
      }
    }
    if (fresh.length) update(state);
    return fresh;
  }

  // Контрбатарейне виявлення: постраждала сторона чує виліт (звук) і рахує час підльоту снаряда —
  // напрямок на позицію дальняка виходить точний, дистанція — приблизна. Не замінює дійсне
  // виявлення (canSee): якщо позицію вже видно, звичайна видимість переважає.
  function soundFuzzIdx(state, fromIdx, realIdx, seedKey, shareOverride) {
    const g = Engine.grid(state);
    if (fromIdx === realIdx) return realIdx;
    const a = Hex.toAxial(g.col(fromIdx), g.row(fromIdx));
    const b = Hex.toAxial(g.col(realIdx), g.row(realIdx));
    const dq = b.q - a.q, dr = b.r - a.r;
    const share = shareOverride != null ? shareOverride : CONFIG.combat.counterBattery.distanceErrorShare;
    const h = hash2(seedKey >>> 0, state.time.turn, 7);   // [0,1), детерміновано — без «прихованої» випадковості
    const factor = 1 + (h * 2 - 1) * share;
    const nq = Math.round(a.q + dq * factor), nr = Math.round(a.r + dr * factor);
    const o = Hex.toOffset(nq, nr);
    const idx = g.idx(o.col, o.row);
    return idx >= 0 ? idx : realIdx;
  }
  function counterBatteryReport(state, viewerFaction, shooter, fromIdx) {
    if (viewerFaction === shooter.faction) return;
    if (isVisible(state, viewerFaction, shooter.id)) return;   // уже видно насправді — точне важливіше за звукове
    const intel = ensure(state);
    const prev = intel[viewerFaction][shooter.id];
    if (prev && prev.turn === state.time.turn) return;
    const idx = soundFuzzIdx(state, fromIdx, shooter.idx, shooter.id * 2654435761 + fromIdx);
    intel[viewerFaction][shooter.id] = {
      id: shooter.id, faction: shooter.faction, idx,
      day: state.time.day, hour: state.time.hour, turn: state.time.turn,
      cls: isVehicle(shooter) ? 'vehicle' : 'foot', type: null,
      label: 'Ймовірна позиція навісної зброї (звукова розвідка)', fit: null, approx: null,
      dist: Engine.grid(state).dist(fromIdx, idx), sound: true
    };
  }

  function visibleIds(state, faction) {
    let sets = visCache.get(state);
    if (!sets) sets = update(state);
    return sets[faction];
  }
  function isVisible(state, faction, unitId) { return visibleIds(state, faction).has(unitId); }

  function confidence(state, m) {
    const age = state.time.turn - m.turn;
    return Math.max(10, 100 - age * D().confidenceLossPerHour);
  }

  // Список відомого противника для фракції
  // opts.allies: true — лише союзники; 'all' — усі; інакше — без союзників (противник)
  function knownList(state, faction, opts = {}) {
    const intel = ensure(state)[faction];
    const vis = visibleIds(state, faction);
    const ally = m => typeof Politics !== 'undefined' && state.diplomacy && Politics.allied(state, faction, m.faction);
    return Object.values(intel).filter(m => opts.allies === 'all' ? true : opts.allies ? ally(m) : !ally(m)).map(m => Object.assign({}, m, {
      visible: vis.has(m.id), age: state.time.turn - m.turn, confidence: vis.has(m.id) ? 100 : confidence(state, m)
    })).sort((a, b) => a.age - b.age || a.id - b.id);
  }

  function markerAt(state, faction, idx) { return knownList(state, faction).filter(m => m.idx === idx); }

  return { ensure, update, stepUpdate, canSee, hexObserved, observeRange, concealment, lineOfSight, lineHexes, visibleIds, isVisible, knownList, markerAt, confidence, counterBatteryReport };
})();
