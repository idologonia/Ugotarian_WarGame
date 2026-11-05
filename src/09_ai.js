// ============================================================================
// МОДУЛЬ: ШТУЧНИЙ ІНТЕЛЕКТ (БОТИ)
// Бот керує фракцією у її фазі через ті самі функції, що й гравець (Engine, Combat,
// Logistics, Recruit, Politics) — тож обійти правила не може. Обидва рівні чесні:
// про противника знають лише те, що є в розвідці фракції (Intel.knownList).
//   easy — прямолінійний: кожен підрозділ іде до найближчого чужого пункту, стріляє
//          в першого видимого ворога, не зважає на співвідношення сил, не поповнюється.
//   hard — штаб: тримає гарнізони за загрозою, зосереджує сили на одній цілі, чекає
//          підходу групи перед штурмом, фокусує вогонь, відводить зламані підрозділи,
//          поповнює боєприпаси, підвозить піхоту машинами, формує нові підрозділи,
//          відповідає на дипломатичні пропозиції з розрахунком.
// Рішення детерміновані (hash2 замість Math.random) — однакова гра дає однакові ходи.
// Пам’ять бота (state.ai) — звичайні дані, зберігаються разом із грою.
// ============================================================================
const AI = (() => {
  const LEVELS = ['easy', 'hard'];
  const CONTROLLER_NAMES = { human: 'Людина', easy: 'Бот (легкий)', hard: 'Бот (важкий)' };

  // ------------------------------------------------------------ гравці
  // state.players[f] = { type: 'human' } | { type: 'ai', level: 'easy' | 'hard' }
  function configure(state, list) {
    state.players = [0, 1, 2].map(f => {
      const k = list && list[f];
      return LEVELS.includes(k) ? { type: 'ai', level: k } : { type: 'human' };
    });
    state.ai = { mem: [{}, {}, {}] };
    return state;
  }
  function controller(state, f) {
    const p = state.players && state.players[f];
    return p && p.type === 'ai' && LEVELS.includes(p.level) ? p.level : 'human';
  }
  function isBot(state, f) { return f != null && controller(state, f) !== 'human'; }
  function humans(state) { return [0, 1, 2].filter(f => !isBot(state, f)); }
  function mem(state, f) {
    if (!state.ai) state.ai = { mem: [{}, {}, {}] };
    const m = state.ai.mem[f] || (state.ai.mem[f] = {});
    if (!m.tasks) m.tasks = {};
    return m;
  }

  // ------------------------------------------------------------ довідники
  const COVER = { plain: 0, farmland: 0.5, coast: 0, swamp: 0, forest: 2, denseForest: 3, mountains: 2.5, village: 2, city: 3, industrial: 2.5, sea: 0 };
  const settlementHexCache = new WeakMap();
  function settlementHexes(state) {
    let c = settlementHexCache.get(state.map);
    if (!c) {
      c = state.map.settlements.map(() => []);
      for (let i = 0; i < state.map.settlement.length; i++) { const s = state.map.settlement[i]; if (s >= 0 && c[s]) c[s].push(i); }
      settlementHexCache.set(state.map, c);
    }
    return c;
  }

  function role(u) {
    if (Transport.isVehicle(u)) return u.type === 'veh_mtlb' || u.mount ? 'armor' : 'transport';
    if (Combat.hasIndirect(u)) return 'artillery';
    switch (u.type) {
      case 'hmg_team': return 'support';
      case 'recon': return 'recon';
      case 'ew_team': return 'ew';
      case 'medevac': case 'supply_team': case 'eng_squad': case 'crew': return 'rear';
      default: return 'infantry';
    }
  }
  const ROLE_WEIGHT = { infantry: 1, support: 2.5, armor: 4, transport: 0.3, artillery: 0.8, recon: 0.8, ew: 0.3, rear: 0.4 };

  // Бойова вага свого підрозділу (точні дані — це наш підрозділ)
  function power(u) {
    if (u.personnel.fit <= 0) return 0;
    const r = role(u);
    let p = u.personnel.fit * ROLE_WEIGHT[r];
    if (r === 'armor') p = 12 * Math.max(0.2, (u.vehicle ? u.vehicle.condition : 100) / 100);
    p *= 0.4 + 0.6 * Math.max(0, Math.min(100, u.morale)) / 100;
    p *= 1 - Math.min(0.6, (u.suppression || 0) / 100);
    if (Logistics.supplyLevel(u) < 0.15) p *= 0.4;
    return p;
  }
  // Оцінка ворога за позначкою розвідки: чисельність — якщо відома, інакше штат типу або «середнє»
  function markPower(m) {
    const ut = m.type ? CONFIG.unitTypes[m.type] : null;
    if (m.cls === 'vehicle' && (!ut || m.type === 'veh_mtlb')) return 10;
    if (m.cls === 'vehicle') return 2;
    let n = m.fit != null ? m.fit : ut ? ut.personnel : 6;
    let w = 1;
    if (m.type === 'hmg_team' || m.type === 'ags_team' || m.type === 'mg_team') w = 2.5;
    else if (m.type === 'medevac' || m.type === 'supply_team' || m.type === 'ew_team') w = 0.4;
    const fade = m.visible ? 1 : Math.max(0.3, 1 - 0.1 * m.age);
    return n * w * fade;
  }

  // Детермінована «випадковість» для бота
  function roll(state, f, a, b) {
    return hash2((((state.meta && state.meta.seed) || 1999) >>> 0) ^ Math.imul(f + 7, 2654435761), state.time.turn * 31 + a, b);
  }

  // ------------------------------------------------------------ контекст фази
  function buildCtx(state, f, level) {
    const g = Engine.grid(state);
    const known = Intel.knownList(state, f).filter(m => m.age <= 8);
    const enemies = known.map(m => ({ m, idx: m.idx, pow: markPower(m), visible: m.visible }));
    const own = state.units.filter(u => u.faction === f && u.personnel.fit > 0);
    const allied = x => x >= 0 && x !== f && Politics.allied(state, f, x);
    const hexesOf = settlementHexes(state);
    const objectives = (state.campaign && state.campaign.objectives && state.campaign.objectives[f]) || [];
    const settlements = state.map.settlements.map((s, k) => {
      const radius = s.kind === 'city' ? 4 : 2;
      let enemyPow = 0, ownPow = 0, threat = 0;
      for (const e of enemies) {
        const d = g.dist(e.idx, s.center);
        if (d <= radius + 1) enemyPow += e.pow;
        // загроза — і ті, хто ще на підході (кілька гексів за межею пункту)
        if (d <= radius + 6) threat += e.pow * (d <= radius + 2 ? 1 : 0.6);
      }
      for (const u of own) if (g.dist(u.idx, s.center) <= radius + 1) ownPow += power(u);
      const objPts = objectives.filter(o => o.type === 'holdSettlement' && o.settlement === k).reduce((a, o) => a + o.points, 0);
      const value = objPts + (s.kind === 'city' ? 15 : 6);
      return { s, k, radius, hexes: hexesOf[k] || [], enemyPow, threat, ownPow, value, mine: s.control === f, friendly: s.control === f || allied(s.control) };
    });
    return { state, f, level, g, enemies, own, settlements, mem: mem(state, f), acted: new Set(), focus: new Map(), stats: { attacks: 0, moves: 0, stances: 0, other: 0 } };
  }

  const ok = r => r && r.ok;
  function safe(ctx, label, fn) {
    try { return fn(); }
    catch (e) { if (typeof console !== 'undefined') console.error(`ШІ (${CONFIG.factions[ctx.f].short}) — ${label}:`, e); return null; }
  }
  const nearestEnemyDist = (ctx, idx) => { let b = Infinity; for (const e of ctx.enemies) b = Math.min(b, ctx.g.dist(idx, e.idx)); return b; };
  const visibleEnemyNear = (ctx, idx, r) => ctx.enemies.some(e => e.visible && ctx.g.dist(idx, e.idx) <= r);
  function inSettlement(ctx, idx) { const k = ctx.state.map.settlement[idx]; return k >= 0 ? ctx.settlements[k] : null; }
  function canAttackNow(state, u) { return u.attackedTurn !== state.time.turn && u.embarked == null && Engine.canAct(u); }

  // ------------------------------------------------------------ накази
  function moveTo(ctx, u, target, kind = 'move') {
    if (target == null || target < 0 || target === u.idx) return false;
    if (u.order && u.order.target === target && u.order.type === kind) return true;
    if (u.pendingOrder && u.pendingOrder.target === target) return true;
    const r = Engine.issueMoveOrder(ctx.state, u.id, target, kind);
    if (ok(r)) { ctx.stats.moves++; return true; }
    return false;
  }
  // Найкращий гекс для виходу поблизу center на відстані [rMin, rMax]: прохідний, без відомого
  // противника, з укриттям, ближче до підрозділу. Пробуємо кілька кращих — шлях може бути неможливим.
  function moveNear(ctx, u, center, rMin, rMax, opts = {}) {
    const { state, g } = ctx;
    const cls = Engine.moveClass(u);
    const foreign = Engine.knownForeignHexes(state, ctx.f);
    const taken = opts.taken || new Set();
    const cands = [];
    for (const i of g.within(center, rMax)) {
      const d = g.dist(i, center);
      if (d < rMin || foreign.has(i) || !Engine.hexPassable(state, cls, i)) continue;
      const enemyD = nearestEnemyDist(ctx, i);
      if (opts.safeDist && enemyD < opts.safeDist) continue;
      let score = -g.dist(u.idx, i) * 0.6 + (COVER[Engine.terrainKey(state, i)] || 0) * (opts.coverW != null ? opts.coverW : 1);
      if (taken.has(i)) score -= 3;
      if (opts.preferSettlement != null && state.map.settlement[i] === opts.preferSettlement) score += 2;
      if (opts.towards != null) score -= g.dist(i, opts.towards) * 0.5;
      cands.push({ i, score });
    }
    cands.sort((a, b) => b.score - a.score || a.i - b.i);
    if (cands.length && cands[0].i === u.idx) return 'here';
    for (const c of cands.slice(0, opts.tries || 3)) {
      if (c.i === u.idx) return 'here';
      if (moveTo(ctx, u, c.i, opts.kind || 'move')) { taken.add(c.i); return c.i; }
    }
    return null;
  }
  function hold(ctx, u, stance = 'defend') {
    if (u.order || u.pendingOrder) return false;
    if (u.stance === stance) return true;
    if (u.embarked != null || Transport.isVehicle(u)) return false;
    const r = Engine.setStance(ctx.state, u.id, stance);
    if (ok(r)) ctx.stats.stances++;
    return ok(r);
  }

  // ------------------------------------------------------------ вогонь
  // Обрати найкращу ціль для u й атакувати. Повертає true, якщо атака відбулася.
  function fire(ctx, u) {
    const { state, g, level } = ctx;
    if (!canAttackNow(state, u)) return false;
    const indirect = Combat.hasIndirect(u);
    if (indirect && Combat.needsDeploy(u) && !u.deployed) {
      if (u.order) return false;
      if (!ok(Engine.deploy(state, u.id))) return false;
    }
    const maxR = Math.max(1, Math.floor(Combat.maxRange(u, indirect, state) / CONFIG.hexMeters));
    const cands = [];
    for (const e of ctx.enemies) {
      const d = g.dist(u.idx, e.idx);
      if (d > maxR) continue;
      if (!e.visible && (!indirect || level === 'easy' || e.m.age > 2)) continue;
      // важкий бот не стріляє туди, де колона біженців (удар по підтримці й репутації)
      if (level === 'hard' && Civil.columnsAt(state, e.idx).length) continue;
      const target = e.visible ? { unitId: e.m.id } : { hex: e.idx };
      cands.push({ e, d, target });
    }
    if (!cands.length) return false;
    const myPow = power(u);
    const ammo = Logistics.supplyLevel(u);
    const scored = [];
    for (const c of cands) {
      const pv = Combat.previewAttack(state, u.id, c.target, 'normal');
      if (!pv.ok || (pv.breaks && pv.breaks.length)) continue;
      let score;
      if (level === 'easy') score = -c.d - roll(state, ctx.f, u.id, c.e.m.id) * 2;
      else {
        const sk = state.map.settlement[c.e.idx];
        score = 10 / (1 + c.e.pow);                                   // слабку ціль легше добити
        if (sk >= 0) score += ctx.settlements[sk].mine ? 3 : ctx.mem.target === sk ? 2.5 : 0.5;
        // ворог у центрі пункту вирішує, чий пункт, — вибити його найважливіше
        if (sk >= 0 && ctx.settlements[sk].s.center === c.e.idx && (ctx.settlements[sk].mine || ctx.mem.target === sk)) score += 6;
        score += (ctx.focus.get(c.e.m.id) || 0) * 2;                   // зосередження вогню
        if (c.e.m.cls === 'vehicle' && Object.keys(u.weapons).some(m => CONFIG.weapons[m] && CONFIG.weapons[m].at >= 50 && u.weapons[m] > 0)) score += 4;
        if (!indirect) {
          // прямий вогонь — це перестрілка: не лізти на значно сильнішого, якщо не з позицій.
          // Рахуємо всю свою силу поруч із ціллю — сусіди теж стрілятимуть цієї фази.
          let local = myPow;
          for (const o of ctx.own) if (o !== u && o.embarked == null && g.dist(o.idx, c.e.idx) <= 2 && role(o) !== 'transport') local += power(o);
          const ratio = local / Math.max(0.5, c.e.pow);
          const dug = u.stance === 'defend' && u.fort > 0;
          if (ratio < (dug ? 0.35 : 0.7)) continue;
          score += Math.min(3, ratio);
        }
        if (!c.e.visible) score -= 2;
        score -= c.d * 0.2;
      }
      scored.push({ c, score });
    }
    if (!scored.length) return false;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].c;
    let intensity = 'normal';
    if (level === 'hard') {
      const key = state.map.settlement[best.e.idx] >= 0;
      if (ammo < 0.25) intensity = 'low';
      else if (ammo > 0.6 && (key || (ctx.focus.get(best.e.m.id) || 0) > 0)) intensity = 'high';
    }
    let r = Combat.attack(state, u.id, best.target, intensity);
    if (!ok(r) && intensity !== 'normal') r = Combat.attack(state, u.id, best.target, 'normal');
    if (!ok(r)) return false;
    ctx.stats.attacks++;
    ctx.focus.set(best.e.m.id, (ctx.focus.get(best.e.m.id) || 0) + 1);
    ctx.acted.add(u.id);
    refreshEnemies(ctx);
    return true;
  }
  // Після бою картина змінюється (ворог відступив / знищений) — оновлюємо відомості
  function refreshEnemies(ctx) {
    const known = Intel.knownList(ctx.state, ctx.f).filter(m => m.age <= 8);
    ctx.enemies = known.map(m => ({ m, idx: m.idx, pow: markPower(m), visible: m.visible }));
  }

  // ------------------------------------------------------------ дипломатія
  function threatOf(ctx, x) {
    const { g } = ctx;
    let t = 0;
    for (const e of ctx.enemies) {
      if (e.m.faction !== x) continue;
      const near = ctx.own.some(u => g.dist(u.idx, e.idx) <= 6) || ctx.settlements.some(s => s.mine && g.dist(s.s.center, e.idx) <= 6);
      t += near ? e.pow : e.pow * 0.3;
    }
    return t;
  }
  function diplomacy(ctx) {
    const { state, f, level } = ctx;
    const inc = Politics.incoming(state, f);
    if (!inc.length) return;
    const threats = [0, 1, 2].map(x => x === f ? -1 : threatOf(ctx, x));
    const main = threats.indexOf(Math.max(...threats));
    for (const p of inc) {
      let accept;
      if (level === 'easy') {
        accept = (p.type === 'ceasefire' || p.type === 'intel' || p.type === 'exchange') && roll(state, f, p.id, 3) < 0.5;
      } else {
        const fromMain = p.from === main && threats[main] > 0;
        switch (p.type) {
          case 'ceasefire': case 'alliance': accept = !fromMain || threats[p.from] < 5; break;
          case 'intel': case 'supply': case 'corridor': accept = !fromMain; break;
          case 'territory': accept = p.terms && p.terms.giver !== f; break;
          case 'exchange': accept = true; break;
          default: accept = false;
        }
      }
      const r = Politics.respond(state, p.id, !!accept);
      if (ok(r)) ctx.stats.other++;
    }
  }

  // ------------------------------------------------------------ економіка (важкий)
  // Експорт у РФ (соц. влада): продаємо надлишок пального й нафти, лишаючи запас для армії
  function exportSurplus(ctx) {
    const { state, f } = ctx;
    if (f !== 0 || Foreign.saleCooldownLeft(state, f) > 0) return;
    const RT = CONFIG.russiaTrade;
    for (const [key, keep] of [['fuel', 3000], ['crude', 2000]]) {
      const n = RT.items[key].n;
      const batches = Math.min(5, Math.floor((Foreign.saleAvailable(state, f, key) - keep) / n));
      if (batches >= 1 && !Foreign.saleReason(state, f, key, batches) && ok(Foreign.sellRF(state, f, key, batches))) { ctx.stats.other++; return; }
    }
  }

  // Рішення (фокуси): важкий бот бере перше доступне за пріоритетом своєї сторони,
  // лишаючи запас коштів на армію
  const DEC_PRIO = {
    0: ['mobilization', 'russianArmy', 'amnesty2', 'amnesty1'],
    1: ['natoAir', 'contact', 'jointHQ', 'westMission', 'unitedFront'],
    2: ['contact', 'jointHQ', 'diasporaMob', 'unitedFront']
  };
  function takeDecision(ctx) {
    const { state, f } = ctx;
    if (Decisions.state(state).active[f]) return;
    const items = Decisions.list(state, f);
    const money = Logistics.ensureEconomy(state)[f].money;
    for (const id of DEC_PRIO[f]) {
      const d = items.find(x => x.id === id);
      if (!d || d.status !== 'available' || money - d.cost < 1000) continue;
      if (ok(Decisions.start(state, f, id))) { ctx.stats.other++; return; }
    }
  }

  // Зовнішня допомога: інвестиції (повстанці — безкоштовна заявка), добровольці, ПВК при
  // достатку коштів, закупівлі СВ у РФ
  function foreignAid(ctx) {
    const { state, f } = ctx;
    const eco = Logistics.ensureEconomy(state)[f];
    if (f !== 0 && !Foreign.investReason(state, f) && ok(Foreign.requestInvestment(state, f))) ctx.stats.other++;
    if (!Foreign.callReason(state, f) && eco.money - Foreign.volCost(state, f) > 1500 && ok(Foreign.callVolunteers(state, f))) ctx.stats.other++;
    const stores = Logistics.facilities(state).filter(x => Logistics.isStore(x) && x.owner === f && !x.destroyed)
      .sort((a, b) => nearestEnemyDist(ctx, b.idx) - nearestEnemyDist(ctx, a.idx) || a.id - b.id);
    if (!stores.length) return;
    if (eco.money > 6000 && !Foreign.pmcReason(state, f, stores[0], 'platoon') && ok(Foreign.hirePmc(state, f, stores[0].id, 'platoon'))) ctx.stats.other++;
    if (f === 0 && eco.money > 4000 && Foreign.officialCooldownLeft(state, 0) === 0) {
      const fuel = stores.reduce((a, x) => a + (x.stock.goods.fuel || 0), 0);
      const key = fuel < 2000 ? 'fuel' : '762s';
      if (!Foreign.officialReason(state, 0, key, 2, stores[0]) && ok(Foreign.officialRequest(state, 0, key, 2, stores[0].id))) ctx.stats.other++;
    }
  }

  function economy(ctx) {
    const { state, f, g } = ctx;
    safe(ctx, 'рішення', () => takeDecision(ctx));
    safe(ctx, 'допомога', () => foreignAid(ctx));
    safe(ctx, 'експорт', () => exportSurplus(ctx));
    const eco = Logistics.ensureEconomy(state)[f];
    const stores = Logistics.facilities(state).filter(x => Logistics.isStore(x) && x.owner === f && !x.destroyed);
    if (!stores.length) return;
    if (eco.money < 1200) return;
    const roles = {};
    for (const u of ctx.own) roles[role(u)] = (roles[role(u)] || 0) + 1;
    const enemyArmor = ctx.enemies.some(e => e.m.cls === 'vehicle');
    const prio = [];
    if (enemyArmor && (roles.infantry || 0) > 3) prio.push('at_team');
    if ((roles.artillery || 0) < 2) prio.push('mortar');
    prio.push('inf_squad', 'mg_team', 'inf_platoon', 'at_team');
    // найбезпечніший склад — найдалі від відомого противника
    stores.sort((a, b) => nearestEnemyDist(ctx, b.idx) - nearestEnemyDist(ctx, a.idx) || a.id - b.id);
    const queued = (state.formations || []).filter(x => x.faction === f).length;
    if (queued >= 2) return;
    for (const st of stores) {
      for (const t of prio) {
        if (Recruit.formReason(state, f, st, t)) continue;
        if (ok(Recruit.form(state, f, st.id, t))) { ctx.stats.other++; return; }
      }
    }
    void g;
  }

  // ------------------------------------------------------------ поповнення
  function tryResupply(ctx, u) {
    if (u.embarked != null || Logistics.supplyLevel(u) > 0.8) return false;
    if (Logistics.resupplyReason(ctx.state, u)) return false;
    const r = Logistics.resupply(ctx.state, u.id);
    if (ok(r)) { ctx.stats.other++; ctx.acted.add(u.id); return true; }
    return false;
  }
  function goResupply(ctx, u) {
    const stores = Logistics.facilities(ctx.state).filter(x => Logistics.isStore(x) && (x.owner === ctx.f || Politics.sharesSupply(ctx.state, x.owner, ctx.f)) && !x.destroyed);
    stores.sort((a, b) => ctx.g.dist(u.idx, a.idx) - ctx.g.dist(u.idx, b.idx) || a.id - b.id);
    for (const st of stores.slice(0, 2)) {
      if (ctx.g.dist(u.idx, st.idx) <= 1) return tryResupply(ctx, u);
      if (moveNear(ctx, u, st.idx, 0, 1, { tries: 2 })) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ відступ
  function broken(ctx, u) {
    const share = u.personnel.fit / Math.max(1, u.personnel.assigned);
    if (ctx.level === 'easy') return u.morale < 20;
    return u.morale < 35 || (share < 0.35 && role(u) !== 'transport');
  }
  function retreat(ctx, u) {
    if (!visibleEnemyNear(ctx, u.idx, 2)) return false;
    // до найближчого свого пункту без противника, інакше — куди підкаже рушій
    const home = ctx.settlements.filter(s => s.friendly && s.enemyPow < 1)
      .sort((a, b) => ctx.g.dist(u.idx, a.s.center) - ctx.g.dist(u.idx, b.s.center))[0];
    if (home && ctx.g.dist(u.idx, home.s.center) > 1 && moveNear(ctx, u, home.s.center, 0, home.radius, { kind: 'retreat', tries: 2, safeDist: 2 })) return true;
    const h = Engine.suggestRetreat(ctx.state, u.id);
    return h != null && moveTo(ctx, u, h, 'retreat');
  }

  // ------------------------------------------------------------ транспорт (важкий)
  // Машина з пасажирами: везе їх до їхньої цілі й висаджує за 3+ гекси від відомого ворога.
  function driveVehicle(ctx, v) {
    const { state, g } = ctx;
    const pass = Transport.passengers(state, v);
    if (!pass.length) return false;
    const task = ctx.mem.tasks[v.id];
    const dest = task && task.drop != null ? task.drop : null;
    const danger = nearestEnemyDist(ctx, v.idx) <= 3;
    if (dest == null || v.idx === dest || danger || (g.dist(v.idx, dest) <= 1 && !v.order)) {
      if (ok(Transport.disembarkAll(state, v.id))) { delete ctx.mem.tasks[v.id]; ctx.stats.other++; return true; }
      return false;
    }
    return moveTo(ctx, v, dest);
  }
  // Посадити піший підрозділ у вільну машину того ж гекса, якщо йти далеко
  function rideIfFar(ctx, u, goal) {
    const { state, g } = ctx;
    if (ctx.level !== 'hard' || u.embarked != null || Engine.moveClass(u) !== 'foot' || g.dist(u.idx, goal) < 12) return false;
    if (u.mp < Engine.mpMax(u) * 0.5) return false;
    const opts = Transport.vehiclesFor(state, u).filter(x => !x.reason && x.free >= Transport.persons(u) && role(x.v) === 'transport' && !Transport.passengers(state, x.v).length);
    if (!opts.length) return false;
    const v = opts[0].v;
    // точка висадки: на шляху до цілі, за 3+ гекси від відомого противника
    let drop = null, best = Infinity;
    for (const i of g.within(goal, 7)) {
      const d = g.dist(i, goal);
      if (d < 3 || nearestEnemyDist(ctx, i) < 4 || !Engine.hexPassable(state, Engine.moveClass(v), i)) continue;
      const sc = d * 2 + g.dist(v.idx, i) * 0.2;
      if (sc < best) { best = sc; drop = i; }
    }
    if (drop == null || g.dist(v.idx, drop) < 8) return false;
    if (!Engine.previewMove(state, v.id, drop).ok) return false;
    if (!ok(Transport.board(state, u.id, v.id))) return false;
    ctx.mem.tasks[v.id] = { drop };
    ctx.stats.other++;
    ctx.acted.add(u.id);
    driveVehicle(ctx, v);
    return true;
  }

  // ------------------------------------------------------------ легкий бот
  function militaryEasy(ctx) {
    const { state, g, f } = ctx;
    const units = ctx.own.filter(u => u.embarked == null).sort((a, b) => a.id - b.id);
    for (const u of units) {
      if (!Engine.canAct(u)) continue;
      const r = role(u);
      if (broken(ctx, u) && safe(ctx, 'відступ', () => retreat(ctx, u))) continue;
      if (r !== 'transport' && r !== 'ew' && r !== 'rear' && safe(ctx, 'вогонь', () => fire(ctx, u))) continue;
      if (r === 'artillery' || r === 'transport' || r === 'rear') continue;
      if (r === 'ew' || r === 'recon') { hold(ctx, u, 'observe'); continue; }
      if (u.order) continue;
      const here = inSettlement(ctx, u.idx);
      // частина підрозділів просто сидить у своєму пункті
      if (here && here.mine && (visibleEnemyNear(ctx, u.idx, 3) || roll(state, f, u.id, 1) < 0.35)) { hold(ctx, u); continue; }
      const targets = ctx.settlements.filter(s => !s.friendly)
        .map(s => ({ s, d: g.dist(u.idx, s.s.center) + roll(state, f, u.id, s.k + 11) * 6 }))
        .sort((a, b) => a.d - b.d);
      if (!targets.length) { hold(ctx, u); continue; }
      const t = targets[0].s;
      if (!safe(ctx, 'рух', () => moveTo(ctx, u, t.s.center))) safe(ctx, 'рух', () => moveNear(ctx, u, t.s.center, 1, 2, { tries: 2 }));
    }
  }

  // ------------------------------------------------------------ важкий бот
  // Скільки сили потрібно, щоб узяти пункт: відомий противник + припущення про ту частину
  // пункту, яку зараз не видно (туман війни — порожнім невидиме місто не вважаємо).
  function needFor(ctx, s) {
    const hexes = s.hexes.length ? s.hexes : [s.s.center];
    let seen = 0;
    for (const i of hexes) if (Intel.hexObserved(ctx.state, ctx.f, i)) seen++;
    const hidden = 1 - seen / hexes.length;
    const assumed = (s.s.kind === 'city' ? 60 : 6) * hidden;
    return Math.max(4, (s.enemyPow + assumed) * 1.4);
  }

  // Оцінка всіх чужих пунктів як цілей для сили offPow (більше — краще)
  function rankTargets(ctx, offPow) {
    const { g } = ctx;
    const own = ctx.own.filter(u => ['infantry', 'support', 'armor'].includes(role(u)));
    const distFrom = s => {
      let d = Infinity;
      for (const x of ctx.settlements) if (x.mine) d = Math.min(d, g.dist(x.s.center, s.s.center));
      for (const u of own) d = Math.min(d, g.dist(u.idx, s.s.center) + 2);
      return d;
    };
    const out = [];
    for (const s of ctx.settlements) {
      if (s.friendly) continue;
      const need = needFor(ctx, s);
      const feas = Math.min(1.5, offPow / need);
      let score = s.value * feas * feas / (1 + distFrom(s) / 6);
      if (feas < 0.8) score *= 0.3;
      out.push({ s, need, feas, score });
    }
    return out.sort((x, y) => y.score - x.score || x.s.k - y.s.k);
  }

  // Наступ із зобов’язаннями: підрозділ тримається своєї цілі щонайменше COMMIT_HOURS годин
  // (марш через пів карти туди-сюди — найгірше, що може зробити штаб), змінює її раніше лише
  // коли ціль уже наша або відомий противник там утричі сильніший за всю групу.
  const COMMIT_HOURS = 4;
  function planGroups(ctx, strike) {
    const { g, state } = ctx;
    if (!strike.length) return [];
    const offPow = strike.reduce((a, u) => a + power(u), 0);
    const ranked = rankTargets(ctx, offPow);
    if (!ranked.length) return [];
    const byK = new Map(ranked.map(t => [t.s.k, t]));
    const assign = ctx.mem.assign && typeof ctx.mem.assign === 'object' ? ctx.mem.assign : {};
    const load = new Map(ranked.map(t => [t.s.k, 0]));
    const members = new Map();
    const put = (u, t, turn) => {
      load.set(t.s.k, load.get(t.s.k) + power(u));
      if (!members.has(t.s.k)) members.set(t.s.k, { t, units: [] });
      members.get(t.s.k).units.push(u);
      next[u.id] = { k: t.s.k, turn };
    };
    const next = {};
    // сила, що вже йде на кожну ціль за старими зобов’язаннями
    const committedPow = new Map();
    for (const u of strike) { const a = assign[u.id]; if (a && byK.has(a.k)) committedPow.set(a.k, (committedPow.get(a.k) || 0) + power(u)); }
    const fresh = [];
    for (const u of strike) {
      const a = assign[u.id];
      const t = a && byK.get(a.k);
      const hopeless = t && t.s.enemyPow > 3 * (committedPow.get(a.k) || 0);
      if (t && !hopeless && state.time.turn - a.turn < COMMIT_HOURS) put(u, t, a.turn);
      else fresh.push(u);
    }
    // нові призначення: найвигідніша для підрозділу ціль із урахуванням уже спрямованої сили
    fresh.sort((a, b) => power(b) - power(a) || a.id - b.id);
    for (const u of fresh) {
      let best = null, bestScore = -Infinity;
      for (const t of ranked) {
        const d = g.dist(u.idx, t.s.s.center);
        let sc = t.s.value * Math.min(1.5, Math.max(0.2, t.feas)) / (1 + d / 6);
        if (t.feas < 0.5) sc *= 0.4;
        if (load.get(t.s.k) >= t.need * 1.5) sc *= 0.15;
        const prev = assign[u.id];
        if (prev && prev.k === t.s.k) sc *= 1.5;
        if (sc > bestScore) { bestScore = sc; best = t; }
      }
      const prev = assign[u.id];
      put(u, best, prev && prev.k === best.s.k ? prev.turn : state.time.turn);
    }
    const list = [...members.values()].sort((x, y) => load.get(y.t.s.k) - load.get(x.t.s.k) || x.t.s.k - y.t.s.k);
    ctx.mem.target = list.length ? list[0].t.s.k : null;
    ctx.mem.assign = next;
    return list;
  }

  // Наближення до противника в пункті k на дальність свого вогню (1–2 гекси), з укриттям
  function closeIn(ctx, u, enemies, taken) {
    const { state, g } = ctx;
    const e = enemies[u.id % Math.min(2, enemies.length)];
    const range = Math.max(1, Math.floor(Combat.maxRange(u, false, state) / CONFIG.hexMeters));
    const reach = Math.min(2, range);
    if (g.dist(u.idx, e.idx) <= reach && !u.order) { hold(ctx, u); return; }
    if (u.order && g.dist(u.order.target, e.idx) <= reach) return;
    const r = safe(ctx, 'штурм', () => moveNear(ctx, u, e.idx, 1, reach, { taken, coverW: 1.5, tries: 3 }));
    if (r === 'here') hold(ctx, u);
  }

  // Дії групи щодо цілі: прямо до пункту; перед відомим сильнішим противником — зачекати
  // підходу решти на рубежі; потім — до найслабшого ворога в пункті або в центр.
  function assault(ctx, tgt, group) {
    const { state, g, f } = ctx;
    const s = tgt.s;
    const stageR = s.radius + 3;
    const targetEnemies = ctx.enemies.filter(e => g.dist(e.idx, s.s.center) <= s.radius + 1).sort((a, b) => a.pow - b.pow || a.m.id - b.m.id);
    const known = targetEnemies.reduce((a, e) => a + e.pow, 0);
    const nearPow = group.filter(u => g.dist(u.idx, s.s.center) <= stageR + 1).reduce((a, u) => a + power(u), 0);
    const groupPow = group.reduce((a, u) => a + power(u), 0);
    const wait = known > 0 && nearPow < known * 1.1 && nearPow < groupPow * 0.8;
    const taken = new Set();
    for (const u of group) {
      if (u.mp <= 1e-9 && !u.order) continue;
      if (Logistics.supplyLevel(u) < 0.3 && !visibleEnemyNear(ctx, u.idx, 2) && safe(ctx, 'поповнення', () => goResupply(ctx, u))) continue;
      if (safe(ctx, 'посадка', () => rideIfFar(ctx, u, s.s.center))) continue;
      const dist = g.dist(u.idx, s.s.center);
      if (wait && dist <= stageR + 1) {
        // чекаючи підкріплень біля дороги — засідка на шляху противника
        if (!u.order) hold(ctx, u, ambushSpot(ctx, u) ? 'ambush' : 'defend');
        continue;
      }
      if (wait || (dist > stageR + 1 && known > 0)) {
        if (u.order && Math.abs(g.dist(u.order.target, s.s.center) - stageR) <= 1) continue;
        const r = safe(ctx, 'збір', () => moveNear(ctx, u, s.s.center, stageR - 1, stageR + 1, { taken, safeDist: 2, tries: 3 }));
        if (r === 'here') hold(ctx, u);
        continue;
      }
      if (targetEnemies.length) { closeIn(ctx, u, targetEnemies, taken); continue; }
      const centerFree = !Engine.knownForeignHexes(state, f).has(s.s.center) && !taken.has(s.s.center);
      if (centerFree && !state.units.some(x => x.faction === f && x.idx === s.s.center) && moveTo(ctx, u, s.s.center)) { taken.add(s.s.center); continue; }
      if (u.order && state.map.settlement[u.order.target] === s.k) continue;
      const r = safe(ctx, 'зайняття', () => moveNear(ctx, u, s.s.center, 0, s.radius, { preferSettlement: s.k, taken, tries: 3 }));
      if (r === 'here') hold(ctx, u);
    }
  }

  // Засідка має сенс біля дороги, коли відомий противник неподалік, але ще не впритул
  function ambushSpot(ctx, u) {
    const { state, g } = ctx;
    if (Transport.isVehicle(u) || Combat.hasIndirect(u)) return false;
    const road = state.map.road[u.idx] > 0 || [0, 1, 2, 3, 4, 5].some(d => { const n = g.neighbor(u.idx, d); return n >= 0 && state.map.road[n] > 0; });
    const d = nearestEnemyDist(ctx, u.idx);
    return road && d >= 2 && d <= 6;
  }

  const OUTSIDE = ['ammo_plant', 'arms_plant', 'fieldDepot', 'airport', 'checkpoint', 'repair_base', 'depot'];
  function facilities(ctx, pool) {
    const { state, g, f } = ctx;
    const all = Logistics.facilities(state).filter(x => !x.destroyed && OUTSIDE.includes(x.type) && state.map.settlement[x.idx] < 0);
    // охорона своїх під загрозою
    for (const fa of all.filter(x => x.owner === f)) {
      const threat = ctx.enemies.filter(e => g.dist(e.idx, fa.idx) <= 4);
      if (!threat.length) continue;
      if (state.units.some(u => u.faction === f && u.idx === fa.idx && u.personnel.fit > 0)) continue;
      const u = [...pool].filter(x => g.dist(x.idx, fa.idx) <= 8).sort((a, b) => g.dist(a.idx, fa.idx) - g.dist(b.idx, fa.idx) || a.id - b.id)[0];
      if (!u) continue;
      pool.delete(u);
      if (Engine.knownForeignHexes(state, f).has(fa.idx)) closeIn(ctx, u, threat, new Set());
      else if (!moveTo(ctx, u, fa.idx) && u.idx === fa.idx) hold(ctx, u);
    }
    // рейди: до 2 малих груп на чужі/нічийні об’єкти без видимої охорони
    const known = new Set(Logistics.known(state, f).map(x => x.id));
    const targets = all.filter(x => known.has(x.id) && x.owner !== f && (x.owner === -1 || !Politics.allied(state, f, x.owner)));
    let raids = 0;
    for (const fa of targets.sort((a, b) => a.id - b.id)) {
      if (raids >= 2) break;
      const guard = ctx.enemies.filter(e => g.dist(e.idx, fa.idx) <= 2).reduce((a, e) => a + e.pow, 0);
      const cands = [...pool].filter(u => g.dist(u.idx, fa.idx) <= 12 && power(u) >= Math.max(2.5, guard * 1.3) && role(u) !== 'armor')
        .sort((a, b) => g.dist(a.idx, fa.idx) - g.dist(b.idx, fa.idx) || a.id - b.id);
      const u = cands[0];
      if (!u) continue;
      pool.delete(u); raids++;
      if (u.idx === fa.idx) {
        if (fa.owner === -1 && !Logistics.claimReason(state, u, fa) && ok(Logistics.claimFacility(state, u.id, fa.id))) ctx.stats.other++;
        else hold(ctx, u);
      } else if (Engine.knownForeignHexes(state, f).has(fa.idx)) {
        closeIn(ctx, u, ctx.enemies.filter(e => e.idx === fa.idx), new Set());
      } else moveTo(ctx, u, fa.idx);
    }
  }

  // Інженери: блокпост на дорозі на підступах до свого пункту, звідки найближче до ворога
  function buildCheckpoint(ctx, u) {
    const { state, g, f } = ctx;
    if (u.project) return true;
    const mine = Logistics.facilities(state).filter(x => x.type === 'checkpoint' && x.owner === f && !x.destroyed);
    if (mine.length >= 3) return false;
    if (state.map.road[u.idx] > 0 && state.map.settlement[u.idx] < 0 && state.map.control[u.idx] === f && !mine.some(x => g.dist(x.idx, u.idx) < 4)
      && nearestEnemyDist(ctx, u.idx) >= 3 && Field.options(state, u).some(o => o.type === 'checkpoint')) {
      const r = Field.startProject(state, u.id, 'checkpoint', u.idx);
      if (ok(r)) { ctx.stats.other++; return true; }
      return false;
    }
    // місце: дорога 2–4 гекси за межею свого пункту, ближче до ворожих пунктів; обране місце
    // пам’ятаємо кілька годин, щоб інженери не бігали туди-сюди
    const enemyTowns = ctx.settlements.filter(x => !x.friendly);
    if (!enemyTowns.length) return false;
    const t = ctx.mem.tasks['cp' + u.id];
    if (t && state.time.turn - t.turn < 6 && state.map.control[t.idx] === f && nearestEnemyDist(ctx, t.idx) >= 3 && !mine.some(x => g.dist(x.idx, t.idx) < 4)) return moveTo(ctx, u, t.idx);
    let best = -1, bs = Infinity;
    for (const s of ctx.settlements.filter(x => x.mine)) {
      for (const i of g.within(s.s.center, s.radius + 5)) {
        if (!state.map.road[i] || state.map.settlement[i] >= 0 || state.map.control[i] !== f) continue;
        const dEdge = g.dist(i, s.s.center) - s.radius;
        if (dEdge < 2 || dEdge > 4 || mine.some(x => g.dist(x.idx, i) < 4)) continue;
        const sc = Math.min(...enemyTowns.map(e => g.dist(i, e.s.center))) + g.dist(u.idx, i) * 0.2;
        if (sc < bs) { bs = sc; best = i; }
      }
    }
    if (best < 0) return false;
    ctx.mem.tasks['cp' + u.id] = { idx: best, turn: state.time.turn };
    return moveTo(ctx, u, best);
  }

  // Гаубиця Д-30 (сама майже не рухається): тягач везе її на позицію в межах дальності до цілі
  function towArtillery(ctx, u, front) {
    const { state, g, f } = ctx;
    const range = Math.floor(Combat.maxRange(u, true, state) / CONFIG.hexMeters);
    if (g.dist(u.idx, front) <= range - 1) return false;
    const tows = state.units.filter(v => v.faction === f && Transport.isVehicle(v) && role(v) === 'transport' && Engine.canAct(v) && !Transport.passengers(state, v).length && Transport.capacity(v) >= Transport.persons(u));
    const here = tows.find(v => v.idx === u.idx);
    if (here) {
      let drop = null, bs = Infinity;
      for (const i of g.within(front, range - 1)) {
        const d = g.dist(i, front);
        if (d < range - 5 || nearestEnemyDist(ctx, i) < 5 || !Engine.hexPassable(state, Engine.moveClass(here), i) || state.map.control[i] !== f) continue;
        const sc = g.dist(here.idx, i);
        if (sc < bs) { bs = sc; drop = i; }
      }
      if (drop == null || !Engine.previewMove(state, here.id, drop).ok) return false;
      if (u.deployed) u.deployed = false;
      if (!ok(Transport.board(state, u.id, here.id))) return false;
      ctx.mem.tasks[here.id] = { drop };
      ctx.stats.other++;
      driveVehicle(ctx, here);
      return true;
    }
    const v = tows.sort((a, b) => (a.type === 'veh_ural' ? 0 : 1) - (b.type === 'veh_ural' ? 0 : 1) || g.dist(a.idx, u.idx) - g.dist(b.idx, u.idx))[0];
    if (v) ctx.towCall = { vehicle: v.id, idx: u.idx };
    return false;
  }

  function militaryHard(ctx) {
    const { state, g, f } = ctx;
    const units = ctx.own.filter(u => u.embarked == null).sort((a, b) => a.id - b.id);
    const done = new Set();
    const mark = u => done.add(u.id);

    // 0. Розвідувальний БПЛА — над поточною ціллю, до бою (видимість одразу для вогню)
    safe(ctx, 'бпла', () => {
      if (ctx.mem.target == null || typeof Air === 'undefined') return;
      const c = state.map.settlements[ctx.mem.target].center;
      if (!Air.uavReason(state, f, c) && Air.lossChance(state, f, c) < 30 && ok(Air.launch(state, f, c))) { ctx.stats.other++; refreshEnemies(ctx); }
    });
    // 1. Машини з пасажирами — довезти/висадити
    for (const v of units) if (Transport.isVehicle(v) && Transport.passengers(state, v).length && Engine.canAct(v)) { safe(ctx, 'транспорт', () => driveVehicle(ctx, v)); mark(v); }
    // 2. Зламані — відводимо
    for (const u of units) if (!done.has(u.id) && Engine.canAct(u) && broken(ctx, u)) { if (safe(ctx, 'відступ', () => retreat(ctx, u))) mark(u); }
    // 3. Вогонь: спершу навісна (м’якшить), потім пряма — зосереджено
    for (const u of units) if (!done.has(u.id) && role(u) === 'artillery') { if (safe(ctx, 'вогонь', () => fire(ctx, u))) mark(u); }
    const direct = units.filter(u => !done.has(u.id) && ['infantry', 'support', 'armor', 'recon'].includes(role(u)));
    for (let pass = 0; pass < 2; pass++) for (const u of direct) if (!done.has(u.id) && (role(u) !== 'recon' || visibleEnemyNear(ctx, u.idx, 1))) { if (safe(ctx, 'вогонь', () => fire(ctx, u))) mark(u); }
    // 4. Поповнення біля складу
    for (const u of units) if (!done.has(u.id) && Engine.canAct(u) && safe(ctx, 'поповнення', () => tryResupply(ctx, u))) mark(u);

    const pool = new Set(units.filter(u => !done.has(u.id) && Engine.canAct(u) && ['infantry', 'support', 'armor', 'rear'].includes(role(u))));
    const mine = ctx.settlements.filter(s => s.mine);

    // 5. Тримачі центрів. Пункт належить тому, хто наприкінці години сам тримає центральний
    // гекс, — тож у кожному своєму пункті постійно стоїть хтось у центрі (бажано не найсильніший).
    const holders = ctx.mem.holders && typeof ctx.mem.holders === 'object' ? ctx.mem.holders : {};
    ctx.mem.holders = {};
    for (const s of mine) {
      const c = s.s.center;
      if (Engine.knownForeignHexes(state, f).has(c)) continue;
      let h = holders[s.k] != null ? Engine.unitById(state, holders[s.k]) : null;
      if (h && (h.faction !== f || h.personnel.fit <= 0 || h.embarked != null)) h = null;
      if (!h) h = units.find(u => u.idx === c && pool.has(u)) || null;
      if (!h) {
        const cands = [...pool].filter(u => role(u) !== 'armor' && u.type !== 'eng_squad' && g.dist(u.idx, c) <= s.radius + 12)
          .sort((a, b) => (g.dist(a.idx, c) <= s.radius + 3 ? 0 : 1) - (g.dist(b.idx, c) <= s.radius + 3 ? 0 : 1) || power(a) - power(b) || g.dist(a.idx, c) - g.dist(b.idx, c) || a.id - b.id);
        h = cands[0] || null;
      }
      if (!h) continue;
      ctx.mem.holders[s.k] = h.id;
      pool.delete(h);
      if (done.has(h.id) || !Engine.canAct(h)) continue;
      if (h.idx === c) { if (!h.order) hold(ctx, h); }
      else if (!(h.order && h.order.target === c)) safe(ctx, 'центр', () => moveTo(ctx, h, c));
    }
    for (const u of pool) if (role(u) === 'rear') pool.delete(u);

    // 6. Надзвичайна оборона: противник уже в нашому пункті — найближчі вибивають його
    const emergency = mine.filter(s => s.enemyPow > 0).sort((a, b) => b.enemyPow - a.enemyPow || a.k - b.k);
    for (const s of emergency) {
      const enemies = ctx.enemies.filter(e => g.dist(e.idx, s.s.center) <= s.radius + 1).sort((a, b) => a.pow - b.pow || a.m.id - b.m.id);
      if (!enemies.length) continue;
      const need = s.enemyPow * 1.5;
      let have = 0;
      const taken = new Set();
      const cands = [...pool].filter(u => g.dist(u.idx, s.s.center) <= s.radius + 8).sort((a, b) => g.dist(a.idx, s.s.center) - g.dist(b.idx, s.s.center) || a.id - b.id);
      for (const u of cands) {
        if (have >= need) break;
        pool.delete(u); have += power(u);
        if (!Engine.canAct(u) || (u.mp <= 1e-9 && !u.order)) continue;
        closeIn(ctx, u, enemies, taken);
      }
    }

    // 6б. Об’єкти поза пунктами (заводи, польові склади, блокпости, аеропорт): під загрозою —
    // хтось іде їх тримати; рейди — малі групи забирають чужі/нічийні об’єкти, де ворога не видно
    safe(ctx, 'об’єкти', () => facilities(ctx, pool));

    // 7. Наступ
    const strike = [...pool];
    const groups = planGroups(ctx, strike);
    const tgt = groups.length ? groups[0].t : null;
    for (const gr of groups) assault(ctx, gr.t, gr.units);
    if (!groups.length) for (const u of strike) if (!u.order) hold(ctx, u);

    // 8. Решта ролей
    const front = tgt ? tgt.s.s.center : null;
    for (const u of units) {
      if (done.has(u.id) || !Engine.canAct(u)) continue;
      const r = role(u);
      if (r === 'recon') {
        if (front == null) { hold(ctx, u, 'observe'); continue; }
        const d = g.dist(u.idx, front);
        if (!u.order && d >= 3 && d <= 5 && nearestEnemyDist(ctx, u.idx) >= 2) { hold(ctx, u, 'observe'); continue; }
        if (u.order) continue;
        const res = safe(ctx, 'розвідка', () => moveNear(ctx, u, front, 3, 5, { safeDist: 2, tries: 2 }));
        if (res === 'here') hold(ctx, u, 'observe');
      } else if (r === 'artillery') {
        // навісна — підтягнути, щоб ціль була в межах дальності, але не ближче 3 гексів до ворога
        if (u.type === 'arty_team') { if (front != null && !u.order) safe(ctx, 'буксир', () => towArtillery(ctx, u, front)); continue; }
        if (front == null || u.order) continue;
        const range = Math.floor(Combat.maxRange(u, true, state) / CONFIG.hexMeters);
        const d = g.dist(u.idx, front);
        if (d <= range - 1) continue;
        safe(ctx, 'артилерія', () => moveNear(ctx, u, front, Math.max(3, range - 3), range - 1, { safeDist: 3, tries: 2 }));
      } else if (r === 'ew') {
        hold(ctx, u, 'observe');
      } else if (r === 'rear') {
        if (u.order) continue;
        if (u.type === 'eng_squad' && safe(ctx, 'блокпост', () => buildCheckpoint(ctx, u))) continue;
        const here = inSettlement(ctx, u.idx);
        if (here && here.friendly && here.enemyPow < 1) { hold(ctx, u); continue; }
        const home = ctx.settlements.filter(x => x.friendly && x.enemyPow < 1).sort((a, b) => g.dist(u.idx, a.s.center) - g.dist(u.idx, b.s.center))[0];
        if (home) safe(ctx, 'тил', () => moveNear(ctx, u, home.s.center, 0, home.radius, { preferSettlement: home.k, tries: 2 }));
      } else if (r === 'transport') {
        if (u.order) continue;
        // тягач їде по гаубицю, якій треба на позицію
        if (ctx.towCall && ctx.towCall.vehicle === u.id) { safe(ctx, 'буксир', () => moveTo(ctx, u, ctx.towCall.idx)); continue; }
        const here = inSettlement(ctx, u.idx);
        if (here && here.friendly && here.enemyPow < 1) continue;
        const home = ctx.settlements.filter(x => x.friendly && x.enemyPow < 1).sort((a, b) => g.dist(u.idx, a.s.center) - g.dist(u.idx, b.s.center))[0];
        if (home) safe(ctx, 'автопарк', () => moveNear(ctx, u, home.s.center, 0, home.radius, { preferSettlement: home.k, tries: 2 }));
      }
    }
  }

  // ------------------------------------------------------------ фаза бота
  // Виконати всі дії бота для фракції поточної фази. Фазу НЕ завершує — це робить той,
  // хто викликає (інтерфейс або тест), через Engine.endPhase.
  function runPhase(state) {
    const f = Engine.phaseFaction(state);
    if (f == null || !isBot(state, f)) return { ok: false, reason: 'Зараз фаза не бота.' };
    if (state.campaign && state.campaign.over) return { ok: false, reason: 'Кампанію завершено.' };
    const level = controller(state, f);
    const ctx = buildCtx(state, f, level);
    safe(ctx, 'дипломатія', () => diplomacy(ctx));
    if (level === 'hard') safe(ctx, 'економіка', () => economy(ctx));
    safe(ctx, 'бій', () => level === 'hard' ? militaryHard(ctx) : militaryEasy(ctx));
    // прибрати задачі зниклих машин
    for (const id of Object.keys(ctx.mem.tasks)) if (!Engine.unitById(state, Number(String(id).replace(/^cp/, '')))) delete ctx.mem.tasks[id];
    return { ok: true, faction: f, level, stats: ctx.stats };
  }

  return { LEVELS, CONTROLLER_NAMES, configure, controller, isBot, humans, runPhase, role, power };
})();
