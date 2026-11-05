// ============================================================================
// МОДУЛЬ: РІШЕННЯ (ФОКУСИ) ФРАКЦІЙ (запит гравця)
// Кожна сторона обирає курс: рішення має умови (видно, яких бракує), ціну й тривалість
// у годинах; одночасно виконується одне рішення на фракцію. Частина рішень взаємовиключні.
// Баланс: кожне сильне рішення має ціну або запускає відповідь противника —
//   • повстанці можуть об’єднатися проти СВ (канал зв’язку → спільний штаб → єдиний фронт),
//     але спонсори не люблять такого союзу (−стосунки);
//   • СВ може розколоти фронт амністією для однієї зі сторін — прийняття вважається зрадою
//     іншими повстанцями (−репутація того, хто прийняв, якщо мав угоди з другою стороною);
//   • ескалація: «Введення російської армії» — сильне підкріплення СВ, але НАТО відповідає
//     (+стосунки ДП, відкривається «Західна місія»).
// Числа — ЗАГЛУШКИ (CONFIG.decisions), можна змінити.
// ============================================================================
const Decisions = (() => {
  const C = () => CONFIG.decisions;
  const fname = f => CONFIG.factions[f].name;
  const other = f => (f === 1 ? 2 : 1);

  function st(state) {
    if (!state.decisions) state.decisions = { active: [null, null, null], done: [[], [], []], flags: {}, watch: [] };
    return state.decisions;
  }
  const done = (state, f, id) => st(state).done[f].includes(id);
  const flag = (state, k) => st(state).flags[k];

  // ---------------------------------------------------- допоміжні умови
  function lostSettlements(state, f) {
    const c0 = state.campaign && state.campaign.ctl0;
    if (!c0) return 0;
    return state.map.settlements.filter((s, k) => c0[k] === f && s.control !== f).length;
  }
  function landShare(state, f) {
    const cs = Engine.controlStats(state);
    const tot = cs[0] + cs[1] + cs[2] + cs[3];
    return tot ? cs[f] / tot : 0;
  }
  function killedOf(state, f) {
    let k = 0;
    for (const u of state.units.concat(state.lost || [])) if (u.faction === f) k += u.personnel.killed || 0;
    return k;
  }
  const money = (state, f) => Logistics.ensureEconomy(state)[f].money;
  // Підтримка групи серед населення СВОЇХ пунктів (не всієї країни)
  function ownGroupSupport(state, f, group) {
    let w = 0, t = 0;
    for (const s of state.map.settlements) if (s.control === f && s.pop) { w += s.pop[group] * s.support[group][f]; t += s.pop[group]; }
    return t ? w / t : 0;
  }
  const agreement = (state, a, b, t) => Politics.active(state, a, b, t);
  // Пропозиція від рішення (поза фазою автора — рішення завершується в кінці години)
  function proposeFrom(state, from, to, type) {
    if (state.diplomacy.proposals.some(p => p.status === 'open' && p.from === from && p.to === to && p.type === type)) return null;
    if (agreement(state, from, to, type)) return null;
    const p = { id: state.diplomacy.nextId++, from, to, type, terms: {}, created: state.time.turn, day: state.time.day, hour: state.time.hour, status: 'open' };
    state.diplomacy.proposals.push(p);
    Engine.log(state, `Дипломатія: ${fname(from)} пропонує «${fname(to)}» — ${Politics.describe(state, p)}. Відповідь — у фазі отримувача.`, 'event', from, [from, to]);
    return p;
  }

  // ---------------------------------------------------- визначення рішень
  // req: [{ ok: (state,f)=>bool, text }] — умови; run: (state,f) — наслідки по завершенню
  const DEFS = [
    // ---- повстанці: об’єднання
    { id: 'contact', who: [1, 2], name: 'Канал зв’язку',
      desc: 'Неофіційні контакти з іншою повстанською стороною. Наслідок: пропозиція перемир’я їй, +5 репутації.',
      cost: () => C().contact.money, hours: () => C().contact.hours, once: true,
      req: [{ text: 'Війна з іншою повстанською стороною (ще немає перемир’я чи союзу)', ok: (s, f) => !agreement(s, f, other(f), 'ceasefire') && !agreement(s, f, other(f), 'alliance') }],
      run(state, f) {
        proposeFrom(state, f, other(f), 'ceasefire');
        state.diplomacy.reputation[f] = Math.min(100, state.diplomacy.reputation[f] + 5);
      } },
    { id: 'jointHQ', who: [1, 2], name: 'Спільний штаб',
      desc: 'Координація з іншою повстанською стороною проти СВ. Наслідок: пропозиція союзу; поки союз діє — +10% вогню по СВ, якщо поруч із ціллю (2 гекси) є підрозділ союзника. Ціна: спонсор не схвалює такого союзу (−10 стосунків).',
      cost: () => C().jointHQ.money, hours: () => C().jointHQ.hours, once: true,
      req: [
        { text: 'Виконано «Канал зв’язку»', ok: (s, f) => done(s, f, 'contact') },
        { keep: true, text: 'Перемир’я або союз з іншою повстанською стороною', ok: (s, f) => !!(agreement(s, f, other(f), 'ceasefire') || agreement(s, f, other(f), 'alliance')) },
        { text: `СВ тримає щонайменше ${Math.round(CONFIG.decisions.jointHQ.socShare * 100)}% території`, ok: s => landShare(s, 0) >= C().jointHQ.socShare }
      ],
      run(state, f) {
        if (!agreement(state, f, other(f), 'alliance')) {
          // союз можливий лише за чинного перемир’я — перевірить proposeCheckOnAccept
          proposeFrom(state, f, other(f), 'alliance');
        }
        st(state).flags['jointHQ' + f] = true;
        Foreign.adjustGeo(state, f, -C().jointHQ.geoPenalty, 'союз з іншою повстанською стороною не до вподоби спонсору');
      } },
    { id: 'unitedFront', who: [1, 2], name: 'Єдиний фронт',
      desc: 'Публічне об’єднання повстанців. Наслідок: хвиля добровольців обом сторонам, +5 підтримки серед юготарів у всіх пунктах обох сторін.',
      cost: () => C().unitedFront.money, hours: () => C().unitedFront.hours, once: true,
      req: [
        { text: 'Виконано «Спільний штаб»', ok: (s, f) => done(s, f, 'jointHQ') },
        { keep: true, text: `Союз з іншою повстанською стороною діє щонайменше ${CONFIG.decisions.unitedFront.allianceHours} год`, ok: (s, f) => { const a = agreement(s, f, other(f), 'alliance'); return !!a && s.time.turn - a.since >= C().unitedFront.allianceHours; } }
      ],
      run(state, f) {
        for (const x of [f, other(f)]) {
          for (let k = 0; k < C().unitedFront.volunteers; k++) Foreign.queueVolunteers(state, x, 'Єдиний фронт повстанців', { hours: 6 + k * 2 });
          for (const s of state.map.settlements) if (s.control === x && s.pop) Politics.adjustSupport(s, x, 5, 'yug', 'єдиний фронт повстанців', state);
        }
        st(state).flags.unitedFront = true;
      } },
    // ---- СВ: примирення (одне з двох)
    { id: 'amnesty1', who: [0], name: 'Амністія для Демократичних повстанців', excl: 'amnesty',
      desc: 'Переговори й амністія лише для ДП. Наслідок: пропозиція перемир’я ДП, +4 підтримки серед юготарів у пунктах СВ. Якщо ДП прийме, маючи угоди з НП, — це зрада для НП (−10 репутації ДП).',
      cost: () => C().amnesty.money, hours: () => C().amnesty.hours, once: true,
      req: [{ text: `СВ втратила пункт або понесла важкі втрати (${CONFIG.decisions.amnesty.killed}+ загиблих)`, ok: s => lostSettlements(s, 0) > 0 || killedOf(s, 0) >= C().amnesty.killed }],
      run(state) { amnesty(state, 1); } },
    { id: 'amnesty2', who: [0], name: 'Амністія для Націоналістичних повстанців', excl: 'amnesty',
      desc: 'Переговори й амністія лише для НП. Наслідок: пропозиція перемир’я НП, +4 підтримки серед юготарів у пунктах СВ. Якщо НП прийме, маючи угоди з ДП, — це зрада для ДП (−10 репутації НП).',
      cost: () => C().amnesty.money, hours: () => C().amnesty.hours, once: true,
      req: [{ text: `СВ втратила пункт або понесла важкі втрати (${CONFIG.decisions.amnesty.killed}+ загиблих)`, ok: s => lostSettlements(s, 0) > 0 || killedOf(s, 0) >= C().amnesty.killed }],
      run(state) { amnesty(state, 2); } },
    // ---- СВ: ескалація
    { id: 'russianArmy', who: [0], name: 'Введення російської армії',
      desc: 'Регулярна батальйонна група ЗС РФ через порт: 2 піхотні взводи, МТ-ЛБ, гаубиця Д-30 з тягачем — досвідчені. Ціна: −15 репутації СВ, НАТО відповідає (+15 стосунків ДП, відкривається «Західна місія»).',
      cost: () => C().russianArmy.money, hours: () => C().russianArmy.hours, once: true,
      req: [
        { text: 'СВ втратила Місто А або 2+ пункти', ok: s => s.map.settlements[0].control !== 0 || lostSettlements(s, 0) >= 2 },
        { text: `Стосунки з Росією ≥ ${CONFIG.decisions.russianArmy.geo}`, ok: s => Foreign.geo(s, 0) >= C().russianArmy.geo },
        { keep: true, text: 'Порт відкритий', ok: s => !Foreign.borderReason(s, 0, null) }
      ],
      run(state) {
        const idx = Foreign.entryIdx(state, 0);
        if (Foreign.borderReason(state, 0, null) || idx < 0) { Engine.log(state, 'Введення російської армії зірвано — порт втрачено.', 'warn', 0); return; }
        const g = Engine.grid(state);
        const spots = g.within(idx, 3).filter(i => state.map.control[i] === 0 && Engine.hexPassable(state, 'foot', i) && !state.units.some(u => u.idx === i && u.faction !== 0)).sort((a, b) => g.dist(a, idx) - g.dist(b, idx) || a - b);
        const made = [];
        C().russianArmy.units.forEach((t, k) => {
          const at = spots[k % Math.max(1, spots.length)] != null ? spots[k % spots.length] : idx;
          const n = 1 + state.units.concat(state.lost || []).filter(u => u.faction === 0 && u.foreignKind === 'army').length;
          const u = Scenario.createUnit(state, t, 0, at, n);
          u.name = `ЗС РФ: ${CONFIG.unitTypes[t].short} №${n}`;
          u.foreignKind = 'army'; u.experience = 2; u.morale = 80; u.baseMorale = 80; u.mp = 0; u.movedThisPhase = true;
          state.units.push(u); made.push(u.name);
        });
        state.diplomacy.reputation[0] = Math.max(0, state.diplomacy.reputation[0] - 15);
        Foreign.adjustGeo(state, 1, 15, 'відповідь на введення російської армії');
        st(state).flags.russianArmy = true;
        Engine.log(state, `У «${Foreign.entryName(state, 0)}» висадилась батальйонна група ЗС РФ: ${made.join(', ')}.`, 'event', 0);
        Engine.log(state, 'ЗАКОРДОН: Росія ввела в Юготарію регулярні війська. НАТО обіцяє відповідь.', 'event', null, null);
        Intel.update(state);
      } },
    { id: 'mobilization', who: [0], name: 'Загальна мобілізація',
      desc: `Призов резервістів. Наслідок: +${CONFIG.decisions.mobilization.manpower} осіб у резерв. Ціна: −4 підтримки серед юготарів у всіх пунктах СВ.`,
      cost: () => 0, hours: () => C().mobilization.hours, once: true,
      req: [{ text: `Резерв людей менше ${CONFIG.decisions.mobilization.below}`, ok: s => Logistics.ensureEconomy(s)[0].manpower < C().mobilization.below }],
      run(state) {
        Logistics.ensureEconomy(state)[0].manpower += C().mobilization.manpower;
        for (const s of state.map.settlements) if (s.control === 0 && s.pop) Politics.adjustSupport(s, 0, -4, 'yug', 'загальна мобілізація', state);
      } },
    // ---- ДП: Захід
    { id: 'natoAir', who: [1], name: 'Повітряна розвідка НАТО',
      desc: `НАТО передає розвідувальні ${CONFIG.air.uav.name} (${CONFIG.air.uav.airframes} апарати), що злітають з аеропорту й на годину розкривають обраний район.`,
      cost: () => C().natoAir.money, hours: () => C().natoAir.hours, once: true,
      req: [
        { text: `Стосунки з НАТО ≥ ${CONFIG.decisions.natoAir.geo}`, ok: s => Foreign.geo(s, 1) >= C().natoAir.geo },
        { keep: true, text: 'Аеропорт працює', ok: s => typeof Air !== 'undefined' && !Air.airportReason(s, 1) }
      ],
      run(state) { Air.unlock(state, 1); } },
    { id: 'westMission', who: [1], name: 'Західна місія',
      desc: 'Інструктори з країн НАТО. Наслідок: до 4 піхотних підрозділів ДП підвищують досвід на рівень і +5 моралі; +5 стосунків з НАТО.',
      cost: () => C().westMission.money, hours: () => C().westMission.hours, once: true,
      req: [{ text: `Росія ввела армію або стосунки з НАТО ≥ ${CONFIG.decisions.westMission.geo}`, ok: s => !!flag(s, 'russianArmy') || Foreign.geo(s, 1) >= C().westMission.geo }],
      run(state) {
        const maxExp = CONFIG.experience.length - 1;
        const list = state.units.filter(u => u.faction === 1 && u.personnel.fit > 0 && ['inf_squad', 'inf_platoon', 'mg_team', 'at_team', 'recon'].includes(u.type) && u.experience < maxExp)
          .sort((a, b) => b.personnel.fit - a.personnel.fit || a.id - b.id).slice(0, 4);
        for (const u of list) { u.experience = Math.min(maxExp, u.experience + 1); u.xp = CONFIG.combat.xpForLevel[u.experience]; u.morale = Math.min(100, u.morale + 5); }
        Foreign.adjustGeo(state, 1, 5, 'західна місія');
        Engine.log(state, `Західна місія: пройшли вишкіл ${list.map(u => u.name).join(', ') || 'нікого'}.`, 'event', 1);
      } },
    // ---- НП: діаспора
    { id: 'diasporaMob', who: [2], name: 'Мобілізація діаспори',
      desc: `Кампанія серед закордонної діаспори. Наслідок: 1 взвод добровольців зараз і на ${CONFIG.decisions.diasporaMob.halfHours} год кулдаун заклику добровольців удвічі менший. Можна повторювати.`,
      cost: () => C().diasporaMob.money, hours: () => C().diasporaMob.hours, once: false, cooldown: () => C().diasporaMob.cooldown,
      req: [{ text: `Підтримка серед юготарів у пунктах НП ≥ ${CONFIG.decisions.diasporaMob.support}%`, ok: s => ownGroupSupport(s, 2, 'yug') >= C().diasporaMob.support }],
      run(state) {
        Foreign.queueVolunteers(state, 2, 'мобілізація діаспори', { hours: 6 });
        st(state).flags.volHalfUntil2 = state.time.turn + C().diasporaMob.halfHours;
      } }
  ];
  const byId = id => DEFS.find(d => d.id === id);

  function amnesty(state, target) {
    const p = proposeFrom(state, 0, target, 'ceasefire');
    for (const s of state.map.settlements) if (s.control === 0 && s.pop) Politics.adjustSupport(s, 0, 4, 'yug', 'амністія', state);
    if (p) st(state).watch.push({ kind: 'amnesty', proposal: p.id, target });
  }

  // ---------------------------------------------------- стан рішень для фракції
  function lastDoneTurn(state, f, id) { const h = (st(state).history || []).filter(x => x.f === f && x.id === id); return h.length ? h[h.length - 1].turn : null; }
  function list(state, f) {
    const S = st(state);
    return DEFS.filter(d => d.who.includes(f)).map(d => {
      const reqs = d.req.map(r => ({ text: r.text, ok: !!r.ok(state, f) }));
      let status = 'available', note = '';
      const act = S.active[f];
      if (act && act.id === d.id) { status = 'active'; note = `ще ${Math.max(0, act.end - state.time.turn)} год`; }
      else if (d.once && done(state, f, d.id)) status = 'done';
      else if (d.excl && DEFS.some(x => x.excl === d.excl && x.id !== d.id && (done(state, f, x.id) || (act && act.id === x.id)))) { status = 'excluded'; note = 'обрано інший шлях'; }
      else {
        const cd = d.cooldown ? d.cooldown() : 0, last = lastDoneTurn(state, f, d.id);
        if (cd && last != null && state.time.turn - last < cd) { status = 'locked'; note = `повтор через ${cd - (state.time.turn - last)} год`; }
        else if (reqs.some(r => !r.ok)) status = 'locked';
      }
      return { id: d.id, name: d.name, desc: d.desc, cost: d.cost(), hours: d.hours(), reqs, status, note };
    });
  }
  function startReason(state, f, id) {
    const d = byId(id);
    if (!d || !d.who.includes(f)) return 'Це рішення недоступне вашій стороні.';
    if (st(state).active[f]) return `Уже виконується рішення «${byId(st(state).active[f].id).name}».`;
    const item = list(state, f).find(x => x.id === id);
    if (item.status === 'done') return 'Рішення вже виконано.';
    if (item.status === 'excluded') return 'Обрано інший шлях.';
    if (item.status === 'locked') return item.note || 'Умови не виконано: ' + item.reqs.filter(r => !r.ok).map(r => r.text).join('; ') + '.';
    if (money(state, f) < item.cost) return `Потрібно ${item.cost} грн (є ${Math.round(money(state, f))}).`;
    return null;
  }
  function start(state, f, id) {
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = startReason(state, f, id);
    if (why) return { ok: false, reason: why };
    const d = byId(id);
    Logistics.ensureEconomy(state)[f].money -= d.cost();
    st(state).active[f] = { id, start: state.time.turn, end: state.time.turn + d.hours() };
    Engine.log(state, `${fname(f)}: розпочато рішення «${d.name}»${d.cost() ? ` (−${d.cost()} грн)` : ''}, триватиме ${d.hours()} год.`, 'event', f);
    return { ok: true };
  }
  function cancel(state, f) {
    const a = st(state).active[f];
    if (!a) return { ok: false, reason: 'Немає активного рішення.' };
    st(state).active[f] = null;
    Engine.log(state, `${fname(f)}: рішення «${byId(a.id).name}» скасовано (кошти не повертаються).`, 'event', f);
    return { ok: true };
  }

  // ---------------------------------------------------- кінець години
  function hour(state) {
    const S = st(state);
    for (let f = 0; f < 3; f++) {
      const a = S.active[f];
      if (!a || state.time.turn + 1 < a.end) continue;
      S.active[f] = null;
      const d = byId(a.id);
      // тривалі умови (keep: чинна угода, відкритий порт, робочий аеропорт) перевіряємо знову
      const miss = d.req.filter(r => r.keep && !r.ok(state, f));
      if (miss.length) { Engine.log(state, `${fname(f)}: рішення «${d.name}» зірвано — більше не виконано: ${miss.map(r => r.text).join('; ')}.`, 'warn', f); continue; }
      d.run(state, f);
      S.done[f].push(d.id);
      (S.history || (S.history = [])).push({ f, id: d.id, turn: state.time.turn });
      Engine.log(state, `${fname(f)}: рішення «${d.name}» виконано.`, 'event', f);
    }
    // прийняття амністії при угодах з іншими повстанцями — зрада
    for (const w of S.watch.slice()) {
      const p = state.diplomacy.proposals.find(x => x.id === w.proposal);
      if (!p || p.status === 'open') continue;
      S.watch = S.watch.filter(x => x !== w);
      if (p.status !== 'accepted') continue;
      const o = other(w.target);
      if (agreement(state, w.target, o, 'ceasefire') || agreement(state, w.target, o, 'alliance')) {
        state.diplomacy.reputation[w.target] = Math.max(0, state.diplomacy.reputation[w.target] - 10);
        Engine.log(state, `${fname(o)} вважає перемир’я «${fname(w.target)}» з СВ зрадою спільної справи (−10 репутації «${fname(w.target)}»).`, 'event', null, [1, 2]);
      }
    }
  }

  // ---------------------------------------------------- ефекти для інших модулів
  // Спільний штаб: +10% вогню повстанця по СВ, якщо поруч із ціллю є союзний повстанець
  function fireMult(state, a, d) {
    if (!state.decisions || a.faction === 0 || d.faction !== 0) return 1;
    if (!flag(state, 'jointHQ' + a.faction) && !flag(state, 'jointHQ' + other(a.faction))) return 1;
    if (!agreement(state, a.faction, other(a.faction), 'alliance')) return 1;
    const g = Engine.grid(state);
    return state.units.some(u => u.faction === other(a.faction) && u.personnel.fit > 0 && g.dist(u.idx, d.idx) <= 2) ? 1 + C().jointHQ.fireBonus : 1;
  }
  function volCooldownMult(state, f) {
    const u = state.decisions && state.decisions.flags['volHalfUntil' + f];
    return u != null && state.time.turn < u ? 0.5 : 1;
  }

  return { DEFS, list, start, startReason, cancel, hour, fireMult, volCooldownMult, state: st };
})();
