// ============================================================================
// МОДУЛЬ: АЕРОПОРТ І ПОВІТРЯНА РОЗВІДКА (запит гравця)
// Аеропорт ДП — повноцінний об’єкт на місці «Аеродрому «НАТО»» (прикордонного переходу ДП)
// зі злітною смугою на 3 гекси. Поки ДП його тримає й він не заблокований, вантажні рейси
// доставляють ПВК і закупівлі вдвічі швидше. Звідси ж злітає розвідувальний БПЛА RQ-1 Predator
// (реальний прототип — Predator над Боснією, липень–листопад 1995, операції НАТО): виліт на
// обраний район, до кінця години розкриває противника в радіусі; вночі не літає; апаратів
// обмежено, кожен виліт ризикує втратою (більше — біля ворожого великокаліберного кулемета).
// Доступ до Predator відкриває рішення «Повітряна розвідка НАТО» (07k_decisions.js).
// ============================================================================
const Air = (() => {
  const A = () => CONFIG.air;
  const g = state => Engine.grid(state);

  // ------------------------------------------------------------ аеропорт
  function airport(state, f) {
    return Logistics.facilities(state).find(x => x.type === 'airport' && x.home === f) || null;
  }
  // Працює: існує, не знищений, належить своїй фракції, перехід не втрачено/не заблоковано
  function airportReason(state, f) {
    const ap = airport(state, f);
    if (!ap) return 'Аеропорту немає.';
    if (ap.destroyed) return 'Аеропорт зруйновано.';
    if (ap.owner !== f) return 'Аеропорт захоплено противником.';
    if (Engine.unitsAt(state, ap.idx).some(u => u.faction !== f && u.personnel.fit > 0)) return 'Аеропорт заблоковано противником.';
    return null;
  }
  function deliveryMult(state, f) { return airportReason(state, f) ? 1 : A().airportDeliveryMult; }

  // Смуга на 3 гекси: перехід ДП + два сусіди по одній прямій, прохідні й на своїй території
  function placeAirport(state) {
    const m = state.map, grid = g(state), f = 1;
    const c = m.borderEntry ? m.borderEntry[f] : -1;
    if (c == null || c < 0 || airport(state, f)) return null;
    const ok = i => i >= 0 && !m.river[i] && m.terrain[i] !== TERRAIN_ID.sea && m.settlement[i] < 0;
    let runway = [c];
    for (let d = 0; d < 3; d++) {
      const a = grid.neighbor(c, d), b = grid.neighbor(c, d + 3);
      if (ok(a) && ok(b)) { runway = [a, c, b]; break; }
    }
    if (runway.length === 1) {
      for (let d = 0; d < 6; d++) {
        const a = grid.neighbor(c, d), b = a >= 0 ? grid.neighbor(a, d) : -1;
        if (ok(a) && ok(b)) { runway = [c, a, b]; break; }
      }
    }
    const ap = Logistics.makeFacility(state, 'airport', c, f, A().airportName);
    ap.home = f;
    ap.runway = runway;
    return ap;
  }

  // ------------------------------------------------------------ Predator
  function uav(state, f) {
    if (!state.uav) state.uav = {};
    if (!state.uav[f]) state.uav[f] = { unlocked: false, airframes: A().uav.airframes, last: null, sorties: [] };
    return state.uav[f];
  }
  function cooldownLeft(state, f) {
    const u = uav(state, f);
    return u.last == null ? 0 : Math.max(0, A().uav.cooldownHours - (state.time.turn - u.last));
  }
  function uavReason(state, f, idx) {
    const u = uav(state, f);
    if (!u.unlocked) return 'Повітряну розвідку ще не отримано (рішення «Повітряна розвідка НАТО»).';
    if (u.airframes <= 0) return 'Усі БПЛА втрачено.';
    const ar = airportReason(state, f);
    if (ar) return ar;
    if (Engine.isNight(state.time.hour)) return 'Вночі БПЛА не літає.';
    const left = cooldownLeft(state, f);
    if (left > 0) return `Наступний виліт через ${left} год (обслуговування, підготовка).`;
    if (idx != null) {
      if (idx < 0 || idx >= g(state).size) return 'Гекс поза картою.';
      if (g(state).dist(airport(state, f).idx, idx) > A().uav.rangeHex) return `Задалеко від аеропорту (до ${A().uav.rangeHex} гекс.).`;
    }
    return null;
  }
  // Шанс втрати: базовий + за кожен відомий чи невідомий ворожий «Утьос» поблизу району
  function lossChance(state, f, idx) {
    const G = g(state), U = A().uav;
    let ch = U.lossBase;
    for (const e of state.units) {
      if (e.faction === f || e.personnel.fit <= 0 || Politics.allied(state, f, e.faction)) continue;
      const aa = (e.weapons['НСВ «Утьос»'] || 0) > 0 || e.mount === 'НСВ «Утьос»';
      if (aa && G.dist(e.idx, idx) <= U.radius) ch += U.lossPerAA;
    }
    return Math.min(U.lossMax, ch);
  }
  function launch(state, f, idx) {
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = uavReason(state, f, idx);
    if (why) return { ok: false, reason: why };
    const u = uav(state, f), U = A().uav;
    u.last = state.time.turn;
    u.sorties = (u.sorties || []).filter(s => s.turn >= state.time.turn - 1);
    u.sorties.push({ idx, radius: U.radius, turn: state.time.turn });
    Intel.update(state);
    const seen = Intel.knownList(state, f).filter(m => m.visible && g(state).dist(m.idx, idx) <= U.radius).length;
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const roll = hash2(seed ^ 0x51ed27, state.time.turn, idx * 7 + u.airframes) * 100;
    const chance = lossChance(state, f, idx);
    const lost = roll < chance;
    const lbl = g(state).label(idx);
    Engine.log(state, `${U.name}: виліт над ${lbl} — у радіусі ${U.radius} гекс. виявлено противника: ${seen}. Спостереження триває до кінця години.`, 'event', f, null, { at: idx });
    if (lost) {
      u.airframes--;
      Engine.log(state, `${U.name} втрачено над ${lbl}${chance > U.lossBase ? ' — ймовірно, збито вогнем великокаліберного кулемета' : ' — відмова двигуна'}. Залишилось апаратів: ${u.airframes}.`, 'warn', f, null, { at: idx });
      for (let x = 0; x < 3; x++) if (x !== f && chance > U.lossBase) Engine.log(state, `Над ${lbl} збито ворожий БПЛА.`, 'event', x, [x], { at: idx });
    }
    return { ok: true, seen, lost, chance };
  }
  // Активні вильоти: до кінця години, в якій злетіли
  function activeSorties(state, f) {
    const u = state.uav && state.uav[f];
    return u && u.sorties ? u.sorties.filter(s => s.turn === state.time.turn) : [];
  }
  function sees(state, f, idx) {
    const G = g(state);
    for (const s of activeSorties(state, f)) {
      if (G.dist(s.idx, idx) > s.radius) continue;
      if (A().uav.hiddenIn.includes(Engine.terrainKey(state, idx))) continue;
      return true;
    }
    return false;
  }
  function unlock(state, f) { uav(state, f).unlocked = true; }

  return { airport, airportReason, deliveryMult, placeAirport, uav, cooldownLeft, uavReason, lossChance, launch, activeSorties, sees, unlock };
})();
