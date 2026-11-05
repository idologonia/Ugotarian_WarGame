// ============================================================================
// МОДУЛЬ: НАСЕЛЕННЯ, ПОЛІТИКА, ДИПЛОМАТІЯ, ПОДІЇ, ЦІЛІ ПЕРЕМОГИ (етап 4)
// Населення пунктів поділене на етнічні групи; кожна група має власну
// підтримку трьох фракцій. Підтримка впливає на доходи, мобілізацію,
// розвідку (інформатори), саботаж, протести й місцеві ополчення.
// ============================================================================
const Politics = (() => {
  const P = () => CONFIG.population;
  const DP = () => CONFIG.diplomacy;
  const GROUPS = ['yug', 'rus', 'cauc'];
  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const r1 = x => Math.round(x * 10) / 10;
  const fname = f => CONFIG.factions[f].name;

  // ---------------------------------------------------- ініціалізація
  function initSettlement(s, i) {
    const def = P().settlements[i] || { pop: s.kind === 'city' ? 20000 : 1000, mix: { yug: 0.8, rus: 0.15, cauc: 0.05 } };
    s.pop = {}; s.support = {};
    for (const gr of GROUPS) { s.pop[gr] = Math.round(def.pop * (def.mix[gr] || 0)); s.support[gr] = P().baseSupport[gr].slice(); }
    s.pop0 = Object.assign({}, s.pop);
    s.civKilled = 0; s.civWounded = 0; s.refugees = 0;
    s.civBy = [0, 0, 0];
    s.damage = { housing: 0, hospital: 0, water: 0, transport: 0, industry: 0 };
    s.unrest = 'none'; s.admin = s.control; s.combatTurn = 0; s.sabAcc = 0; s.civAcc = 0;
  }

  function init(state) {
    state.map.settlements.forEach((s, i) => { if (!s.pop) initSettlement(s, i); });
    if (!state.diplomacy) {
      state.diplomacy = { rel: {}, proposals: [], reputation: [50, 50, 50], nextId: 1, history: [] };
      for (const k of ['0-1', '0-2', '1-2']) state.diplomacy.rel[k] = { status: 'war', agreements: [] };
    }
    if (!state.stats) state.stats = { inflicted: [0, 0, 0], captured: [0, 0, 0] };
    // Рішення автора (запит гравця): жива статистика втрат по фракціях — хто кому скільки
    // завдав убитих/ранених, не лише загальний підсумок для перемоги (inflicted/captured).
    // Безпечно для старих збережень: і newGame, і завантаження викликають init() до будь-якого
    // читання цих полів, тож вони завжди будуть присутні до першого звернення.
    if (!state.stats.killedOf) state.stats.killedOf = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];   // killedOf[хто завдав][чия фракція втратила]
    if (!state.stats.woundedOf) state.stats.woundedOf = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    if (!state.stats.recovered) state.stats.recovered = [0, 0, 0];  // забрано своїх загиблих із поля (Loot.recoverDead)
    if (!state.events) state.events = Scenario.events();
    if (!state.campaign) state.campaign = { endDay: CONFIG.campaign.days, over: false, winner: null, reason: '', objectives: Scenario.objectives(), scores: [0, 0, 0], chronicle: null, ctl0: state.map.settlements.map(s => s.control) };
  }

  function totalPop(s) { return GROUPS.reduce((a, g) => a + (s.pop ? s.pop[g] : 0), 0); }
  function support(s, f) {
    if (!s.pop) return 0;
    const tot = totalPop(s) || 1;
    return GROUPS.reduce((a, g) => a + s.pop[g] * s.support[g][f], 0) / tot;
  }
  function groupSupport(state, f, group) {
    let w = 0, t = 0;
    for (const s of state.map.settlements) if (s.pop) { w += s.pop[group] * s.support[group][f]; t += s.pop[group]; }
    return t ? w / t : 0;
  }
  function nationalSupport(state, f) {
    let w = 0, t = 0;
    for (const s of state.map.settlements) if (s.pop) { const p = totalPop(s); w += p * support(s, f); t += p; }
    return t ? w / t : 0;
  }
  // why/state — для історії змін підтримки в картці пункту (зміни однієї години з тієї ж причини зливаються)
  function adjustSupport(s, f, delta, group, why, state) {
    for (const g of group ? [group] : GROUPS) s.support[g][f] = clamp(r1(s.support[g][f] + delta));
    if (!why || !state || !delta) return;
    if (!s.supLog) s.supLog = [];
    const t = state.time.turn;
    const last = s.supLog.find(e => e.turn === t && e.f === f && e.why === why && (e.group || null) === (group || null));
    if (last) last.d = r1(last.d + delta);
    else s.supLog.push({ turn: t, day: state.time.day, hour: state.time.hour, f, d: r1(delta), why, group: group || null });
    if (s.supLog.length > 40) s.supLog.splice(0, s.supLog.length - 40);
  }

  function incomeMult(state, s) {
    if (!s.pop || s.control < 0) return 1;
    if (s.unrest === 'strike') return 0;
    return P().incomeBase + P().incomePerSupport * support(s, s.control) / 100;
  }
  function manpowerMult(state, s) { return s.pop && s.control >= 0 ? clamp(support(s, s.control) / 50, 0, 2) : 1; }

  // ---------------------------------------- цивільні в зоні бою
  function onCombat(state, idx, shooter, fireSoft, indirect) {
    if (typeof Civil !== 'undefined') Civil.onFire(state, idx, shooter, fireSoft, indirect);
    const m = state.map;
    const sid = m.settlement[idx];
    if (sid == null || sid < 0) return null;
    const s = m.settlements[sid];
    if (!s.pop) return null;
    const key = CONFIG.terrain[m.terrain[idx]].key;
    let k = P().civK[key === 'city' ? 'city' : key === 'industrial' ? 'industrial' : 'village'];
    if (indirect) k *= P().indirectCivMult;
    if (corridorAt(state, sid)) k *= 0.3;   // гуманітарний коридор: частину людей вивели
    s.civAcc = (s.civAcc || 0) + fireSoft * k;
    const n = Math.floor(s.civAcc + 1e-9);
    s.civAcc -= n;
    const killed = Math.round(n * P().civKilledShare), wounded = n - killed;
    s.civKilled += killed; s.civWounded += wounded;
    s.civBy[shooter] += n;
    removePeople(s, killed);
    const dmg = fireSoft * P().damagePerFire * (indirect ? 2 : 1) / (s.kind === 'city' ? 6 : 2);
    s.damage.housing = clamp(r1(s.damage.housing + dmg));
    if (key === 'industrial') s.damage.industry = clamp(r1(s.damage.industry + dmg * 1.5));
    s.damage.water = clamp(r1(s.damage.water + dmg * 0.4));
    s.damage.transport = clamp(r1(s.damage.transport + dmg * 0.3));
    s.combatTurn = state.time.turn;
    let drop = 0;
    if (n > 0) {
      drop = n * P().supportPerCiv / Math.sqrt(Math.max(100, totalPop(s)));
      adjustSupport(s, shooter, -drop, null, indirect ? 'обстріл: загинули/поранені цивільні' : 'бій у пункті: постраждали цивільні', state);
      // Рішення автора: хто й коли тут востаннє зачепив цивільних — читає Politics.propaganda(),
      // щоб «ворог убиває цивільних» підсилювало ефект пропаганди іншої сторони найближчим часом.
      s.lastCivBy = { f: shooter, turn: state.time.turn, killed, wounded };
    }
    if (n > 0) {
      const ctl = s.control;
      Engine.log(state, `ПІДТРИМКА: ${s.name} — ${indirect ? 'обстріл' : 'бій'} «${CONFIG.factions[shooter].short}» убив ${killed} і поранив ${wounded} цивільних; підтримка «${CONFIG.factions[shooter].short}» −${Engine.fmt(r1(drop))} (тепер ${Math.round(support(s, shooter))}%).`, 'alert', shooter, [shooter], { at: idx });
      if (ctl >= 0 && ctl !== shooter) Engine.log(state, `${s.name}: цивільні постраждали від ${indirect ? 'обстрілу' : 'бою'} (загинули ${killed}, поранені ${wounded}; вогонь «${CONFIG.factions[shooter].short}»).`, 'alert', ctl, [ctl], { at: idx });
    }
    return n ? { settlement: s.name, killed, wounded, drop: r1(drop) } : null;
  }
  function removePeople(s, n) {
    const tot = totalPop(s);
    if (tot <= 0 || n <= 0) return;
    for (const g of GROUPS) s.pop[g] = Math.max(0, s.pop[g] - Math.round(n * s.pop[g] / tot));
  }

  // Рішення автора (запит гравця: «окремо десь давай статистику по знищеним ворогам, вбитим,
  // пораненим») — тепер окрім загального inflicted (для перемоги) ведеться розбивка хто кому:
  // killedOf[завдав][втратив] / woundedOf[завдав][втратив]. victim може бути null (невідомо
  // чий) — тоді лише загальний підсумок оновлюється, без розбивки.
  function recordCasualties(state, by, victim, r) {
    const n = typeof r === 'number' ? r : (r && r.cas) || 0;
    if (by == null || by < 0) return;
    state.stats.inflicted[by] += n;
    if (victim == null || victim < 0 || typeof r !== 'object' || !r) return;
    state.stats.killedOf[by][victim] += r.killed || 0;
    state.stats.woundedOf[by][victim] += r.wounded || 0;
  }
  function recordCaptured(state, by, n) { if (by != null && by >= 0) state.stats.captured[by] += n; }

  // ---------------------------------------- захоплення пункту
  function onCapture(state, s, from, to) {
    if (!s.pop || to < 0) return;
    const share = P().captureRefugees;
    const n = Math.round(totalPop(s) * share);
    removePeople(s, n); s.refugees += n;
    s.admin = to;
    let loss = 0;
    if (from >= 0) {
      const eco = Logistics.ensureEconomy(state)[from];
      loss = Math.round(Math.max(0, eco.money) * P().captureMoneyLoss * (s.kind === 'city' ? 1 : 0.2));
      eco.money -= loss;
    }
    Engine.log(state, `${s.name}: адміністрацію призначає ${fname(to)}. ${n} мешканців стали біженцями${from >= 0 ? `; ${fname(from)} евакуює установи, втрачено ${loss} грн` : ''}.`, 'event', to, null, { at: s.center });
    if (from >= 0 && from !== to) Engine.log(state, `ВТРАЧЕНО: ${s.name} перейшло під контроль «${CONFIG.factions[to].short}».`, 'alert', from, [from], { at: s.center });
  }

  // ---------------------------------------- кінець години: населення
  function hourPopulation(state) {
    const turn = state.time.turn;
    for (const s of state.map.settlements) {
      if (!s.pop) continue;
      const c = s.control;
      const fighting = s.combatTurn === turn;
      // біженці
      let out = 0;
      if (fighting) out += totalPop(s) * P().refugeesCombat;
      if (s.damage.housing > 50) out += totalPop(s) * P().refugeesDamage;
      out = Math.round(out);
      if (out > 0) { removePeople(s, out); s.refugees += out; if (typeof Civil !== 'undefined') Civil.spawn(state, s, out, false); }
      // повернення до базових настроїв
      for (const g of GROUPS) for (let f = 0; f < 3; f++) {
        const base = P().baseSupport[g][f];
        s.support[g][f] = clamp(r1(s.support[g][f] + (base - s.support[g][f]) * P().driftToBase));
      }
      if (c >= 0) {
        // порядок або злидні
        const hardship = (s.damage.water + s.damage.housing + s.damage.hospital) / 300;
        if (!fighting && s.unrest === 'none') adjustSupport(s, c, P().orderGain, null, 'порядок і спокій', state);
        if (hardship > 0.15) adjustSupport(s, c, -P().hardshipSupport * hardship * 3, null, 'нестатки через руйнування', state);
        // відновлення
        if (!fighting) for (const k of Object.keys(s.damage)) s.damage[k] = clamp(r1(s.damage[k] - P().repairPerHour));
        // протести, страйки
        const sup = support(s, c);
        const prev = s.unrest;
        s.unrest = sup < P().strikeBelow ? 'strike' : sup < P().protestBelow ? 'protest' : 'none';
        if (s.unrest !== prev && s.unrest !== 'none') Engine.log(state, `${s.name}: ${s.unrest === 'strike' ? 'страйк — доходи й підприємства пункту зупинено' : 'протести проти адміністрації'} (підтримка ${fname(c)} ${Math.round(sup)}%).`, 'event', c, null);
        if (s.unrest === 'none' && prev !== 'none') Engine.log(state, `${s.name}: протести вщухли.`, 'event', c, null);
        // саботаж на користь іншої фракції
        let best = -1, bs = 0;
        for (let f = 0; f < 3; f++) if (f !== c) { const v = support(s, f); if (v > bs) { bs = v; best = f; } }
        const underResistance = sup < P().sabotageOwnBelow && bs >= P().sabotageOtherAbove;
        // Запит гравця: «партизанський опір» — та сама умова, що й стихійний саботаж вище, але
        // тепер веде окремий накопичувач s.resistance (0..100): довше пункт лишається під
        // «небажаним» контролем — вищий опір. Опір прискорює саботаж і, за порогом spawnAt,
        // виливається у партизанський підрозділ на користь найпідтримуванішої іншої фракції
        // (без участі гравця, автоматично — не ополчення raiseMilitia).
        const R = P().resistance;
        s.resistance = clamp((s.resistance || 0) + (underResistance ? R.rate : -R.decay), 0, 100);
        if (s.partisanCooldown > 0) s.partisanCooldown--;
        if (underResistance) {
          s.sabAcc += P().sabotagePerHour * (1 + s.resistance / 100 * R.sabotageBoost);
          if (s.sabAcc >= 1) { s.sabAcc -= 1; sabotage(state, s, c, best); }
          if (s.resistance >= R.spawnAt && !(s.partisanCooldown > 0)) {
            spawnPartisans(state, s, c, best);
            s.resistance = Math.max(0, s.resistance - R.spawnCost);
            s.partisanCooldown = R.spawnCooldownHours;
          }
        } else s.sabAcc = Math.max(0, s.sabAcc - 0.05);
      }
    }
  }

  // Партизанський відділ з’являється сам (населений пункт, не гравець) на користь фракції
  // best, у гексі пункту (чи поруч, якщо там уже свої противника) — та сама модель підрозділу,
  // що й Scenario.createUnit/raiseMilitia, але без грошей/дій гравця й з «нерегулярним»
  // («партизанським») досвідом і мораллю.
  function spawnPartisans(state, s, controller, best) {
    const grid = Engine.grid(state);
    const spot = [s.center].concat(grid.within(s.center, 2)).find(i => !state.units.some(u => u.idx === i && u.faction === controller && u.personnel.fit > 0)) || s.center;
    const R = P().resistance;
    const n = 1 + state.units.concat(state.lost || []).filter(u => u.faction === best && /^Партизани/.test(u.name)).length;
    const u = Scenario.createUnit(state, R.unitType, best, spot, n);
    u.name = `Партизани №${n} ${['СВ', 'ДП', 'НП'][best]} (${s.name})`;
    u.experience = 0; u.xp = 0; u.morale = 65; u.baseMorale = 65;
    u.mp = 0; u.movedThisPhase = true;
    state.units.push(u);
    Engine.log(state, `${s.name}: місцевий опір проти ${fname(controller)} виливається у партизанський відділ на користь «${fname(best)}» — ${u.name}.`, 'event', best, [best, controller]);
    Intel.update(state);
  }

  function sabotage(state, s, victim, helper) {
    const targets = Logistics.facilities(state).filter(f => f.owner === victim && !f.destroyed && state.map.settlement[f.idx] === s.id);
    if (targets.length) {
      const f = targets[(state.time.turn + s.id) % targets.length];
      if (Logistics.isStore(f)) {
        for (const k of Object.keys(f.stock.goods)) f.stock.goods[k] = Math.floor(f.stock.goods[k] * 0.8);
        for (const k of Object.keys(f.stock.ammo)) f.stock.ammo[k] = Math.floor(f.stock.ammo[k] * 0.9);
      } else { f.condition = Math.max(0, f.condition - 20); f.offline = Math.max(f.offline, 2); }
      Engine.log(state, `${s.name}: саботаж на «${f.name}» — місцеві прихильники «${fname(helper)}» завдали шкоди.`, 'warn', victim, [victim, helper]);
    } else {
      s.damage.transport = clamp(s.damage.transport + 10);
      Engine.log(state, `${s.name}: саботаж на транспорті (прихильники «${fname(helper)}»).`, 'warn', victim, [victim, helper]);
    }
  }

  // ---------------------------------------- дії фракції в пункті
  function aidReason(state, f, s) {
    if (!s || !s.pop) return 'Населений пункт не знайдено.';
    const eco = Logistics.ensureEconomy(state)[f];
    if (eco.money < P().aid.money) return `Потрібно ${P().aid.money} грн (є ${Math.round(eco.money)}).`;
    if (s.aidTurn === state.time.turn) return 'Допомогу вже надано цієї години.';
    if (s.control !== f && !corridorAt(state, s.id)) return 'Допомогу можна надати у своєму пункті або через гуманітарний коридор.';
    return null;
  }
  function aid(state, f, sid) {
    const s = state.map.settlements[sid];
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = aidReason(state, f, s);
    if (why) return { ok: false, reason: why };
    Logistics.ensureEconomy(state)[f].money -= P().aid.money;
    adjustSupport(s, f, P().aid.support, null, 'гуманітарна допомога', state);
    s.damage.water = clamp(s.damage.water - 5); s.damage.hospital = clamp(s.damage.hospital - 5);
    s.aidTurn = state.time.turn;
    Engine.log(state, `${fname(f)}: гуманітарний конвой у ${s.name} (−${P().aid.money} грн), підтримка +${P().aid.support}.`, 'event', f, null);
    return { ok: true };
  }
  // Національне ополчення з конкретної етнічної групи пункту
  function militiaReason(state, f, s, group) {
    if (!s || !s.pop) return 'Населений пункт не знайдено.';
    if (s.control !== f) return 'Потрібно контролювати пункт.';
    const M = P().militia;
    if (!group) return null;
    if (!GROUPS.includes(group)) return 'Невідома група.';
    if (s.pop[group] < M.minGroupPop) return `У пункті замало людей цієї групи (${s.pop[group]}, потрібно ${M.minGroupPop}).`;
    const sup = s.support[group][f];
    if (sup < M.supportAbove) return `Потрібна підтримка групи ≥${M.supportAbove}% (зараз ${Math.round(sup)}%).`;
    const eco = Logistics.ensureEconomy(state)[f];
    if (eco.money < M.money) return `Потрібно ${M.money} грн.`;
    if (Engine.unitsAt(state, s.center).some(u => u.faction !== f)) return 'У центрі пункту противник.';
    const last = (s.militiaTurns || {})[group];
    if (last && state.time.turn - last < 24) return 'Ополчення з цієї групи в пункті можна збирати раз на добу.';
    return null;
  }
  const GROUP_ADJ = { yug: 'юготарське', rus: 'російське', cauc: 'кавказьке' };
  function raiseMilitia(state, f, sid, group) {
    const s = state.map.settlements[sid];
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    group = group || GROUPS.slice().sort((a, b) => s.support[b][f] - s.support[a][f])[0];
    const why = militiaReason(state, f, s, group);
    if (why) return { ok: false, reason: why };
    const M = P().militia;
    Logistics.ensureEconomy(state)[f].money -= M.money;
    const n = 1 + state.units.concat(state.lost || []).filter(u => u.faction === f && /^Ополч/.test(u.name)).length;
    const u = Scenario.createUnit(state, 'inf_squad', f, s.center, n);
    u.name = `Ополч. №${n} ${['СВ', 'ДП', 'НП'][f]} (${{ yug: 'юг.', rus: 'рос.', cauc: 'кавк.' }[group]})`;
    u.personnel.assigned = M.size; u.personnel.fit = M.size;
    u.weapons = { 'АКМ': M.size - 1, 'РПК': 1 }; u.ammo = { '762s': 200 * M.size };
    u.atdQuota = 0;
    u.morale = 65; u.baseMorale = 65; u.experience = 0; u.xp = 0;
    u.ethnic = group; u.home = sid;
    u.mp = 0; u.movedThisPhase = true;
    state.units.push(u);
    s.pop[group] = Math.max(0, s.pop[group] - M.size);
    // напруга між групами: інші трохи насторожено ставляться до озброєння сусідів
    for (const g of GROUPS) if (g !== group) adjustSupport(s, f, -M.tension, g, 'напруга через ополчення', state);
    s.militiaTurns = Object.assign({}, s.militiaTurns || {}, { [group]: state.time.turn });
    Engine.log(state, `${s.name}: сформовано ${GROUP_ADJ[group]} ополчення ${u.name} (${M.size} осіб). Інші групи пункту насторожені (підтримка −${M.tension}).`, 'event', f);
    Intel.update(state);
    return { ok: true, unitId: u.id };
  }
  // ---------------------------------------- пропаганда
  // Рішення автора (запит гравця): «особливо якщо село обстрілюють вороги, можна ввести
  // пропаганду, що от противник убиває цивілів — за рахунок цього росте підтримка оборони».
  // Якщо хтось ІНШИЙ нещодавно (outrageWindowHours) зачепив цивільних саме тут (s.lastCivBy,
  // записується в onCombat), ефект підсилюється, і звинувачена фракція додатково втрачає
  // трохи підтримки в тому самому пункті — класична контрпропаганда на реальному приводі.
  function propagandaOutrage(state, f, s) {
    const lc = s.lastCivBy;
    if (lc && lc.f !== f && state.time.turn - lc.turn <= P().propaganda.outrageWindowHours) return lc;
    return null;
  }
  function propagandaReason(state, f, s) {
    if (!s || !s.pop) return 'Населений пункт не знайдено.';
    const PR = P().propaganda;
    const eco = Logistics.ensureEconomy(state)[f];
    if (eco.money < PR.money) return `Потрібно ${PR.money} грн (є ${Math.round(eco.money)}).`;
    if (s.control !== f && !corridorAt(state, s.id)) return 'Потрібен контроль пункту або гуманітарний коридор, щоб донести повідомлення.';
    const last = (s.propTurns || {})[f];
    if (last != null && state.time.turn - last < PR.cooldownHours) return `Пропаганду в цьому пункті можна проводити раз на ${PR.cooldownHours} год (ще ${PR.cooldownHours - (state.time.turn - last)} год).`;
    return null;
  }
  function propaganda(state, f, sid) {
    const s = state.map.settlements[sid];
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = propagandaReason(state, f, s);
    if (why) return { ok: false, reason: why };
    const PR = P().propaganda;
    Logistics.ensureEconomy(state)[f].money -= PR.money;
    const out = propagandaOutrage(state, f, s);
    const gain = r1(PR.support * (out ? PR.outrageMult : 1));
    adjustSupport(s, f, gain, null, out ? 'пропаганда (звинувачення ворога в обстрілах)' : 'пропаганда', state);
    let enemyLoss = 0;
    if (out) {
      enemyLoss = r1(gain * PR.outrageEnemyLoss);
      adjustSupport(s, out.f, -enemyLoss, null, 'пропаганда проти: звинувачення в обстрілах', state);
    }
    s.propTurns = Object.assign({}, s.propTurns || {}, { [f]: state.time.turn });
    Engine.log(state, `${s.name}: пропагандистська кампанія «${fname(f)}» (−${PR.money} грн) — підтримка +${gain}${out ? ` (підсилено: «${CONFIG.factions[out.f].short}» нещодавно обстріляв цивільних тут, їхня підтримка там −${enemyLoss})` : ''}.`, 'event', f);
    return { ok: true, gain, outrage: !!out };
  }
  // Ополчення стійкіше біля дому
  function homeFactor(state, u) {
    if (!u.ethnic || u.home == null) return 1;
    const s = state.map.settlements[u.home];
    const d = Engine.grid(state).dist(u.idx, s.center);
    const M = P().militia;
    return d <= M.homeRadius ? M.homeMoraleMult : d >= M.farRadius ? M.farMoraleMult : 1;
  }

  // ---------------------------------------------------- ДИПЛОМАТІЯ
  const TYPES = {
    ceasefire: { name: 'Перемир’я', desc: 'Заборона атак між сторонами' },
    exchange: { name: 'Обмін полоненими', desc: 'Повернення полонених в резерв сторін' },
    corridor: { name: 'Гуманітарний коридор', desc: 'Без атак у населеному пункті, евакуація цивільних' },
    alliance: { name: 'Союз', desc: 'Без атак, спільна розвідка й постачання, спільні операції' },
    intel: { name: 'Обмін розвідданими', desc: 'Сторони бачать те, що бачить партнер' },
    supply: { name: 'Спільне постачання', desc: 'Поповнення на складах партнера' },
    territory: { name: 'Передача території', desc: 'Населений пункт переходить іншій стороні' },
    political: { name: 'Політична угода', desc: 'Спільна заява: підтримка населення, репутація' }
  };
  function key(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }
  function rel(state, a, b) { return state.diplomacy.rel[key(a, b)]; }
  function active(state, a, b, type) {
    if (a === b) return null;
    const r = rel(state, a, b);
    return r ? r.agreements.find(x => x.type === type && (x.until == null || x.until > state.time.turn)) || null : null;
  }
  function allied(state, a, b) { return a === b || !!active(state, a, b, 'alliance'); }
  function sharesIntel(state, a, b) { return a !== b && (allied(state, a, b) || !!active(state, a, b, 'intel')); }
  function sharesSupply(state, a, b) { return a !== b && (allied(state, a, b) || !!active(state, a, b, 'supply')); }
  function corridorAt(state, sid) {
    if (!state.diplomacy) return false;
    for (const r of Object.values(state.diplomacy.rel)) if (r.agreements.some(x => x.type === 'corridor' && x.terms.settlement === sid && x.until > state.time.turn)) return true;
    return false;
  }
  function statusText(state, a, b) {
    if (allied(state, a, b)) return 'Союз';
    if (active(state, a, b, 'ceasefire')) return 'Перемир’я';
    return 'Війна';
  }

  // Що порушить атака фракції a по фракції b у гексі idx
  function attackCheck(state, a, b, idx) {
    if (!state.diplomacy || a === b) return [];
    const out = [];
    for (const t of ['alliance', 'ceasefire']) { const x = active(state, a, b, t); if (x) out.push(x); }
    const sid = state.map.settlement[idx];
    if (sid >= 0) {
      const x = active(state, a, b, 'corridor');
      if (x && x.terms.settlement === sid) out.push(x);
    }
    return out;
  }
  function breakAgreements(state, breaker, victim, list) {
    if (!list.length) return;
    const r = rel(state, breaker, victim);
    r.agreements = r.agreements.filter(x => !list.includes(x) && !['ceasefire', 'alliance', 'intel', 'supply'].includes(x.type));
    state.diplomacy.reputation[breaker] = clamp(state.diplomacy.reputation[breaker] - DP().breakReputation);
    for (const s of state.map.settlements) if (s.pop) adjustSupport(s, breaker, -DP().breakSupport, null, 'порушення угоди', state);
    const names = list.map(x => TYPES[x.type].name.toLowerCase()).join(', ');
    state.diplomacy.history.push({ day: state.time.day, hour: state.time.hour, text: `${fname(breaker)} порушує угоди з «${fname(victim)}»: ${names}.` });
    Engine.log(state, `ПОРУШЕННЯ УГОД: ${fname(breaker)} атакує «${fname(victim)}» попри ${names}. Репутація −${DP().breakReputation}, підтримка населення −${DP().breakSupport}. Між сторонами знову війна.`, 'event', breaker, null);
  }

  function proposeReason(state, from, to, type, terms) {
    if (from === to) return 'Оберіть іншу фракцію.';
    if (!TYPES[type]) return 'Невідомий тип угоди.';
    if (Engine.phaseFaction(state) !== from) return 'Пропозиції надсилаються у фазі своєї фракції.';
    if (state.diplomacy.proposals.some(p => p.status === 'open' && p.from === from && p.to === to && p.type === type)) return 'Така пропозиція вже очікує відповіді.';
    if (['ceasefire', 'alliance', 'intel', 'supply'].includes(type) && active(state, from, to, type)) return 'Така угода вже діє.';
    if (type === 'alliance' && !active(state, from, to, 'ceasefire')) return 'Союз можливий лише після перемир’я.';
    if (type === 'corridor') { const s = state.map.settlements[terms.settlement]; if (!s) return 'Оберіть населений пункт.'; }
    if (type === 'territory') {
      const s = state.map.settlements[terms.settlement];
      if (!s) return 'Оберіть населений пункт.';
      if (s.control !== terms.giver) return `${s.name} зараз не контролює сторона, що має його передати.`;
      if (terms.giver !== from && terms.giver !== to) return 'Передати можна лише свій або партнерів пункт.';
    }
    if (type === 'exchange') {
      const held = (h, o) => state.prisoners.filter(p => p.holder === h && p.origin === o).reduce((a, p) => a + p.count, 0);
      if (!held(from, to) && !held(to, from)) return 'Немає полонених для обміну.';
    }
    return null;
  }
  function propose(state, from, to, type, terms = {}) {
    const why = proposeReason(state, from, to, type, terms);
    if (why) return { ok: false, reason: why };
    const p = { id: state.diplomacy.nextId++, from, to, type, terms, created: state.time.turn, day: state.time.day, hour: state.time.hour, status: 'open' };
    state.diplomacy.proposals.push(p);
    Engine.log(state, `Дипломатія: ${fname(from)} пропонує «${fname(to)}» — ${describe(state, p)}. Відповідь — у фазі отримувача.`, 'event', from, [from, to]);
    return { ok: true, id: p.id };
  }
  function describe(state, p) {
    const T = TYPES[p.type];
    const s = p.terms.settlement != null ? state.map.settlements[p.terms.settlement] : null;
    switch (p.type) {
      case 'ceasefire': return `${T.name} на ${DP().ceasefireHours} год`;
      case 'corridor': return `${T.name} у ${s ? s.name : '?'} на ${DP().corridorHours} год`;
      case 'intel': return `${T.name} на ${DP().intelHours} год`;
      case 'supply': return `${T.name} на ${DP().supplyHours} год`;
      case 'territory': return `${T.name}: ${s ? s.name : '?'} від «${fname(p.terms.giver)}» до «${fname(p.terms.giver === p.from ? p.to : p.from)}»`;
      default: return T.name;
    }
  }
  function respond(state, id, accept) {
    const p = state.diplomacy.proposals.find(x => x.id === id);
    if (!p || p.status !== 'open') return { ok: false, reason: 'Пропозицію не знайдено.' };
    if (Engine.phaseFaction(state) !== p.to) return { ok: false, reason: 'Відповідь — у фазі фракції-отримувача.' };
    if (!accept) {
      p.status = 'rejected';
      Engine.log(state, `Дипломатія: ${fname(p.to)} відхиляє пропозицію «${fname(p.from)}» (${describe(state, p)}).`, 'event', p.to, [p.from, p.to]);
      return { ok: true };
    }
    const err = proposeCheckOnAccept(state, p);
    if (err) { p.status = 'failed'; return { ok: false, reason: err }; }
    p.status = 'accepted';
    apply(state, p);
    return { ok: true };
  }
  function proposeCheckOnAccept(state, p) {
    if (p.type === 'territory') { const s = state.map.settlements[p.terms.settlement]; if (s.control !== p.terms.giver) return 'Умови змінилися: пункт уже не контролює сторона-передавач.'; }
    if (p.type === 'alliance' && !active(state, p.from, p.to, 'ceasefire')) return 'Перемир’я вже не діє.';
    return null;
  }
  function apply(state, p) {
    const r = rel(state, p.from, p.to);
    const t = state.time.turn;
    const add = (hours, terms) => r.agreements.push({ type: p.type, from: p.from, to: p.to, terms: terms || p.terms, since: t, until: hours == null ? null : t + hours });
    let extra = '';
    switch (p.type) {
      case 'ceasefire': add(DP().ceasefireHours); break;
      case 'corridor': add(DP().corridorHours); { const s = state.map.settlements[p.terms.settlement]; adjustSupport(s, p.from, 3, null, 'гуманітарний коридор', state); adjustSupport(s, p.to, 3, null, 'гуманітарний коридор', state); } break;
      case 'intel': add(DP().intelHours); break;
      case 'supply': add(DP().supplyHours); break;
      case 'alliance': add(null); break;
      case 'political': add(null); for (const s of state.map.settlements) if (s.pop) { adjustSupport(s, p.from, 3, null, 'політична угода', state); adjustSupport(s, p.to, 3, null, 'політична угода', state); }
        state.diplomacy.reputation[p.from] = clamp(state.diplomacy.reputation[p.from] + 5); state.diplomacy.reputation[p.to] = clamp(state.diplomacy.reputation[p.to] + 5); break;
      case 'exchange': {
        let back = [0, 0, 0];
        for (const pr of state.prisoners) {
          if ((pr.holder === p.from && pr.origin === p.to) || (pr.holder === p.to && pr.origin === p.from)) { back[pr.origin] += pr.count; pr.count = 0; }
        }
        state.prisoners = state.prisoners.filter(x => x.count > 0);
        const eco = Logistics.ensureEconomy(state);
        eco[p.from].manpower += back[p.from]; eco[p.to].manpower += back[p.to];
        extra = ` Повернулися: до «${fname(p.from)}» ${back[p.from]}, до «${fname(p.to)}» ${back[p.to]} осіб.`;
        for (const s of state.map.settlements) if (s.pop) { adjustSupport(s, p.from, 1, null, 'угода між сторонами', state); adjustSupport(s, p.to, 1, null, 'угода між сторонами', state); }
        break;
      }
      case 'territory': {
        const s = state.map.settlements[p.terms.settlement];
        const recv = p.terms.giver === p.from ? p.to : p.from;
        for (let i = 0; i < state.map.settlement.length; i++) if (state.map.settlement[i] === s.id) state.map.control[i] = recv;
        const prev = s.control;
        s.control = recv;
        onCapture(state, s, -1, recv);
        extra = ` ${s.name} переходить до «${fname(recv)}» (раніше — «${fname(prev)}»).`;
        break;
      }
    }
    state.diplomacy.history.push({ day: state.time.day, hour: state.time.hour, text: `Угода: ${describe(state, p)} між «${fname(p.from)}» і «${fname(p.to)}».${extra}` });
    Engine.log(state, `Дипломатія: УГОДУ УКЛАДЕНО — ${describe(state, p)} між «${fname(p.from)}» і «${fname(p.to)}».${extra}`, 'event', p.to, null);
  }
  function dissolveAlliance(state, f, other) {
    const r = rel(state, f, other);
    const had = r.agreements.some(x => x.type === 'alliance');
    if (!had) return { ok: false, reason: 'Союзу немає.' };
    r.agreements = r.agreements.filter(x => x.type !== 'alliance');
    Engine.log(state, `Дипломатія: ${fname(f)} розриває союз із «${fname(other)}» (без бойових дій — репутація не страждає).`, 'event', f, null);
    return { ok: true };
  }
  function incoming(state, f) { return state.diplomacy ? state.diplomacy.proposals.filter(p => p.status === 'open' && p.to === f) : []; }

  function hourDiplomacy(state) {
    const t = state.time.turn;
    for (const p of state.diplomacy.proposals) if (p.status === 'open' && t - p.created >= DP().proposalTTL) {
      p.status = 'expired';
      Engine.log(state, `Дипломатія: пропозиція «${fname(p.from)}» (${describe(state, p)}) залишилася без відповіді.`, 'event', p.from, [p.from, p.to]);
    }
    for (const r of Object.values(state.diplomacy.rel)) {
      const ended = r.agreements.filter(x => x.until != null && x.until <= t);
      if (ended.length) {
        r.agreements = r.agreements.filter(x => !ended.includes(x));
        for (const x of ended) Engine.log(state, `Дипломатія: завершилася угода «${TYPES[x.type].name}» між «${fname(x.from)}» і «${fname(x.to)}».`, 'event', x.from, null);
      }
    }
    if (state.time.hour === 23) for (let f = 0; f < 3; f++) state.diplomacy.reputation[f] = clamp(state.diplomacy.reputation[f] + DP().keepReputationPerDay);
  }

  // ---------------------------------------------------- УМОВНІ ПОДІЇ
  function evalTrigger(state, ev) {
    const t = ev.trigger;
    const S = state.map.settlements;
    switch (t.type) {
      case 'time': return state.time.day > t.day || (state.time.day === t.day && state.time.hour >= t.hour);
      case 'control': { const s = S[t.settlement]; return t.faction != null ? s.control === t.faction : s.control !== state.campaign.ctl0[t.settlement]; }
      case 'losses': { const k = state.units.concat(state.lost).filter(u => u.faction === t.faction).reduce((a, u) => a + u.personnel.killed, 0); return k >= t.killed; }
      case 'support': { const s = S[t.settlement]; const f = t.faction === 'controller' ? s.control : t.faction; if (f < 0) return false; const v = support(s, f); return t.below != null ? v < t.below : v > t.above; }
      case 'diplomacy': return !!active(state, t.a, t.b, t.agreement);
      case 'money': return Logistics.ensureEconomy(state)[t.faction].money < t.below;
    }
    return false;
  }
  function applyEffect(state, ev, e) {
    const S = state.map.settlements;
    const who = f => f === 'controller' ? S[e.settlement].control : f;
    switch (e.type) {
      case 'support': { const s = S[e.settlement]; const f = who(e.faction); if (f >= 0) adjustSupport(s, f, e.delta, e.group, 'подія: ' + (ev.title || ev.name || 'сценарна подія'), state); break; }
      case 'supportAll': for (const s of S) if (s.pop) adjustSupport(s, e.faction, e.delta, e.group, 'подія: ' + (ev.title || ev.name || 'сценарна подія'), state); break;
      case 'refugees': { const s = S[e.settlement]; const n = Math.round(totalPop(s) * e.share); removePeople(s, n); s.refugees += n; break; }
      case 'money': { const eco = Logistics.ensureEconomy(state)[who(e.faction)]; if (eco) eco.money += e.delta; break; }
      case 'manpower': { const eco = Logistics.ensureEconomy(state)[e.faction]; eco.manpower += e.delta; break; }
      case 'goods': {
        const f = who(e.faction);
        const dst = Logistics.facilities(state).find(x => x.owner === f && !x.destroyed && (x.type === e.facility || (e.facility === 'store' && Logistics.isStore(x))));
        if (dst) for (const [k, n] of Object.entries(e.goods)) dst.stock.goods[k] = (dst.stock.goods[k] || 0) + n;
        break;
      }
      case 'spawn': {
        const s = S[e.settlement];
        if (s.control !== e.faction) break;
        const u = Scenario.createUnit(state, e.unitType, e.faction, s.center, 90 + state.units.length);
        u.name = e.name || u.name;
        state.units.push(u); Intel.update(state);
        break;
      }
    }
  }
  function hourEvents(state) {
    for (const ev of state.events) {
      if (ev.fired) continue;
      if (!evalTrigger(state, ev)) continue;
      ev.fired = { day: state.time.day, hour: state.time.hour };
      for (const e of ev.effects) applyEffect(state, ev, e);
      Engine.log(state, `ПОДІЯ «${ev.name}»: ${ev.text}`, 'event', null);
    }
  }

  // ---------------------------------------------------- ЦІЛІ ТА ПЕРЕМОГА
  function objectiveScore(state, f, o) {
    const S = state.map.settlements;
    switch (o.type) {
      case 'holdSettlement': return S[o.settlement].control === f ? o.points : 0;
      case 'holdFacility': return Logistics.facilities(state).some(x => x.type === o.facility && x.owner === f && !x.destroyed) ? o.points : 0;
      case 'support': return o.points * Math.min(1, nationalSupport(state, f) / (o.target || 60));
      case 'groupSupport': return o.points * Math.min(1, groupSupport(state, f, o.group) / (o.target || 60));
      case 'enemyLosses': return o.points * Math.min(1, (state.stats.inflicted[f] + state.stats.captured[f]) / (o.target || 60));
      case 'reputation': return o.points * state.diplomacy.reputation[f] / 100;
    }
    return 0;
  }
  function objectiveName(state, o) {
    const S = state.map.settlements;
    switch (o.type) {
      case 'holdSettlement': return `Утримувати ${S[o.settlement].name}`;
      case 'holdFacility': return `Утримувати: ${CONFIG.facilities[o.facility].name}`;
      case 'support': return `Підтримка населення (мета ${o.target || 60}%)`;
      case 'groupSupport': return `Підтримка: ${P().groups[o.group]} (мета ${o.target || 60}%)`;
      case 'enemyLosses': return `Втрати противника (мета ${o.target || 60} осіб)`;
      case 'reputation': return 'Репутація на переговорах';
    }
    return o.type;
  }
  function scores(state) {
    return [0, 1, 2].map(f => {
      const list = state.campaign.objectives[f].map(o => ({ o, name: objectiveName(state, o), got: objectiveScore(state, f, o) }));
      return { total: Math.round(list.reduce((a, x) => a + x.got, 0)), max: list.reduce((a, x) => a + x.o.points, 0), list };
    });
  }

  // Рішення автора (запит гравця: «заберемо довгострокову перемогу по очках, воно поки не
  // треба; перемога — захоплення всіх сіл або здача противника»): перемога тепер лише
  // ВІЙСЬКОВА (супротивники знищені/капітулювали) або ТЕРИТОРІАЛЬНА (усі населені пункти під
  // одним контролем). Стару перемогу «за очками» (і дострокову, і на кінець кампанії за
  // лімітом днів) прибрано — кампанія більше сама не закінчується по дню, лише цими двома
  // умовами. Objectives/scores лишаються — як інформаційна панель прогресу («Цілі»), просто
  // більше не вирішують переможця.
  function checkCampaign(state) {
    const c = state.campaign;
    if (!c || c.over || c.disabled) return;
    const sc = scores(state);
    c.scores = sc.map(x => x.total);
    let winner = null, reason = '';
    // військова: інші фракції без боєздатних підрозділів (знищені або капітулювали)
    for (let f = 0; f < 3; f++) {
      const others = state.units.filter(u => u.faction !== f && !allied(state, f, u.faction) && u.personnel.fit > 0);
      if (!others.length && state.units.some(u => u.faction === f)) { winner = f; reason = 'Військова перемога: збройні сили суперників знищені або капітулювали.'; }
    }
    // територіальна: усі населені пункти під одним контролем
    for (let f = 0; f < 3 && winner == null; f++) {
      const settled = state.map.settlements.filter(s => s.pop);
      if (settled.length && settled.every(s => s.control === f)) { winner = f; reason = `Територіальна перемога: під контролем «${fname(f)}» усі населені пункти карти.`; }
    }
    if (winner != null) {
      c.over = true; c.winner = winner; c.reason = reason;
      c.chronicle = chronicle(state, sc);
      Engine.log(state, `КАМПАНІЮ ЗАВЕРШЕНО. ${fname(winner)} перемагає. ${reason}`, 'event', null);
    }
  }

  function chronicle(state, sc) {
    const all = state.units.concat(state.lost);
    const fac = [0, 1, 2].map(f => {
      const us = all.filter(u => u.faction === f);
      const sum = k => us.reduce((a, u) => a + (u.personnel[k] || 0), 0);
      const eco = Logistics.ensureEconomy(state)[f];
      return {
        name: fname(f), score: sc[f].total, killed: sum('killed'), wounded: sum('wounded') + sum('evacuated'), captured: sum('captured'), missing: sum('missing'),
        deadOfWounds: eco.deadOfWounds, unitsLeft: state.units.filter(u => u.faction === f).length, unitsLost: state.lost.filter(u => u.faction === f).length,
        prisonersHeld: state.prisoners.filter(p => p.holder === f).reduce((a, p) => a + p.count, 0),
        money: Math.round(eco.money), manpower: eco.manpower, support: Math.round(nationalSupport(state, f)), reputation: state.diplomacy.reputation[f],
        facilities: Logistics.facilities(state).filter(x => x.owner === f && !x.destroyed).length
      };
    });
    const towns = state.map.settlements.map(s => ({
      name: s.name, control: s.control, pop: totalPop(s), pop0: GROUPS.reduce((a, g) => a + s.pop0[g], 0), civKilled: s.civKilled, civWounded: s.civWounded,
      refugees: s.refugees, housing: s.damage.housing, support: [0, 1, 2].map(f => Math.round(support(s, f))), unrest: s.unrest
    }));
    return { time: Engine.timeLabel(state.time), factions: fac, towns, history: state.diplomacy.history.slice(), events: state.events.filter(e => e.fired).map(e => ({ name: e.name, when: e.fired })) };
  }

  // ---------------------------------------- ШПИГУНИ / ДИВЕРСІЇ (запит гравця)
  // «Диверсія» — те саме, що стихійний саботаж (sabotage() вище), лише навмисна дія гравця за
  // гроші: засилаємо агентуру у ЧУЖИЙ (не свій, не союзний) населений пункт. Шанс успіху
  // детермінований (hash2 від seed карти, години й пункту — як і бойовий кидок у 07_combat.js),
  // не Math.random(). Соц. влада спирається на штатну розвідку держбезпеки (базовий шанс);
  // демократи й націоналісти — на підпільний досвід повстанців (бонус factionBonus).
  function spyCooldownLeft(state, f) {
    const last = state.spyLast ? state.spyLast[f] : null;
    const need = CONFIG.espionage.cooldownHours[f];
    return last == null ? 0 : Math.max(0, need - (state.time.turn - last));
  }
  function spyChance(f) { return Math.min(95, Math.max(5, CONFIG.espionage.baseChance + (CONFIG.espionage.factionBonus[f] || 0))); }
  function spyReason(state, f, s) {
    if (!s || !s.pop) return 'Населений пункт не знайдено.';
    if (s.control === f) return 'Не можна засилати диверсантів у власний пункт.';
    if (s.control >= 0 && allied(state, f, s.control)) return 'Не можна шпигувати проти союзника.';
    const left = spyCooldownLeft(state, f);
    if (left > 0) return `Диверсійну групу можна заслати раз на ${CONFIG.espionage.cooldownHours[f]} год. (ще ${left} год.)`;
    const eco = Logistics.ensureEconomy(state)[f];
    if (eco.money < CONFIG.espionage.money) return `Потрібно ${CONFIG.espionage.money} грн (є ${Math.round(eco.money)}).`;
    return null;
  }
  function sendSpies(state, f, sid) {
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const s = state.map.settlements[sid];
    const why = spyReason(state, f, s);
    if (why) return { ok: false, reason: why };
    Logistics.ensureEconomy(state)[f].money -= CONFIG.espionage.money;
    if (!state.spyLast) state.spyLast = {};
    state.spyLast[f] = state.time.turn;
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const roll = hash2(seed ^ Math.imul(f + 1, 2654435761), state.time.turn, sid * 13 + 7) * 100;
    const victim = s.control;
    const caught = roll >= spyChance(f);
    if (caught) {
      adjustSupport(s, f, -CONFIG.espionage.caughtSupportLoss, null, 'диверсантів викрито', state);
      Engine.log(state, `ДИВЕРСІЯ: агентуру ${fname(f)} викрито в ${s.name} — підтримка «${fname(f)}» у пункті впала.`, 'warn', f, victim >= 0 ? [f, victim] : [f]);
      return { ok: true, caught: true };
    }
    const targets = victim >= 0 ? Logistics.facilities(state).filter(x => x.owner === victim && !x.destroyed && state.map.settlement[x.idx] === s.id) : [];
    if (targets.length) {
      const fac = targets[(state.time.turn + sid + f) % targets.length];
      if (Logistics.isStore(fac)) {
        for (const k of Object.keys(fac.stock.goods)) fac.stock.goods[k] = Math.floor(fac.stock.goods[k] * 0.7);
        for (const k of Object.keys(fac.stock.ammo)) fac.stock.ammo[k] = Math.floor(fac.stock.ammo[k] * 0.8);
      } else { fac.condition = Math.max(0, fac.condition - 35); fac.offline = Math.max(fac.offline, 3); }
      Engine.log(state, `ДИВЕРСІЯ: агентура «${fname(f)}» вразила «${fac.name}» у ${s.name}.`, 'alert', f, victim >= 0 ? [f, victim] : [f]);
      return { ok: true, caught: false, target: fac.name };
    }
    if (victim >= 0) adjustSupport(s, victim, -8, null, 'диверсія проти об’єктів влади', state);
    Engine.log(state, `ДИВЕРСІЯ: агентура «${fname(f)}» відпрацювала в ${s.name} — помітних об’єктів не знайшлося, завдано удар по репутації влади.`, 'alert', f, victim >= 0 ? [f, victim] : [f]);
    return { ok: true, caught: false, target: null };
  }

  // -------------------------------------- ПОЛОНЕНІ: УТРИМАННЯ, ПРАЦЯ, ДОПИТ (запит гравця)
  // «Полонені - допрацьовуємо»: утримання/табори (упкіп щогодини, борг -> ризик втечі),
  // примусова праця (прибуток понад упкіп, але б’є по підтримці — етична ціна) і допит
  // (разова платна дія, дає розвіддані про стан фракції-походження на обмежений час).
  // Партія полонених — запис у state.prisoners (той самий масив, що й для обміну
  // полоненими дипломатією), з новими опціональними полями labor/interrogated.
  function powCfg() { return CONFIG.pow; }
  function powBatches(state, holder) { return state.prisoners.filter(p => p.holder === holder && p.count > 0); }

  function setLabor(state, holder, idx, on) {
    const pr = state.prisoners[idx];
    if (!pr || pr.holder !== holder || pr.count <= 0) return { ok: false, reason: 'Партію полонених не знайдено.' };
    pr.labor = !!on;
    Engine.log(state, `${fname(holder)}: полонені «${pr.unit || '?'}» (${pr.count}) ${on ? 'призначені на примусову працю' : 'знято з праці'}.`, 'order', holder);
    return { ok: true };
  }

  function interrogateReason(state, holder, idx) {
    const pr = state.prisoners[idx];
    if (!pr || pr.holder !== holder || pr.count <= 0) return 'Партію полонених не знайдено.';
    if (pr.interrogated) return 'Цю партію вже допитано.';
    const eco = Logistics.ensureEconomy(state)[holder];
    if (eco.money < powCfg().interrogateMoney) return `Потрібно ${powCfg().interrogateMoney} грн (є ${Math.round(eco.money)}).`;
    return null;
  }
  function interrogate(state, holder, idx) {
    const pr = state.prisoners[idx];
    const why = interrogateReason(state, holder, idx);
    if (why) return { ok: false, reason: why };
    Logistics.ensureEconomy(state)[holder].money -= powCfg().interrogateMoney;
    pr.interrogated = true;
    const origin = pr.origin;
    const originEco = Logistics.ensureEconomy(state)[origin];
    if (!state.powIntel) state.powIntel = {};
    if (!state.powIntel[holder]) state.powIntel[holder] = {};
    state.powIntel[holder][origin] = { money: Math.round(originEco.money), manpower: originEco.manpower, turn: state.time.turn };
    Engine.log(state, `ДОПИТ: ${fname(holder)} отримав дані про стан «${fname(origin)}» від полонених «${pr.unit || '?'}».`, 'event', holder, [holder]);
    return { ok: true };
  }
  function powIntel(state, holder, origin) {
    const rec = state.powIntel && state.powIntel[holder] && state.powIntel[holder][origin];
    if (!rec) return null;
    const age = state.time.turn - rec.turn;
    if (age > powCfg().interrogateIntelHours) return null;
    return Object.assign({}, rec, { age });
  }

  function hourPrisoners(state) {
    if (!state.prisoners || !state.prisoners.length) return;
    const cfg = powCfg();
    if (!cfg) return;
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const laborTotal = [0, 0, 0];
    for (const pr of state.prisoners) {
      if (pr.count <= 0) continue;
      const eco = Logistics.ensureEconomy(state)[pr.holder];
      const upkeep = pr.count * cfg.upkeepPerHour;
      if (pr.labor) {
        laborTotal[pr.holder] += pr.count;
        eco.money += pr.count * cfg.laborIncomePerHour - upkeep;
      } else {
        eco.money -= upkeep;
      }
      if (eco.money < 0) {
        const roll = hash2(seed ^ Math.imul(pr.holder + 1, 2654435761), state.time.turn, (pr.origin + 1) * 97 + state.prisoners.indexOf(pr)) * 100;
        if (roll < cfg.escapeChance) {
          const n = Math.max(1, Math.round(pr.count * cfg.escapeShare));
          pr.count = Math.max(0, pr.count - n);
          Logistics.ensureEconomy(state)[pr.origin].manpower += n;
          Engine.log(state, `ВТЕЧА: ${n} полонених «${pr.unit || '?'}» утекли від «${fname(pr.holder)}» через неоплачене утримання — повернулися до «${fname(pr.origin)}».`, 'warn', pr.holder, [pr.holder, pr.origin]);
        }
      }
    }
    for (let f = 0; f < 3; f++) if (laborTotal[f] > 0) {
      const penalty = (laborTotal[f] / 10) * cfg.laborSupportPenalty;
      for (const s of state.map.settlements) if (s.pop && s.control === f) adjustSupport(s, f, -penalty, null, 'примусова праця полонених', state);
    }
    state.prisoners = state.prisoners.filter(p => p.count > 0);
  }

  function endOfHour(state) {
    init(state);
    hourPopulation(state);
    hourDiplomacy(state);
    hourEvents(state);
    hourPrisoners(state);
  }

  return { removePeople,
    GROUPS, TYPES, init, totalPop, support, groupSupport, nationalSupport, adjustSupport, incomeMult, manpowerMult, onCombat, onCapture,
    recordCasualties, recordCaptured, aid, aidReason, raiseMilitia, militiaReason, propaganda, propagandaReason, propagandaOutrage, homeFactor, GROUP_ADJ, rel, active, allied, sharesIntel, sharesSupply, corridorAt,
    statusText, attackCheck, breakAgreements, propose, proposeReason, respond, describe, dissolveAlliance, incoming,
    spyReason, sendSpies, spyCooldownLeft, spyChance,
    powCfg, powBatches, setLabor, interrogateReason, interrogate, powIntel, hourPrisoners,
    endOfHour, checkCampaign, scores, objectiveName, chronicle
  };
})();
