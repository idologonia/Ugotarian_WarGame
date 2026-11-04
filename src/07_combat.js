// ============================================================================
// МОДУЛЬ: БІЙ, МОРАЛЬ, ВТРАТИ
// Детермінований розрахунок без прихованої випадковості: дробові втрати
// накопичуються в лічильниках підрозділу й переходять у цілі числа.
// Кожен бій формує звіт за 6 кроками специфікації (п.11).
// ============================================================================
const Combat = (() => {
  const C = () => CONFIG.combat;
  const g = s => Engine.grid(s);

  function armorOf(u) { const v = CONFIG.unitTypes[u.type].vehicle; return v ? v.armor : 'soft'; }
  function isVehicle(u) { return armorOf(u) !== 'soft'; }
  function fitRatio(u) { const a = u.personnel.assigned; return a ? Math.max(0, u.personnel.fit) / a : 0; }
  function round1(x) { return Math.round(x * 10) / 10; }
  const F = x => Engine.fmt(round1(x));

  // Чи готова зброя стріляти: групова зброя — лише розгорнута (на техніці — завжди)
  function ready(u, m) { const w = CONFIG.weapons[m]; return !w.deploy || u.deployed || u.mount === m; }
  // Дальність з урахуванням висоти (гори) для навісного вогню й великокаліберних кулеметів
  function rangeOf(u, w, state) {
    if (state && (w.indirect || w.deploy) && Engine.terrainKey(state, u.idx) === 'mountains') return w.range * (1 + CONFIG.heightRangeBonus);
    return w.range;
  }
  function weaponsInRange(u, distHex, indirect, ctx = {}) {
    const out = [];
    for (const [m, n] of Object.entries(u.weapons)) {
      const w = CONFIG.weapons[m];
      if (!w || n <= 0) continue;
      if (!!w.indirect !== !!indirect) continue;
      if (!ready(u, m) && !ctx.ignoreDeploy) continue;
      if (w.atOnly && ctx.targetArmor === 'soft') continue;     // одноразові ПТГ — лише по техніці
      if (distHex * CONFIG.hexMeters > rangeOf(u, w, ctx.state)) continue;
      out.push({ model: m, n, w, range: rangeOf(u, w, ctx.state) });
    }
    return out;
  }
  function maxRange(u, indirect, state) {
    let r = 0;
    for (const [m, n] of Object.entries(u.weapons)) {
      const w = CONFIG.weapons[m];
      if (w && n > 0 && !!w.indirect === !!indirect) r = Math.max(r, rangeOf(u, w, state));
    }
    return r;
  }
  function needsDeploy(u) { return Object.entries(u.weapons).some(([m, n]) => n > 0 && CONFIG.weapons[m] && CONFIG.weapons[m].deploy && u.mount !== m); }
  function hasIndirect(u) { return maxRange(u, true) > 0; }

  // Пристрілка: виклик поспіль по тій самій цілі (без перерви в годину) покращує точність навісного вогню.
  function zeroingInfo(state, u, hex) {
    const Z = C().zeroing;
    const z = u.zeroing;
    const n = (z && z.hex === hex && z.idx === u.idx && z.turn === state.time.turn - 1) ? Math.min(3, z.n + 1) : 1;
    const mult = n === 1 ? Z.first : n === 2 ? Z.second : Z.third;
    return { n, mult };
  }

  // Кидок бою: детермінований (хеш seed+юніт+ціль+година), але варіативний — ±band
  // до ефективності вогню цієї сторони. Той самий бій на тому самому збереженні завжди дає
  // той самий кидок; Math.random() не використовується.
  function combatRoll(state, shooterId, targetKey, turn) {
    const cfg = C().combatRoll;
    if (!cfg || !cfg.enabled || !cfg.band) return 1;
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const sKey = (seed ^ Math.imul(shooterId + 1, 2654435761)) >>> 0;
    const h = hash2(sKey, turn, targetKey + 13);
    return 1 - cfg.band + h * 2 * cfg.band;
  }

  function terrainCover(state, idx) { return C().cover[Engine.terrainKey(state, idx)] || 0; }
  function coverOf(state, u, opts = {}) {
    let c = terrainCover(state, u.idx);
    if (opts.indirect) c *= C().indirectCoverFactor;
    if (isVehicle(u)) c *= 0.5;
    if (opts.advancing) c *= 0.5;
    const fort = opts.advancing ? 0 : u.fort;
    if (!opts.advancing && state.map.shelter) c += (state.map.shelter[u.idx] || 0) * CONFIG.engineering.shelter.cover;
    // Єгоза (запит гравця): суто місцевий фактор, як і бліндаж — захищає будь-кого в гексі,
    // незалежно від того, чия фракція її ставила (сукупний рівень усіх власників у гексі).
    if (!opts.advancing && state.map.wireLevel) c += (state.map.wireLevel[u.idx] || 0) * CONFIG.engineering.wire.cover;
    return Math.min(0.85, c + fort * C().fortCoverPerLevel * (opts.indirect ? C().indirectFortFactor : 1));
  }

  // Розрахунок вогню одного підрозділу
  function computeFire(state, shooter, distHex, intensityKey, opts = {}) {
    const cfg = C();
    const int = cfg.intensity[intensityKey] || cfg.intensity.normal;
    const disp = shooter.dispersal ? (1 - 0.25 * shooter.dispersal) : 1;
    const crewRatio = Math.min(1, fitRatio(shooter)) * disp;                         // групова зброя
    const h = Loot.holders(shooter);
    const holderRatio = (h > 0 ? Math.min(1, shooter.personnel.fit / h) : 0) * disp; // особиста зброя
    const list = weaponsInRange(shooter, distHex, opts.indirect, { state, targetArmor: opts.targetArmor });
    const need = {};
    for (const x of list) {
      const nEff = x.n * (Loot.isHolder(x.model) ? holderRatio : crewRatio);
      x.nEff = nEff;
      x.need = nEff * x.w.ammoPerHour * int.ammo;
      need[x.w.ammo] = (need[x.w.ammo] || 0) + x.need;
    }
    const use = {}, catRatio = {};
    for (const [cat, n] of Object.entries(need)) {
      const have = shooter.ammo[cat] || 0;
      const want = Math.ceil(n - 1e-9);
      use[cat] = Math.min(have, want);
      catRatio[cat] = want > 0 ? use[cat] / want : 0;
    }
    const roll = opts.roll != null ? opts.roll : 1;
    const heroMult = shooter.hero ? cfg.heroes.fireMult : 1;
    const mult = int.effect * cfg.experienceFire[shooter.experience] * (0.5 + shooter.morale / 200) * (1 - shooter.suppression / 200) * (opts.mult || 1) * roll * heroMult;
    let soft = 0, at = 0, sup = 0;
    const used = [];
    for (const x of list) {
      const rf = 1 - cfg.rangeFalloff * Math.min(1, distHex * CONFIG.hexMeters / x.range);
      const k = catRatio[x.w.ammo];
      const s = x.nEff * x.w.fp * x.w.accuracy / 100 * rf * k;
      const a = x.nEff * x.w.at * x.w.accuracy / 100 * rf * k;
      soft += s; at += a; sup += (s + a * 0.3) * (x.w.supp || 1);
      used.push({ model: x.model, n: x.n, eff: s * mult, at: a * mult, ammo: x.w.ammo, noAmmo: k === 0 });
    }
    return { soft: soft * mult, at: at * mult, sup: sup * mult, use, used, mult, roll, intensity: int.name };
  }

  function spendAmmo(u, use) {
    for (const [cat, n] of Object.entries(use)) {
      u.ammo[cat] = Math.max(0, (u.ammo[cat] || 0) - n);
      // одноразова зброя: використана труба викидається
      for (const [m, k] of Object.entries(u.weapons)) {
        const w = CONFIG.weapons[m];
        if (w && w.disposable && w.ammo === cat && n > 0) { u.weapons[m] = Math.max(0, k - n); if (!u.weapons[m]) delete u.weapons[m]; }
      }
    }
  }
  function ammoText(use) {
    const parts = Object.entries(use).filter(([, n]) => n > 0).map(([c, n]) => `${CONFIG.ammo[c].name}: ${n}`);
    return parts.length ? parts.join(', ') : 'нічого';
  }

  // Застосування вогню до цілі. Повертає опис наслідків.
  function applyDamage(state, t, fire, cover) {
    const cfg = C();
    const armor = armorOf(t);
    const p = t.personnel;
    let casRaw = fire.soft * cfg.casualtyK * (1 - cover) * cfg.exposure[armor];
    let condDmg = 0;
    if (armor !== 'soft') {
      condDmg = fire.at * cfg.vehicleDamageAT * (1 - cover) + fire.soft * cfg.vehicleDamageSmall[armor];
      casRaw += (condDmg / 100) * p.assigned * 0.5;   // ураження екіпажу при пробитті
    }
    const fitBefore = p.fit;
    const { cas: n, killed: k, wounded: w } = inflict(state, t, casRaw);
    const supp = (fire.sup != null ? fire.sup : fire.soft + fire.at * 0.3) * cfg.suppressionK * (1 - cover * 0.5);
    t.suppression = Math.min(100, t.suppression + supp);
    let destroyed = false, cond = 0;
    if (t.vehicle && condDmg > 0) {
      t.acc.veh += condDmg;
      cond = Math.floor(t.acc.veh + 1e-9);
      t.acc.veh -= cond;
      t.vehicle.condition = Math.max(0, t.vehicle.condition - cond);
      if (t.vehicle.condition <= 0) destroyed = true;
    }
    return { cas: n, killed: k, wounded: w, supp: round1(supp), suppRaw: supp, casRaw, perPerson: casRaw / Math.max(1, p.assigned), fitBefore, cond, destroyed };
  }

  // Дробові втрати накопичуються, цілі — застосовуються
  function inflict(state, t, casRaw) {
    const cfg = C();
    const p = t.personnel;
    t.acc.cas += casRaw;
    let n = Math.floor(t.acc.cas + 1e-9);
    t.acc.cas -= n;
    n = Math.min(n, p.fit);
    // округлення з перенесенням залишку: у середньому частка загиблих = killedShare
    t.acc.kill += n * cfg.killedShare;
    let k = n > 0 ? Math.max(0, Math.min(n, Math.round(t.acc.kill - 1e-9))) : 0;
    t.acc.kill -= k;
    const w = n - k;
    const fitBefore = p.fit;
    p.fit -= n; p.killed += k; p.wounded += w;
    if (k > 0) Loot.onKilled(state, t, k, fitBefore);
    return { cas: n, killed: k, wounded: w };
  }

  // Удар по підрозділу з урахуванням пасажирів і знищення машини
  function hitUnit(state, t, fire, cover, extra) {
    const r = applyDamage(state, t, fire, cover);
    if (t.carrying && t.carrying.length) {
      if (r.destroyed) Transport.wreck(state, t, extra);
      else Transport.hitPassengers(state, t, r.perPerson, r.suppRaw, extra);
    } else if (r.destroyed) {
      Transport.wreck(state, t, extra);
    }
    return r;
  }

  // Вогонь «сторони»: машина разом із пасажирами або пасажир із машини
  function groupFire(state, lead, distHex, intensityKey, opts = {}) {
    const tr = CONFIG.transport;
    const members = [{ u: lead, mult: lead.embarked != null ? tr.passengerFireMult : 1 }];
    if (lead.carrying && lead.carrying.length) for (const p of Transport.passengers(state, lead)) members.push({ u: p, mult: tr.passengerFireMult });
    const out = { soft: 0, at: 0, sup: 0, use: {}, uses: [], used: [], intensity: null, roll: opts.roll != null ? opts.roll : 1 };
    for (const m of members) {
      if (m.u.personnel.fit <= 0) continue;
      const f = computeFire(state, m.u, distHex, intensityKey, Object.assign({}, opts, { mult: (opts.mult || 1) * m.mult }));
      out.soft += f.soft; out.at += f.at; out.sup += f.sup; out.intensity = f.intensity;
      out.uses.push({ u: m.u, use: f.use });
      for (const [c, n] of Object.entries(f.use)) out.use[c] = (out.use[c] || 0) + n;
      for (const x of f.used) out.used.push(Object.assign({}, x, { model: m.u === lead ? x.model : `${x.model} [${m.u.name}${m.mult < 1 ? ', з машини' : ''}]` }));
    }
    if (!out.intensity) out.intensity = (C().intensity[intensityKey] || C().intensity.normal).name;
    return out;
  }
  function spendGroup(fire) { for (const x of fire.uses) spendAmmo(x.u, x.use); }

  function moraleAfter(state, u, res, extra) {
    const cfg = C();
    const pct = res.fitBefore > 0 ? res.cas / res.fitBefore * 100 : 0;
    let loss = pct * cfg.moraleLossPerPct + res.supp / cfg.moraleSuppressionDiv + (extra.ambushed ? cfg.moraleAmbushed : 0);
    if (res.cond) loss += res.cond * 0.15;
    loss *= cfg.experienceMorale[u.experience] * Politics.homeFactor(state, u);
    let gain = extra.win ? cfg.moraleWin : 0;
    const before = u.morale;
    u.morale = Math.max(0, Math.min(100, Math.round(u.morale - loss + gain)));
    const parts = [];
    if (pct > 0) parts.push(`втрати ${F(pct)}% складу (−${F(pct * cfg.moraleLossPerPct * cfg.experienceMorale[u.experience])})`);
    if (res.supp > 0) parts.push(`придушення (−${F(res.supp / cfg.moraleSuppressionDiv * cfg.experienceMorale[u.experience])})`);
    if (extra.ambushed) parts.push(`захоплено зненацька (−${F(cfg.moraleAmbushed * cfg.experienceMorale[u.experience])})`);
    if (res.cond) parts.push(`пошкодження техніки (−${F(res.cond * 0.15 * cfg.experienceMorale[u.experience])})`);
    if (gain) parts.push(`успіх у бою (+${gain})`);
    return { before, after: u.morale, text: parts.join(', ') || 'без змін' };
  }

  // Іменні ветерани (запит гравця): детермінований шанс (hash2 — не Math.random) після
  // «визначного» бою (res.cas >= heroes.minCas), якщо підрозділ вижив і ще не має героя.
  function heroCheck(state, u, res) {
    const hc = C().heroes;
    if (!hc || !res || u.hero || u.destroyed || u.personnel.fit <= 0 || res.cas < hc.minCas) return;
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const roll = hash2(seed ^ Math.imul(u.id + 1, 2246822519), state.time.turn, u.id * 17 + 5) * 100;
    if (roll >= hc.chance) return;
    const names = hc.names[u.faction] || [];
    if (!names.length) return;
    if (!state.heroCount) state.heroCount = [0, 0, 0];
    const name = names[state.heroCount[u.faction] % names.length];
    state.heroCount[u.faction]++;
    u.hero = { name, since: state.time.turn };
    u.baseMorale = Math.min(100, u.baseMorale + hc.moraleBonus);
    u.morale = Math.min(100, u.morale + hc.moraleBonus);
    Engine.log(state, `ГЕРОЙ: у ${u.name} визначним боєм відзначився ${name} — підрозділ отримує почесне ім’я, мораль і бойова стійкість зросли назавжди.`, 'event', u.faction, [u.faction], { uid: u.id });
  }

  function gainXp(state, u, amount) {
    u.xp += amount;
    const t = C().xpForLevel;
    let lvl = u.experience;
    while (lvl + 1 < t.length && u.xp >= t[lvl + 1]) lvl++;
    if (lvl > u.experience) {
      u.experience = lvl;
      Engine.log(state, `${u.name}: бойовий досвід зріс — тепер «${CONFIG.experience[lvl]}».`, 'info', u.faction);
    }
  }

  // ------------------------------------------------- наслідки для моралі
  // Відступ: до 3 гексів від загрози, до найближчого безпечного гекса
  // Відступ у тил: у межах очок руху (дорогами — далі), подалі від відомого
  // противника, ближче до своїх підрозділів і своєї території.
  // budgetShare — частка години, яку триває відступ.
  function findRetreatHex(state, u, threatIdx, budgetShare) {
    const grid = g(state);
    const cfg = C();
    const cls = Engine.moveClass(u);
    const occ = Engine.occupancy(state);
    // загрози: усі відомі вороги (видимі й застарілі позначки) + атакуючий
    const threats = Intel.knownList(state, u.faction).map(m => m.idx);
    if (threatIdx != null && threatIdx >= 0 && threatIdx !== u.idx) threats.push(threatIdx);
    const knownNow = Engine.knownForeignHexes(state, u.faction);
    const danger = new Set();
    for (const h of knownNow) for (let d = 0; d < 6; d++) { const n = grid.neighbor(h, d); if (n >= 0) danger.add(n); }
    const friends = state.units.filter(x => x.faction === u.faction && x !== u && x.embarked == null && x.personnel.fit > 0 && !(u.carrying || []).includes(x.id)).map(x => x.idx);
    const dMin = (i, list, cap) => { let m = cap; for (const h of list) { const d = grid.dist(i, h); if (d < m) m = d; } return m; };
    const score = (n, cost) => {
      const dT = threats.length ? Math.min(cfg.retreatWeights.threatCap, dMin(n, threats, 30)) : 0;
      const dF = friends.length ? dMin(n, friends, 30) : 0;
      const ctl = state.map.control[n];
      return dT * cfg.retreatWeights.threat - dF * cfg.retreatWeights.friend
        + (ctl === u.faction ? cfg.retreatWeights.ownControl : ctl >= 0 ? -cfg.retreatWeights.ownControl : 0)
        + (state.map.road[n] ? cfg.retreatWeights.road : 0)
        - (danger.has(n) ? cfg.retreatWeights.danger : 0)
        - cost * 0.3 - n * 1e-7;
    };
    // Рішення автора (запит гравця): паніка/злам моралі — відступ РІВНО на один гекс (не
    // марш у тил): budgetShare не передано (виклик із moraleOutcome) — обираємо найкращий
    // прохідний і вільний від ворога сусідній гекс і зупиняємось. Навмисний наказ «Відступ»
    // (suggestRetreat передає budgetShare=1) лишається повноцінним пошуком по Дейкстрі в
    // межах години руху — гравець сам вирішує відходити далі в тил.
    if (budgetShare == null) {
      let best = -1, bestScore = -Infinity, bestCost = 0;
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(u.idx, d);
        if (n < 0) continue;
        const c = Engine.stepCost(state, cls, u.idx, d, n);
        if (!isFinite(c)) continue;
        const list = occ.get(n);
        if (list && list.some(e => e.faction !== u.faction)) continue;
        const sc = score(n, c);
        if (sc > bestScore) { bestScore = sc; best = n; bestCost = c; }
      }
      if (best < 0) return { idx: -1 };
      return { idx: best, path: [best], cost: bestCost, safe: !danger.has(best) && dMin(best, threats, 99) > 1, better: bestScore > score(u.idx, 0) };
    }
    const budget = Engine.mpMax(u) * budgetShare;
    // Дейкстра в межах бюджету
    const dist = new Map([[u.idx, 0]]);
    const came = new Map();
    const heap = new MinHeap();
    heap.push(0, u.idx);
    const base = score(u.idx, 0);
    let best = -1, bestScore = -Infinity;
    while (heap.size) {
      const cur = heap.pop();
      const cd = dist.get(cur);
      if (cur !== u.idx) {
        const sc = score(cur, cd);
        if (sc > bestScore) { bestScore = sc; best = cur; }
      }
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(cur, d);
        if (n < 0) continue;
        const c = Engine.stepCost(state, cls, cur, d, n);
        if (!isFinite(c)) continue;
        const nd = cd + c;
        if (nd > budget + 1e-9 && !(cur === u.idx && dist.size === 1 && c <= Engine.mpMax(u))) continue;  // хоча б один гекс
        const list = occ.get(n);
        if (list && list.some(e => e.faction !== u.faction)) continue;
        if (nd < (dist.has(n) ? dist.get(n) : Infinity) - 1e-9) { dist.set(n, nd); came.set(n, cur); heap.push(nd, n); }
      }
    }
    if (best < 0) return { idx: -1 };
    const path = [];
    for (let c = best; c !== u.idx; c = came.get(c)) path.push(c);
    path.reverse();
    return { idx: best, path, cost: dist.get(best), safe: !danger.has(best) && dMin(best, threats, 99) > 1, better: bestScore > base };
  }

  // Досвід робить підрозділ стійкішим: новобранці («ополченці») ламаються вже за середньої
  // моралі, навчені регулярні війська — лише за низької, бойові ветерани — за дуже низької.
  function resolveMult(cfg, u) { return cfg.experienceResolve ? (cfg.experienceResolve[u.experience] != null ? cfg.experienceResolve[u.experience] : 1) : 1; }

  // Перевірка моралі після бою: відступ, розсіювання, капітуляція
  function moraleOutcome(state, u, opponent, lines) {
    const cfg = C();
    const grid = g(state);
    if (u.personnel.fit <= 0) return 'eliminated';
    const rm = resolveMult(cfg, u);
    const retreatBelow = cfg.retreatBelow * rm, disperseBelow = cfg.disperseBelow * rm, surrenderBelow = cfg.surrenderBelow * rm;
    // капітуляція
    const trySurrender = () => {
      if (isVehicle(u)) return false;
      if (u.morale > surrenderBelow) return false;
      const weak = u.personnel.fit <= u.personnel.assigned * 0.25;
      if (!u.surrounded && !weak) return false;
      const adj = Engine.adjacentEnemies(state, u);
      if (!adj.length) return false;
      const captor = adj.find(e => opponent && e.id === opponent.id) || adj[0];
      surrender(state, u, captor, lines);
      return true;
    };
    if (trySurrender()) return 'surrendered';
    const shaken = u.morale < retreatBelow && (u.lastLoss > 0 || u.morale < disperseBelow);
    if (!shaken) return 'held';
    const r = findRetreatHex(state, u, opponent ? opponent.idx : u.idx);
    if (r.idx < 0) {
      u.surrounded = true;
      u.morale = Math.max(0, u.morale - cfg.surroundedPenalty);
      lines.push(`${u.name}: шляху для відступу немає — підрозділ в оточенні (мораль −${cfg.surroundedPenalty}, тепер ${u.morale}).`);
      if (trySurrender()) return 'surrendered';
      if (u.morale < disperseBelow) { disperse(state, u, lines); return 'dispersed'; }
      return 'surrounded';
    }
    const fromIdx = u.idx;
    if (u.morale < disperseBelow) {
      disperse(state, u, lines);
      if (u.personnel.fit > 0) moveTo(state, u, r, lines, `рештки підрозділу відходять`);
      Engine.log(state, `ВІДСТУП: ${u.name} залишає ${grid.label(fromIdx)} — підрозділ розсіяний (мораль ${u.morale} < ${Math.round(disperseBelow)}). ${u.personnel.fit > 0 ? `Новий рубіж: ${grid.label(u.idx)}.` : 'Рештки підрозділу розсіяні на місці.'}`, 'alert', u.faction, [u.faction], { at: u.idx, uid: u.id });
      return 'dispersed';
    }
    moveTo(state, u, r, lines, `мораль ${u.morale} < ${Math.round(retreatBelow)} — відступ`);
    Engine.log(state, `ВІДСТУП: ${u.name} залишає позицію ${grid.label(fromIdx)} — мораль ${u.morale} < ${Math.round(retreatBelow)}. Новий рубіж: ${grid.label(u.idx)}.`, 'alert', u.faction, [u.faction], { at: u.idx, uid: u.id });
    return 'retreated';
  }

  function disperse(state, u, lines) {
    const cfg = C();
    const disperseBelow = cfg.disperseBelow * resolveMult(cfg, u);
    const lvl = Math.min(3, u.dispersal + (u.morale < disperseBelow / 2 ? 2 : 1));
    const share = cfg.disperseShare * (lvl >= 3 ? 2.5 : 1);
    const n = Math.min(u.personnel.fit, Math.ceil(u.personnel.fit * share));
    u.personnel.fit -= n; u.personnel.straggling += n;
    u.dispersal = u.personnel.fit <= 0 ? 3 : lvl;
    u.order = null; u.pendingOrder = null; u.stance = 'none'; u.fort = 0;
    lines.push(`${u.name}: мораль ${u.morale} < ${Math.round(disperseBelow)} — підрозділ розсіюється, ${n} бійців відстали (рівень розсіювання ${u.dispersal}/3). Вони можуть повернутися, якщо поруч не буде противника.`);
  }

  function moveTo(state, u, r, lines, why) {
    const grid = g(state);
    if (u.embarked != null) {
      const v = Engine.unitById(state, u.embarked);
      if (v) { v.carrying = v.carrying.filter(id => id !== u.id); lines.push(`${u.name}: покидає ${v.name}.`); }
      u.embarked = null;
    }
    const from = u.idx;
    u.idx = r.idx;
    u.order = null; u.pendingOrder = null; u.stance = 'none'; u.fort = 0; u.mp = 0;
    u.movedTurn = state.time.turn;
    if (!u.vehicle) u.deployed = false;
    if (u.carrying && u.carrying.length) Transport.syncPassengers(state, u);
    const viaRoad = r.path && r.path.filter(i => state.map.road[i]).length;
    lines.push(`${u.name}: ${why} ${grid.label(from)} → ${grid.label(r.idx)} (${r.path ? r.path.length : 1} гекс.${viaRoad ? `, з них ${viaRoad} дорогою` : ''}, у бік своїх)${r.safe ? '' : '; безпечного місця поблизу немає, контакт із противником зберігається'}.`);
    const mineHit = Mines.checkTrigger(state, u);
    if (mineHit) lines.push(`${u.name}: наштовхнувся на мінне поле під час відступу — ${mineHit.lines.join('; ')}.`);
  }


  function surrender(state, u, captor, lines) {
    const p = u.personnel;
    const prisoners = p.fit + p.wounded;
    const allW = Object.assign({}, u.weapons), allA = Object.assign({}, u.ammo), allG = {};
    // Рішення автора (виправлення багу): майно (cargo.goods) раніше губилося безслідно при
    // капітуляції — тепер переходить переможцю так само, як зброя й набої.
    if (u.cargo) { for (const [m, n] of Object.entries(u.cargo.weapons)) allW[m] = (allW[m] || 0) + n; for (const [c, n] of Object.entries(u.cargo.ammo)) allA[c] = (allA[c] || 0) + n; for (const [k, n] of Object.entries(u.cargo.goods || {})) allG[k] = (allG[k] || 0) + n; u.cargo = { weapons: {}, ammo: {}, goods: {} }; }
    const given = Loot.give(state, captor, allW, allA, allG);
    if (Loot.count(given.left.weapons)) { const c = Loot.cacheAt(state, u.idx, true); for (const [m, n] of Object.entries(given.left.weapons)) c.weapons[m] = (c.weapons[m] || 0) + n; }
    const tw = [Loot.describe(given)];
    const ta = [];
    p.captured += prisoners; p.fit = 0; p.wounded = 0;
    Politics.recordCaptured(state, captor.faction, prisoners);
    // відсталі бійці залишаються вільними — зниклі безвісти
    p.missing += p.straggling; p.straggling = 0;
    u.weapons = {}; u.ammo = {};
    state.prisoners.push({ holder: captor.faction, origin: u.faction, count: prisoners, unit: u.name, day: state.time.day, hour: state.time.hour });
    u.surrendered = { by: captor.faction, captor: captor.name };
    lines.push(`${u.name}: КАПІТУЛЯЦІЯ — мораль ${u.morale}, ${u.surrounded ? 'оточення' : 'залишилося ≤25% складу'}. У полон до «${Engine.fname(captor.faction)}» (${captor.name}) потрапили ${prisoners} осіб. Трофеї переходять до ${captor.name}: ${tw.join(', ')}.`);
  }

  // Видалення знищених / полонених підрозділів
  function cleanup(state) {
    const keep = [];
    for (const u of state.units) {
      const p = u.personnel;
      const gone = u.surrendered || u.destroyed || (p.fit <= 0 && p.straggling <= 0);
      if (!gone) { keep.push(u); continue; }
      if (u.carrying && u.carrying.length) Transport.forceUnloadAll(state, u, 'машина вибула');
      if (!u.surrendered) Loot.dropAll(state, u);
      if (u.embarked != null) { const v = Engine.unitById(state, u.embarked); if (v) v.carrying = v.carrying.filter(id => id !== u.id); u.embarked = null; }
      let fate = u.surrendered ? 'Капітулював' : u.destroyed ? 'Техніку знищено' : 'Знищено';
      if (!u.surrendered && p.wounded > 0) {
        // поранені без боєздатних товаришів
        const adj = Engine.adjacentEnemies(state, u);
        if (adj.length) {
          p.captured += p.wounded;
          state.prisoners.push({ holder: adj[0].faction, origin: u.faction, count: p.wounded, unit: u.name, day: state.time.day, hour: state.time.hour });
          Engine.log(state, `${u.name}: ${p.wounded} поранених залишилися без допомоги й потрапили в полон до «${Engine.fname(adj[0].faction)}».`, 'warn', u.faction, [u.faction, adj[0].faction]);
          p.wounded = 0;
        } else {
          p.missing += p.wounded;
          Engine.log(state, `${u.name}: ${p.wounded} поранених залишилися без допомоги — зниклі безвісти (евакуація — етап 3).`, 'warn', u.faction);
          p.wounded = 0;
        }
      }
      state.lost.push({ id: u.id, name: u.name, type: u.type, faction: u.faction, fate, day: state.time.day, hour: state.time.hour, personnel: Object.assign({}, p), idx: u.idx });
      Engine.log(state, `${u.name} (${Engine.fname(u.faction)}) вибуває з кампанії: ${fate.toLowerCase()}.`, 'warn', u.faction, null);
    }
    state.units = keep;
  }

  // ------------------------------------------------------------ перевірки
  function resolveTarget(state, u, target, opts = {}) {
    // target: { unitId } — пряма атака; { hex } — навісний вогонь
    const grid = g(state);
    if (target.unitId != null) {
      const t = Engine.unitById(state, target.unitId);
      if (!t || t.faction === u.faction) return { error: 'Ціль не знайдено.' };
      if (typeof Politics !== 'undefined' && state.diplomacy && Politics.allied(state, u.faction, t.faction)) return { error: 'Це підрозділ союзника. Щоб атакувати його, спершу треба розірвати союз.' };
      // Засідка: ціль уже підтверджено видимою (дальність зброї + лінія вогню) в момент спрацювання,
      // ще до звичного (повільнішого) побіжного виявлення — звичну перевірку видимості пропускаємо.
      if (!opts.forceVisible && !Intel.isVisible(state, u.faction, t.id)) {
        const m = Intel.ensure(state)[u.faction][t.id];
        if (m && (hasIndirect(u) || opts.suppress)) return { hex: m.idx, marker: m };
        return { error: 'Ціль зараз не спостерігається. Прямий вогонь можливий лише по виявленому противнику; міномети та вогонь на придушення можуть бити по застарілих позначках.' };
      }
      return { unit: t, hex: t.idx };
    }
    if (target.hex != null) {
      const allied = f => typeof Politics !== 'undefined' && state.diplomacy && Politics.allied(state, u.faction, f);
      const here = Engine.unitsAt(state, target.hex);
      const vis = here.filter(e => e.faction !== u.faction && !allied(e.faction) && Intel.isVisible(state, u.faction, e.id));
      const marks = Intel.markerAt(state, u.faction, target.hex);
      if (!vis.length && !marks.length) {
        if (!hasIndirect(u) && !opts.suppress) return { error: 'У цьому гексі немає відомого противника. Вогонь по площі можливий лише навісною зброєю (міномет, АГС) або вогнем на придушення.' };
        if (target.hex === u.idx) return { error: 'Не можна вести вогонь по власному гексу.' };
        if (here.some(e => e.faction === u.faction)) return { error: 'У цьому гексі ваші підрозділи — вогонь по площі заборонено.' };
        if (here.some(e => allied(e.faction) && Intel.isVisible(state, u.faction, e.id))) return { error: 'У цьому гексі підрозділи союзника — вогонь по площі заборонено.' };
        return { hex: target.hex, unit: null, marker: null, area: true };
      }
      return { hex: target.hex, unit: vis[0] || null, marker: marks[0] || null };
    }
    return { error: 'Не вказано ціль.' };
  }

  function previewAttack(state, unitId, target, intensity = 'normal', opts = {}) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u, opts);
    if (err) return { ok: false, reason: err };
    const cfg = C();
    if (opts.suppress) intensity = 'suppress'; // вогонь на придушення завжди йде на цій (слаболетальній) інтенсивності
    if (u.attackedTurn === state.time.turn) return { ok: false, reason: 'Підрозділ уже вів бій цієї години.' };
    const indirect = hasIndirect(u);
    if (indirect && !Object.keys(u.weapons).some(m => CONFIG.weapons[m] && CONFIG.weapons[m].indirect && ready(u, m))) return { ok: false, reason: `Зброю навісного вогню треба спершу розгорнути (наказ «Розгорнути», ${CONFIG.deployShare * 100}% години).` };
    if (!indirect && u.mp < Engine.mpMax(u) * cfg.attackMinMp - 1e-9) return { ok: false, reason: `Для атаки потрібно щонайменше ${cfg.attackMinMp * 100}% часу години (залишилось ${Engine.fmt(u.mp)} з ${Engine.mpMax(u)} ОР).` };
    const tr = resolveTarget(state, u, target, opts);
    if (tr.error) return { ok: false, reason: tr.error };
    const grid = g(state);
    const dist = grid.dist(u.idx, tr.hex);
    const meters = dist * CONFIG.hexMeters;
    if (!indirect && !tr.unit && !opts.suppress) return { ok: false, reason: 'Прямий вогонь по невиявленому противнику можливий лише вогнем на придушення.' };
    let los = { ok: true };
    if (!indirect && dist > 1) {
      los = Intel.lineOfSight(state, u.idx, tr.hex, Engine.terrainKey(state, u.idx) === 'mountains');
      if (!los.ok) return { ok: false, reason: `Немає лінії видимості: її перекриває гекс ${grid.label(los.blocker)} (${CONFIG.terrain[state.map.terrain[los.blocker]].name}).` };
    }
    const tArmor = tr.unit ? armorOf(tr.unit) : 'soft';
    const list = weaponsInRange(u, dist, indirect, { state, targetArmor: tArmor });
    if (!list.length) {
      const undeployed = weaponsInRange(u, dist, indirect, { state, targetArmor: tArmor, ignoreDeploy: true });
      if (undeployed.length) return { ok: false, reason: `Зброя (${undeployed.map(x => x.model).join(', ')}) не розгорнута. Наказ «Розгорнути» займає ${CONFIG.deployShare * 100}% години.` };
      return { ok: false, reason: `Ціль поза дальністю зброї: до неї ${meters} м, найбільша дальність ${maxRange(u, indirect, state)} м.` };
    }
    const fire = groupFire(state, u, dist, intensity, { indirect, targetArmor: tArmor });
    const totalUse = Object.values(fire.use).reduce((a, b) => a + b, 0);
    if (totalUse <= 0) return { ok: false, reason: 'Немає боєприпасів для зброї, що дістає до цілі.' };
    let freshness = 1;
    const areaObserved = tr.area ? Intel.hexObserved(state, u.faction, tr.hex) : false;
    if (tr.area) freshness = areaObserved ? cfg.areaFire.observed : cfg.areaFire.blind;
    else if (!tr.unit || (indirect && !Intel.isVisible(state, u.faction, tr.unit.id))) {
      // немає підтвердженої живої цілі — стріляємо по позначці (своїй чи навісній зброї) або
      // (вогонь на придушення) просто по ймовірній позиції: точність спадає з «віком» даних.
      const age = tr.marker ? state.time.turn - tr.marker.turn : 0;
      freshness = Math.max(0.25, 1 - cfg.indirectFreshnessPerHour * age);
    }
    let zeroing = null;
    if (indirect) { zeroing = zeroingInfo(state, u, tr.hex); freshness *= zeroing.mult; }
    const notes = [];
    if (tr.area) { const base = areaObserved ? cfg.areaFire.observed : cfg.areaFire.blind; notes.push(areaObserved
      ? `Вогонь по площі: противника в гексі не виявлено, але гекс під спостереженням — коригування вогню, базова точність ${Math.round(base * 100)}%. Результат буде видно.`
      : `Вогонь по площі наосліп: гекс поза спостереженням, базова точність ${Math.round(base * 100)}%. Чи є там противник і який результат — ви не дізнаєтесь.`); }
    else if (indirect) notes.push(freshness < zeroing.mult ? `Навісний вогонь по застарілих даних: базова точність ${Math.round((freshness / zeroing.mult) * 100)}%.` : 'Навісний вогонь по виявленій цілі.');
    else if (!tr.unit) notes.push(`Вогонь на придушення по ${tr.marker ? 'застарілій позначці противника' : 'ймовірній позиції'}: точність ${Math.round(freshness * 100)}% — чи є там противник, ви можете й не дізнатись.`);
    if (zeroing) notes.push(
      zeroing.n === 1 ? `Пристрілка: перший виклик поспіль по цій цілі — точність ×${zeroing.mult}.` :
      zeroing.n === 2 ? 'Пристрілка: другий виклик поспіль по тій самій цілі — вогонь на ураження (звичайна точність).' :
      `Пристрілка завершена: третій і наступні виклики поспіль по тій самій цілі — точність ×${zeroing.mult}.`
    );
    if (!indirect && u.stance === 'defend' && u.fort > 0) notes.push(`Вогонь з обладнаних позицій (рівень ${u.fort}) — позиції зберігаються.`);
    else if (!indirect) notes.push('Атака з маневром: укриття атакуючого діє наполовину.');
    const short = fire.used.filter(x => x.noAmmo).map(x => x.model);
    if (short.length) notes.push(`Немає боєприпасів для: ${short.join(', ')}.`);
    // лише ВІДОМІ фракції цілі (вогонь наосліп не розкриває, хто в гексі)
    const victims = tr.unit ? [tr.unit.faction] : [...new Set(Intel.knownList(state, u.faction).filter(m => m.idx === tr.hex).map(m => m.faction))];
    const breaks = [];
    for (const vf of victims) for (const ag of Politics.attackCheck(state, u.faction, vf, tr.hex)) breaks.push({ victim: vf, type: ag.type });
    if (breaks.length) notes.unshift(`УВАГА: атака порушить угоди (${breaks.map(b => Politics.TYPES[b.type].name.toLowerCase() + ' з «' + CONFIG.factions[b.victim].short + '»').join(', ')}): репутація −${CONFIG.diplomacy.breakReputation}, підтримка −${CONFIG.diplomacy.breakSupport}.`);
    const sid = state.map.settlement[tr.hex];
    if (sid >= 0) notes.push(`Ціль у населеному пункті ${state.map.settlements[sid].name}: можливі цивільні втрати й падіння підтримки${indirect ? ' (міни — утричі небезпечніші)' : ''}.`);
    return {
      ok: true, unitId, target, hex: tr.hex, targetUnit: tr.unit ? tr.unit.id : null, marker: tr.marker || null, area: !!tr.area, areaObserved, zeroing, prepared: !!opts.ambushPosition,
      dist, meters, indirect, intensity, freshness, weapons: list.map(x => ({ model: x.model, n: x.n, range: Math.round(x.range) })),
      ammo: fire.use, ammoText: ammoText(fire.use), notes, breaks
    };
  }

  // -------------------------------------------------------------- атака
  function attack(state, unitId, target, intensity = 'normal', opts = {}) {
    const pv = previewAttack(state, unitId, target, intensity, opts);
    if (!pv.ok) return pv;
    const att = Engine.unitById(state, unitId).faction;
    const byVictim = {};
    for (const b of pv.breaks || []) (byVictim[b.victim] = byVictim[b.victim] || []).push(b.type);
    for (const [vf, types] of Object.entries(byVictim)) {
      const list = Politics.attackCheck(state, att, Number(vf), pv.hex).filter(a => types.includes(a.type));
      Politics.breakAgreements(state, att, Number(vf), list);
    }
    if (pv.indirect) return indirectFire(state, pv);
    return pv.targetUnit != null ? directAttack(state, pv) : suppressAreaFire(state, pv);
  }

  function directAttack(state, pv) {
    const cfg = C();
    const grid = g(state);
    const turn = state.time.turn;
    const a = Engine.unitById(state, pv.unitId);
    const d = Engine.unitById(state, pv.targetUnit);
    const af = a.faction, df = d.faction;
    const dIdx0 = d.idx;
    const R = { kind: 'direct', time: Engine.timeLabel(state.time), attacker: a.name, defender: d.name, af, df, steps: [], visibleTo: [af, df] };
    const step = (title, lines) => R.steps.push({ title, lines });

    // 1. Виявлення
    // prepared — вогонь із підготовленої засідки (наказ «Засідка»), сильніший за випадковий
    const prepared = !!pv.prepared;
    const ambush = prepared || !Intel.isVisible(state, df, a.id);
    const dIntel = Intel.ensure(state)[af][d.id];
    step('1. Виявлення цілі', [
      `${a.name} (${Engine.fname(af)}) атакує ${dIntel ? dIntel.label : 'противника'} — ${d.name} (${Engine.fname(df)}).`,
      prepared ? `Підготовлена засідка: ${a.name} чекав у засідці й відкрив вогонь першим.` : ambush ? `Засідка: ${d.name} не виявив атакуючого заздалегідь.` : `${d.name} знав про присутність атакуючого.`
    ]);
    // 2. Дальність і видимість
    step('2. Дальність і лінія видимості', [
      `Відстань ${pv.dist} гекс. (${pv.meters} м), лінія видимості ${pv.dist === 1 ? 'є (близький контакт)' : 'відкрита'}.`,
      `Зброя в межах дальності: ${pv.weapons.map(w => `${w.model} ×${w.n} (${w.range} м)`).join(', ')}.`
    ]);
    // 3. Місцевість і чисельність
    const firingFromPositions = prepared || (a.stance === 'defend' && a.fort > 0);
    const aCover = coverOf(state, a, { advancing: !firingFromPositions });
    const dCover = coverOf(state, d, {});
    step('3. Місцевість, укриття, чисельність', [
      `${d.name}: ${CONFIG.terrain[state.map.terrain[d.idx]].name}${d.fort ? `, обладнані позиції рівня ${d.fort}` : ''} — укриття ${Math.round(dCover * 100)}%. Боєздатних: ${d.personnel.fit}.`,
      `${a.name}: ${CONFIG.terrain[state.map.terrain[a.idx]].name}${firingFromPositions ? `, вогонь з позицій рівня ${a.fort}` : ', атака з маневром (укриття наполовину)'} — укриття ${Math.round(aCover * 100)}%. Боєздатних: ${a.personnel.fit}.`
    ]);

    // 4–5. Вогонь і втрати
    const aArmor = armorOf(a.embarked != null ? (Engine.unitById(state, a.embarked) || a) : a), dArmor = armorOf(d);
    const dCanReply = (Engine.canAct(d) && weaponsInRange(d, pv.dist, false, { state, targetArmor: aArmor }).length > 0) || Transport.passengers(state, d).some(p => p.personnel.fit > 0 && weaponsInRange(p, pv.dist, false, { state, targetArmor: aArmor }).length > 0);
    const dIntensity = 'normal';
    const order = ambush ? 'attacker' : (d.stance === 'defend' && d.fort > 0 ? 'defender' : 'simultaneous');
    const fireLines = [];
    const extraLines = [];
    const aHit = a.embarked != null ? (Engine.unitById(state, a.embarked) || a) : a;
    const aHitCover = aHit === a ? aCover : coverOf(state, aHit, {});
    let resA = null, resD = null, fireA = null, fireD = null;
    const rollA = combatRoll(state, a.id, d.id, turn);
    const rollD = combatRoll(state, d.id, a.id, turn);
    const fireDesc = (u, f) => `${u.name} (${f.intensity.toLowerCase()} вогонь, кидок ×${F(f.roll)}): ${f.used.filter(x => x.eff > 0 || x.at > 0).map(x => `${x.model} ×${x.n} → ${F(x.eff)}${x.at > 0 && isVehicle(d) ? ` / ПТ ${F(x.at)}` : ''}`).join('; ') || 'без ефекту'}. Сумарна ефективність ${F(f.soft)}${f.at > 0 ? `, протитанкова ${F(f.at)}` : ''}. Витрачено: ${ammoText(f.use)}.`;
    if (order === 'simultaneous') {
      fireA = groupFire(state, a, pv.dist, pv.intensity, { targetArmor: dArmor, roll: rollA });
      fireD = dCanReply ? groupFire(state, d, pv.dist, dIntensity, { targetArmor: aArmor, roll: rollD }) : null;
      fireLines.push('Перший вогонь: обидві сторони відкривають вогонь одночасно.');
      resD = hitUnit(state, d, fireA, dCover, extraLines);
      if (fireD) resA = hitUnit(state, aHit, fireD, aHitCover, extraLines);
    } else if (order === 'attacker') {
      const mA = prepared ? cfg.ambushPositionAttacker : cfg.ambushAttacker, mD = prepared ? cfg.ambushPositionDefender : cfg.ambushDefender;
      fireA = groupFire(state, a, pv.dist, pv.intensity, { mult: mA, targetArmor: dArmor, roll: rollA });
      fireLines.push(`Перший вогонь за атакуючим (${prepared ? 'підготовлена засідка' : 'засідка'}, вогонь ×${mA}).`);
      resD = hitUnit(state, d, fireA, dCover, extraLines);
      if (dCanReply && d.personnel.fit > 0) {
        fireD = groupFire(state, d, pv.dist, dIntensity, { mult: mD, targetArmor: aArmor, roll: rollD });
        fireLines.push(`${d.name} відповідає із запізненням (×${mD}).`);
        resA = hitUnit(state, aHit, fireD, aHitCover, extraLines);
      }
    } else {
      fireD = dCanReply ? groupFire(state, d, pv.dist, dIntensity, { targetArmor: aArmor, roll: rollD }) : null;
      fireLines.push(`Перший вогонь за обороною: ${d.name} з підготовлених позицій відкриває вогонь першим.`);
      if (fireD) resA = hitUnit(state, aHit, fireD, aHitCover, extraLines);
      if (a.personnel.fit > 0) {
        fireA = groupFire(state, a, pv.dist, pv.intensity, { targetArmor: dArmor, roll: rollA });
        resD = hitUnit(state, d, fireA, dCover, extraLines);
      }
    }
    if (fireA) { spendGroup(fireA); fireLines.push(fireDesc(a, fireA)); }
    if (fireD) { spendGroup(fireD); fireLines.push(fireDesc(d, fireD)); }
    else if (!dCanReply) fireLines.push(`${d.name} не може відповісти: ${Engine.canAct(d) ? 'немає зброї, що дістає до атакуючого' : 'підрозділ розсіяний'}.`);
    step('4. Вогнева ефективність', fireLines);

    const lossLine = (u, r) => r ? `${u.name}: уражено ${r.cas} (загинули ${r.killed}, поранені ${r.wounded}); придушення +${F(r.supp)} → ${Math.round(u.suppression)}${r.cond ? `; техніка −${r.cond}% (стан ${u.vehicle.condition}%)` : ''}${r.destroyed ? ' — МАШИНУ ЗНИЩЕНО' : ''}. Боєздатних: ${u.personnel.fit}.` : `${u.name}: без втрат.`;
    if (resD) Politics.recordCasualties(state, af, df, resD);
    if (resA) Politics.recordCasualties(state, df, af, resA);
    const civ = [];
    if (fireA) { const c = Politics.onCombat(state, d.idx, af, fireA.soft, false); if (c) civ.push(`Цивільні в ${c.settlement}: загинули ${c.killed}, поранені ${c.wounded} (вогонь «${CONFIG.factions[af].short}», підтримка −${Engine.fmt(c.drop)}).`); }
    if (fireD) { const c = Politics.onCombat(state, a.idx, df, fireD.soft, false); if (c) civ.push(`Цивільні в ${c.settlement}: загинули ${c.killed}, поранені ${c.wounded} (вогонь «${CONFIG.factions[df].short}», підтримка −${Engine.fmt(c.drop)}).`); }
    step('5. Втрати, витрата боєприпасів, придушення', [lossLine(d, resD), lossLine(aHit, resA)].concat(extraLines, civ));

    // 6. Мораль
    const empty = u => ({ cas: 0, killed: 0, wounded: 0, supp: 0, fitBefore: u.personnel.fit, cond: 0 });
    resA = resA || empty(a); resD = resD || empty(d);
    a.lastLoss = resA.cas; d.lastLoss = resD.cas;
    const aWin = resD.cas + resD.cond / 20 > resA.cas + resA.cond / 20;
    const dWin = resA.cas + resA.cond / 20 > resD.cas + resD.cond / 20;
    const mD = moraleAfter(state, d, resD, { ambushed: ambush, win: dWin && !ambush });
    const mA = moraleAfter(state, a, resA, { win: aWin });
    const mLines = [
      `${d.name}: мораль ${mD.before} → ${mD.after} (${moraleBand(mD.after)}): ${mD.text}.`,
      `${a.name}: мораль ${mA.before} → ${mA.after} (${moraleBand(mA.after)}): ${mA.text}.`
    ];
    // знищення техніки
    for (const [u, r] of [[d, resD], [a, resA]]) {
      if (r.destroyed) {
        u.destroyed = true;
        mLines.push(`${u.name}: машину знищено — підрозділ вибуває.`);
        u.personnel.missing += 0;
      }
    }
    const outD = d.destroyed ? 'destroyed' : moraleOutcome(state, d, a, mLines);
    const outA = a.destroyed ? 'destroyed' : moraleOutcome(state, a, d, mLines);
    if (outD === 'held' && outA === 'held') mLines.push('Обидві сторони утримують позиції, бій триває.');
    step('6. Мораль і результат', mLines);

    // Службові позначки
    a.mp = 0; a.attackedTurn = turn; a.firedTurn = turn; a.combatTurn = turn; a.order = null;
    if (a.embarked != null) { const v = Engine.unitById(state, a.embarked); if (v) { v.mp = 0; v.order = null; v.combatTurn = turn; v.firedTurn = turn; } }
    for (const p of Transport.passengers(state, a)) { p.attackedTurn = turn; p.firedTurn = turn; p.combatTurn = turn; p.mp = 0; }
    if (!firingFromPositions && a.stance === 'observe') a.stance = 'none';
    d.combatTurn = turn; if (fireD) d.firedTurn = turn;
    gainXp(state, a, aWin ? 2 : 1); gainXp(state, d, dWin ? 2 : 1);
    heroCheck(state, a, resD); heroCheck(state, d, resA);
    R.result = { attacker: outA, defender: outD, lossA: resA.cas, lossD: resD.cas };

    // Журнал (видно обом учасникам)
    Engine.log(state, `БІЙ: ${a.name} атакує ${d.name} (${pv.meters} м). Втрати: ${a.name} −${resA.cas}, ${d.name} −${resD.cas}. Мораль: ${mA.after} / ${mD.after}.`, 'combat', af, [af, df], { at: dIdx0, uid: [a.id, d.id] });
    for (const s of R.steps) for (const l of s.lines) Engine.log(state, '· ' + l, 'combatd', af, [af, df]);
    state.lastCombat = R;
    cleanup(state);
    Intel.update(state);
    // тривога для того, кого атакували
    const seenA = Intel.ensure(state)[df][a.id];
    Engine.log(state, `ПІД ВОГНЕМ: ${d.name} у ${grid.label(dIdx0)} — ${ambush ? 'засідка, ' : ''}атакував ${seenA ? seenA.label : 'невиявлений противник'}. Втрати −${resD.cas}${resD.destroyed ? ', машину знищено' : ''}, мораль ${mD.after}${OUTCOME[outD] ? ' — ' + OUTCOME[outD] : ''}.`, 'alert', df, [df], { at: d.idx >= 0 ? d.idx : dIdx0, uid: d.id });
    Engine.snapshot(state, a);
    return { ok: true, report: R };
  }

  const OUTCOME = { retreated: 'відступив', dispersed: 'розсіявся', surrendered: 'капітулював', eliminated: 'знищений', destroyed: 'знищений', surrounded: 'в оточенні' };

  function indirectFire(state, pv) {
    const cfg = C();
    const grid = g(state);
    const turn = state.time.turn;
    const a = Engine.unitById(state, pv.unitId);
    const af = a.faction;
    const targets = Engine.unitsAt(state, pv.hex).filter(e => e.faction !== af && e.embarked == null);
    const observed = Intel.hexObserved(state, af, pv.hex);
    const R = { kind: 'indirect', time: Engine.timeLabel(state.time), attacker: a.name, defender: grid.label(pv.hex), af, df: targets.length ? targets[0].faction : null, steps: [] };
    const step = (title, lines) => R.steps.push({ title, lines });
    step('1. Виявлення цілі', [
      pv.area ? `Вогонь по площі — гекс ${grid.label(pv.hex)} без виявленого противника, підсумкова точність ${Math.round(pv.freshness * 100)}% (${pv.areaObserved ? 'з коригуванням спостерігачів' : 'наосліп, без коригування'}; пристрілка ×${pv.zeroing.mult}).` :
      pv.freshness < 1 ? `Вогонь по застарілій позначці (${pv.marker ? `${state.time.turn - pv.marker.turn} год тому` : ''}), точність ${Math.round(pv.freshness * 100)}%.` : 'Вогонь по цілі, що спостерігається зараз.',
      observed ? 'Гекс цілі під спостереженням — результат буде видно.' : 'Гекс цілі поза спостереженням — результат не буде відомий.'
    ]);
    step('2. Дальність і лінія видимості', [`Відстань ${pv.dist} гекс. (${pv.meters} м). Навісний вогонь — пряма видимість не потрібна.`]);
    const rollA = combatRoll(state, a.id, pv.hex, turn);
    const fire = groupFire(state, a, pv.dist, pv.intensity, { indirect: true, mult: pv.freshness, roll: rollA });
    spendGroup(fire);
    const fLines = [`${a.name} (${fire.intensity.toLowerCase()} вогонь, кидок ×${F(fire.roll)}): ефективність ${F(fire.soft)}. Витрачено: ${ammoText(fire.use)}.`];
    const resLines = [], mLines = [];
    const hitFactions = new Set();
    if (!targets.length) {
      fLines.push('У гексі цілі нікого не виявилося — боєприпаси витрачено даремно.');
    } else {
      // Щільність: уся маса вогню падає на гекс; частка кожного — за його чисельністю (техніка важить як 4 особи)
      const dn = cfg.indirectDensity;
      const weight = t => Math.max(1, t.personnel.fit + Transport.load(state, t)) + (isVehicle(t) ? 4 : 0);
      const people = targets.reduce((a, t) => a + Math.max(0, t.personnel.fit) + Transport.load(state, t), 0);
      const dens = Math.min(dn.max, Math.max(dn.min, Math.sqrt(people / dn.base)));
      const wsum = targets.reduce((a, t) => a + weight(t), 0);
      step('3. Місцевість, укриття, чисельність', [`У гексі ≈${people} осіб — щільність ×${F(dens)}.`].concat(targets.map(t => `${t.name}: ${CONFIG.terrain[state.map.terrain[t.idx]].name}${t.fort ? `, позиції рівня ${t.fort}` : ''} — укриття від мін ${Math.round(coverOf(state, t, { indirect: true }) * 100)}%.`)));
      for (const t of targets) {
        const share = dens * weight(t) / wsum;
        const part = { soft: fire.soft * share, at: fire.at * share, sup: fire.sup * Math.min(1, share * targets.length) };
        const extra = [];
        const r = hitUnit(state, t, part, coverOf(state, t, { indirect: true }), extra);
        t.lastLoss = r.cas; t.combatTurn = turn;
        Politics.recordCasualties(state, af, t.faction, r);
        resLines.push(`${t.name}: уражено ${r.cas} (загинули ${r.killed}, поранені ${r.wounded}); придушення +${F(r.supp)}${r.cond ? `; техніка −${r.cond}%` : ''}${r.destroyed ? ' — МАШИНУ ЗНИЩЕНО' : ''}.`, ...extra);
        const m = moraleAfter(state, t, r, { ambushed: false });
        mLines.push(`${t.name}: мораль ${m.before} → ${m.after}: ${m.text}.`);
        let out = 'destroyed';
        if (r.destroyed) t.destroyed = true;
        else out = moraleOutcome(state, t, a, mLines);
        Engine.log(state, `ОБСТРІЛЯНО: ${t.name} у ${grid.label(pv.hex)} — ${isVehicle(t) ? 'техніка' : 'міни/гранати'}, уражено ${r.cas}${r.cond ? `, техніка −${r.cond}%` : ''}${r.destroyed ? ', МАШИНУ ЗНИЩЕНО' : ''}, мораль ${t.morale}${OUTCOME[out] ? ' — ' + OUTCOME[out] : ''}.`, 'alert', t.faction, [t.faction], { at: t.idx >= 0 ? t.idx : pv.hex, uid: t.id });
        if (r.cas > 0 || r.cond > 0) hitFactions.add(t.faction);
      }
    }
    // Неочікувані жертви вогню по площі: удар по стороні, з якою діє угода, — порушення угоди
    for (const vf of hitFactions) {
      if ((pv.breaks || []).some(b => b.victim === vf)) continue;
      if (Politics.allied(state, af, vf)) {
        Engine.log(state, `Дружній вогонь: обстріл ${grid.label(pv.hex)} зачепив підрозділи союзника «${CONFIG.factions[vf].short}».`, 'combat', af, [af, vf]);
        continue;
      }
      const list = Politics.attackCheck(state, af, vf, pv.hex);
      if (list.length) Politics.breakAgreements(state, af, vf, list);
    }
    // Контрбатарейне виявлення: кілька влучань поспіль з тієї самої позиції — постраждалі
    // чують виліт і рахують час підльоту, виходить приблизна позиція дальняка.
    if (pv.zeroing.n >= CONFIG.combat.counterBattery.hitsForDetect && hitFactions.size) {
      for (const vf of hitFactions) {
        Intel.counterBatteryReport(state, vf, a, pv.hex);
        const m = Intel.ensure(state)[vf][a.id];
        if (m && m.turn === turn && m.sound) Engine.log(state, `ЗВУКОВА РОЗВІДКА: ймовірна позиція навісної зброї («${CONFIG.factions[af].short}») поблизу ${grid.label(m.idx)} — напрямок точний, дистанція приблизна.`, 'alert', vf, [vf], { at: m.idx });
      }
    }
    const civ = Politics.onCombat(state, pv.hex, af, fire.soft, true);
    if (civ) resLines.push(`Цивільні в ${civ.settlement}: загинули ${civ.killed}, поранені ${civ.wounded}; підтримка «${CONFIG.factions[af].short}» −${Engine.fmt(civ.drop)}.`);
    step('4. Вогнева ефективність', fLines);
    step('5. Втрати', resLines.length ? resLines : ['Втрат не завдано.']);
    if (mLines.length) step('6. Мораль і результат', mLines);
    a.mp = 0; a.attackedTurn = turn; a.firedTurn = turn; a.order = null;
    a.zeroing = { hex: pv.hex, idx: a.idx, n: pv.zeroing.n, turn };
    gainXp(state, a, 1);

    // Що дізнається атакуючий
    if (observed) {
      R.visibleTo = [af].concat(targets.map(t => t.faction));
      Engine.log(state, `ОБСТРІЛ: ${a.name} б’є по ${pv.area ? 'площі ' : ''}${grid.label(pv.hex)}. ${targets.length ? 'Спостерігачі бачать ураження противника.' : 'Противника в гексі немає.'}`, 'combat', af, [af], { at: pv.hex, uid: a.id });
      for (const s of R.steps) for (const l of s.lines) Engine.log(state, '· ' + l, 'combatd', af, [af]);
    } else {
      // без спостереження атакуючий бачить лише власну частину звіту
      R.steps = R.steps.filter(s => /^(1|2|4)\./.test(s.title)).map(s => s.title.startsWith('4.') ? { title: s.title, lines: [s.lines[0]] } : s);
      R.steps.push({ title: '5–6. Результат', lines: ['Результат не спостерігався: гекс цілі поза полем зору ваших підрозділів.'] });
      R.visibleTo = [af];
      Engine.log(state, `ОБСТРІЛ: ${a.name} б’є по ${pv.area ? 'площі ' : ''}${grid.label(pv.hex)}; витрачено ${ammoText(fire.use)}. Результат не спостерігався.`, 'combat', af, [af], { at: pv.hex, uid: a.id });
    }
    state.lastCombat = R;
    cleanup(state);
    Intel.update(state);
    return { ok: true, report: R };
  }

  // Вогонь на придушення зброєю ПРЯМОГО вогню по гексу без підтвердженого живого
  // противника — застаріла позначка або просто «ймовірна» позиція. На відміну від
  // directAttack тут немає конкретного підрозділу-опонента (і отже, немає зустрічного
  // вогню — по порожньому/невідомому гексу відповісти нічим), тож обробка ближча до
  // indirectFire: розподіл вогню по всіх реальних підрозділах, що фактично опинились
  // у гексі (якщо там узагалі хтось є).
  function suppressAreaFire(state, pv) {
    const cfg = C();
    const grid = g(state);
    const turn = state.time.turn;
    const a = Engine.unitById(state, pv.unitId);
    const af = a.faction;
    const targets = Engine.unitsAt(state, pv.hex).filter(e => e.faction !== af && e.embarked == null);
    const observed = Intel.hexObserved(state, af, pv.hex);
    const R = { kind: 'suppress', time: Engine.timeLabel(state.time), attacker: a.name, defender: grid.label(pv.hex), af, df: targets.length ? targets[0].faction : null, steps: [] };
    const step = (title, lines) => R.steps.push({ title, lines });
    step('1. Виявлення цілі', [
      pv.area
        ? `Вогонь на придушення по площі — гекс ${grid.label(pv.hex)} без виявленого противника, базова точність ${Math.round(pv.freshness * 100)}% (${pv.areaObserved ? 'з коригуванням спостерігачів' : 'наосліп, без коригування'}).`
        : `Вогонь на придушення по ${pv.marker ? `застарілій позначці (${state.time.turn - pv.marker.turn} год тому)` : 'ймовірній позиції'}, точність ${Math.round(pv.freshness * 100)}%.`,
      observed ? 'Гекс цілі під спостереженням — результат буде видно.' : 'Гекс цілі поза спостереженням — результат не буде відомий.'
    ]);
    const los = pv.dist > 1 ? Intel.lineOfSight(state, a.idx, pv.hex, Engine.terrainKey(state, a.idx) === 'mountains') : { ok: true };
    step('2. Дальність і лінія видимості', [`Відстань ${pv.dist} гекс. (${pv.meters} м). Прямий вогонь по площі — лінія видимості ${los.ok ? 'є' : 'немає'}.`]);
    const rollA = combatRoll(state, a.id, pv.hex, turn);
    const fire = groupFire(state, a, pv.dist, pv.intensity, { indirect: false, mult: pv.freshness, roll: rollA });
    spendGroup(fire);
    const fLines = [`${a.name} (${fire.intensity.toLowerCase()}, кидок ×${F(fire.roll)}): ефективність ${F(fire.soft)}. Витрачено: ${ammoText(fire.use)}.`];
    const resLines = [], mLines = [];
    const hitFactions = new Set();
    if (!targets.length) {
      fLines.push('У гексі цілі нікого не виявилося — боєприпаси витрачено даремно.');
    } else {
      const dn = cfg.indirectDensity;
      const weight = t => Math.max(1, t.personnel.fit + Transport.load(state, t)) + (isVehicle(t) ? 4 : 0);
      const people = targets.reduce((acc, t) => acc + Math.max(0, t.personnel.fit) + Transport.load(state, t), 0);
      const dens = Math.min(dn.max, Math.max(dn.min, Math.sqrt(people / dn.base)));
      const wsum = targets.reduce((acc, t) => acc + weight(t), 0);
      step('3. Місцевість, укриття, чисельність', [`У гексі ≈${people} осіб — щільність ×${F(dens)}.`].concat(targets.map(t => `${t.name}: ${CONFIG.terrain[state.map.terrain[t.idx]].name}${t.fort ? `, позиції рівня ${t.fort}` : ''} — укриття ${Math.round(coverOf(state, t, {}) * 100)}%.`)));
      for (const t of targets) {
        const share = dens * weight(t) / wsum;
        const part = { soft: fire.soft * share, at: fire.at * share, sup: fire.sup * Math.min(1, share * targets.length) };
        const extra = [];
        const r = hitUnit(state, t, part, coverOf(state, t, {}), extra);
        t.lastLoss = r.cas; t.combatTurn = turn;
        Politics.recordCasualties(state, af, t.faction, r);
        resLines.push(`${t.name}: уражено ${r.cas} (загинули ${r.killed}, поранені ${r.wounded}); придушення +${F(r.supp)}${r.cond ? `; техніка −${r.cond}%` : ''}${r.destroyed ? ' — МАШИНУ ЗНИЩЕНО' : ''}.`, ...extra);
        const m = moraleAfter(state, t, r, { ambushed: false });
        mLines.push(`${t.name}: мораль ${m.before} → ${m.after}: ${m.text}.`);
        let out = 'destroyed';
        if (r.destroyed) t.destroyed = true;
        else out = moraleOutcome(state, t, a, mLines);
        Engine.log(state, `ПІД ПРИДУШЕННЯМ: ${t.name} у ${grid.label(pv.hex)} — вогонь на придушення, уражено ${r.cas}${r.cond ? `, техніка −${r.cond}%` : ''}${r.destroyed ? ', МАШИНУ ЗНИЩЕНО' : ''}, мораль ${t.morale}${OUTCOME[out] ? ' — ' + OUTCOME[out] : ''}.`, 'alert', t.faction, [t.faction], { at: t.idx >= 0 ? t.idx : pv.hex, uid: t.id });
        if (r.cas > 0 || r.cond > 0) hitFactions.add(t.faction);
      }
    }
    for (const vf of hitFactions) {
      if ((pv.breaks || []).some(b => b.victim === vf)) continue;
      if (Politics.allied(state, af, vf)) { Engine.log(state, `Дружній вогонь: вогонь на придушення по ${grid.label(pv.hex)} зачепив підрозділи союзника «${CONFIG.factions[vf].short}».`, 'combat', af, [af, vf]); continue; }
      const list = Politics.attackCheck(state, af, vf, pv.hex);
      if (list.length) Politics.breakAgreements(state, af, vf, list);
    }
    const civ = Politics.onCombat(state, pv.hex, af, fire.soft, true);
    if (civ) resLines.push(`Цивільні в ${civ.settlement}: загинули ${civ.killed}, поранені ${civ.wounded}; підтримка «${CONFIG.factions[af].short}» −${Engine.fmt(civ.drop)}.`);
    step('4. Вогнева ефективність', fLines);
    step('5. Втрати', resLines.length ? resLines : ['Втрат не завдано.']);
    if (mLines.length) step('6. Мораль і результат', mLines);
    a.mp = 0; a.attackedTurn = turn; a.firedTurn = turn; a.order = null;
    gainXp(state, a, 1);
    if (observed) {
      R.visibleTo = [af].concat(targets.map(t => t.faction));
      Engine.log(state, `ПРИДУШЕННЯ: ${a.name} б’є на придушення по ${grid.label(pv.hex)}. ${targets.length ? 'Спостерігачі бачать ураження противника.' : 'Противника в гексі немає.'}`, 'combat', af, [af], { at: pv.hex, uid: a.id });
      for (const s of R.steps) for (const l of s.lines) Engine.log(state, '· ' + l, 'combatd', af, [af]);
    } else {
      R.steps = R.steps.filter(s => /^(1|2|4)\./.test(s.title)).map(s => s.title.startsWith('4.') ? { title: s.title, lines: [s.lines[0]] } : s);
      R.steps.push({ title: '5–6. Результат', lines: ['Результат не спостерігався: гекс цілі поза полем зору ваших підрозділів.'] });
      R.visibleTo = [af];
      Engine.log(state, `ПРИДУШЕННЯ: ${a.name} б’є на придушення по ${grid.label(pv.hex)}; витрачено ${ammoText(fire.use)}. Результат не спостерігався.`, 'combat', af, [af], { at: pv.hex, uid: a.id });
    }
    state.lastCombat = R;
    cleanup(state);
    Intel.update(state);
    return { ok: true, report: R };
  }

  // Зона ураження: де підрозділ може вести вогонь просто зараз.
  // direct — гекси в дальності готової зброї (своєї й пасажирів) із лінією видимості;
  // indirect — гекси в дальності навісної зброї (видимість не потрібна).
  function fireZone(state, u) {
    const grid = g(state);
    const out = { indirect: hasIndirect(u), hexes: new Set(), noLos: new Set(), rangeM: 0, deployRangeM: 0, rangeHex: 0 };
    const members = [u].concat(u.carrying && u.carrying.length ? Transport.passengers(state, u) : []);
    let ready_ = 0, all = 0;
    for (const m of members) {
      if (m.personnel.fit <= 0) continue;
      for (const [model, n] of Object.entries(m.weapons)) {
        const w = CONFIG.weapons[model];
        if (!w || n <= 0 || !!w.indirect !== out.indirect || w.atOnly) continue;
        const r = rangeOf(m, w, state);
        all = Math.max(all, r);
        if (ready(m, model)) ready_ = Math.max(ready_, r);
      }
    }
    out.rangeM = ready_; out.deployRangeM = all;
    out.rangeHex = Math.floor(ready_ / CONFIG.hexMeters);
    out.deployRangeHex = Math.floor(all / CONFIG.hexMeters);
    if (!out.rangeHex) return out;
    const mtn = Engine.terrainKey(state, u.idx) === 'mountains';
    for (const i of grid.within(u.idx, out.rangeHex)) {
      if (i === u.idx) continue;
      if (Engine.terrainKey(state, i) === 'sea') continue;
      if (out.indirect || grid.dist(u.idx, i) <= 1 || Intel.lineOfSight(state, u.idx, i, mtn).ok) out.hexes.add(i);
      else out.noLos.add(i);
    }
    return out;
  }

  return { fireZone, ready, needsDeploy, rangeOf, moraleAfter, previewAttack, attack, computeFire, groupFire, inflict, applyDamage, coverOf, weaponsInRange, maxRange, hasIndirect, cleanup, armorOf, findRetreatHex, surrender, heroCheck };
})();
