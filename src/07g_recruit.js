// ============================================================================
// МОДУЛЬ: НАБІР ПІДРОЗДІЛІВ, ПІДПІЛЛЯ, ЧОРНИЙ РИНОК (блок Б)
// Нові підрозділи формуються на складі: люди з резерву, зброя зі складу,
// гроші на спорядження, кілька годин підготовки. Підпільні майстерні
// працюють у прихильних пунктах. Чорний ринок продає зброю й запаси
// з доставкою на свій склад.
// ============================================================================
const Recruit = (() => {
  const R = () => CONFIG.recruitment;
  const W = () => CONFIG.workshop;
  const BM = () => CONFIG.blackMarket;
  const fname = f => CONFIG.factions[f].name;
  const ABBR = ['СВ', 'ДП', 'НП'];

  function queue(state) { if (!state.formations) state.formations = []; return state.formations; }
  function orders(state) { if (!state.market) state.market = []; return state.market; }

  // Яку зброю потребує тип підрозділу (автомати взаємозамінні)
  function needs(typeId, faction) {
    const w = Scenario.weaponsFor(typeId, faction);
    const out = { rifles: 0, exact: {} };
    for (const [m, n] of Object.entries(w)) {
      if (R().rifles.includes(m)) out.rifles += n;
      else if (m !== 'Одноразовий ПТГ' && m !== 'Пістолет') out.exact[m] = (out.exact[m] || 0) + n;
    }
    return out;
  }

  function plan(state, f, store, typeId) {
    const ut = CONFIG.unitTypes[typeId];
    const nd = needs(typeId, f);
    const st = store.stock.weapons;
    const take = {};
    let rifles = nd.rifles;
    // РПК і снайперську гвинтівку за браком можна замінити автоматом
    for (const m of ['РПК', 'Снайперська гвинтівка']) {
      const n = nd.exact[m] || 0, have = st[m] || 0;
      if (n > have) { rifles += n - have; nd.exact[m] = have; if (!have) delete nd.exact[m]; }
    }
    for (const m of R().rifles.slice().sort((a, b) => (st[b] || 0) - (st[a] || 0))) {
      const t = Math.min(rifles, st[m] || 0);
      if (t > 0) { take[m] = t; rifles -= t; }
    }
    const missing = [];
    if (rifles > 0) missing.push(`автомати ×${rifles}`);
    for (const [m, n] of Object.entries(nd.exact)) {
      if ((st[m] || 0) < n) missing.push(`${m} ×${n - (st[m] || 0)}`);
      else take[m] = (take[m] || 0) + n;
    }
    const money = ut.personnel * R().moneyPerPerson;
    return { take, missing, money, men: ut.personnel, hours: R().trainingHours[typeId] || 6 };
  }

  function formReason(state, f, store, typeId) {
    if (!store || !Logistics.isStore(store) || store.destroyed) return 'Формування можливе лише на своєму складі.';
    if (store.owner !== f) return 'Це не ваш склад.';
    if (!R().types.includes(typeId)) return 'Цей тип не формується.';
    const p = plan(state, f, store, typeId);
    const eco = Logistics.ensureEconomy(state)[f];
    if (eco.manpower < p.men) return `Потрібно ${p.men} ос. з резерву (є ${eco.manpower}).`;
    if (eco.money < p.money) return `Потрібно ${p.money} грн (є ${Math.round(eco.money)}).`;
    if (p.missing.length) return `На складі бракує: ${p.missing.join(', ')}.`;
    if (Engine.unitsAt(state, store.idx).some(u => u.faction !== f)) return 'На складі противник.';
    return null;
  }

  function form(state, f, storeId, typeId) {
    const store = Logistics.byId(state, storeId);
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = formReason(state, f, store, typeId);
    if (why) return { ok: false, reason: why };
    const p = plan(state, f, store, typeId);
    const eco = Logistics.ensureEconomy(state)[f];
    eco.manpower -= p.men; eco.money -= p.money;
    for (const [m, n] of Object.entries(p.take)) store.stock.weapons[m] -= n;
    // одноразові ПТГ та пістолети — якщо є на складі
    const extra = {};
    const full = Scenario.weaponsFor(typeId, f);
    if (full['Пістолет']) extra['Пістолет'] = full['Пістолет'];
    if (full['Одноразовий ПТГ'] && (store.stock.ammo.atd || 0) >= full['Одноразовий ПТГ']) { extra['Одноразовий ПТГ'] = full['Одноразовий ПТГ']; store.stock.ammo.atd -= full['Одноразовий ПТГ']; }
    const ready = state.time.turn + p.hours;
    queue(state).push({ id: (state.nextFormationId = (state.nextFormationId || 0) + 1), faction: f, type: typeId, storeId, idx: store.idx, weapons: Object.assign({}, p.take, extra), ready, started: { day: state.time.day, hour: state.time.hour } });
    const at = Engine.addHours(state.time, p.hours);
    Engine.log(state, `«${store.name}»: розпочато формування — ${CONFIG.unitTypes[typeId].name} (${p.men} ос., −${p.money} грн, зброя: ${Object.entries(p.take).map(([m, n]) => `${m} ×${n}`).join(', ') || '—'}). Готовність: ${Engine.timeLabel(at)}.`, 'event', f);
    return { ok: true };
  }

  function hourFormations(state) {
    for (const q of queue(state).slice()) {
      if (state.time.turn + 1 < q.ready) continue;   // готовність наприкінці години
      state.formations = queue(state).filter(x => x !== q);
      const store = Logistics.byId(state, q.storeId);
      if (!store || store.owner !== q.faction || store.destroyed) {
        Logistics.ensureEconomy(state)[q.faction].manpower += CONFIG.unitTypes[q.type].personnel;
        Engine.log(state, `Формування ${CONFIG.unitTypes[q.type].name.toLowerCase()} зірвано: склад втрачено. Люди повернулися в резерв, зброя пропала.`, 'warn', q.faction);
        continue;
      }
      const n = 1 + state.units.concat(state.lost).filter(u => u.faction === q.faction && u.type === q.type).length;
      const u = Scenario.createUnit(state, q.type, q.faction, store.idx, n);
      u.weapons = Object.assign({}, q.weapons);
      u.atdQuota = q.weapons['Одноразовий ПТГ'] || 0;
      u.ammo = {};
      if (u.atdQuota) u.ammo.atd = u.atdQuota;
      // боєкомплект зі складу (скільки є)
      for (const [m, k] of Object.entries(u.weapons)) {
        const w = CONFIG.weapons[m];
        if (!w || w.disposable) continue;
        const want = w.basicLoad * k;
        const t = Math.min(want, store.stock.ammo[w.ammo] || 0);
        if (t > 0) { store.stock.ammo[w.ammo] -= t; u.ammo[w.ammo] = (u.ammo[w.ammo] || 0) + t; }
      }
      u.experience = 0; u.xp = 0; u.morale = R().startMorale; u.baseMorale = R().startMorale;
      u.deployed = false;
      state.units.push(u);
      Engine.log(state, `«${store.name}»: сформовано ${u.name} — ${CONFIG.unitTypes[q.type].name.toLowerCase()}, недосвідчені, мораль ${u.morale}.`, 'event', q.faction);
    }
  }

  // ---------------------------------------------------- підпільна майстерня
  // Запит гравця: «соціалісти НЕ мають підпілля» — f===0 має штатну держбезпеку, не підпілля;
  // замість майстерні/чорного ринку в неї офіційні запити до патрона (Foreign.officialRequest).
  function workshopReason(state, f, s) {
    if (f === 0) return 'Соц. влада має штатну держбезпеку — підпільні майстерні їй не потрібні (користуйтеся офіційними запитами до патрона).';
    if (!s || !s.pop) return 'Населений пункт не знайдено.';
    if (s.control !== f) return 'Потрібно контролювати пункт.';
    if (Logistics.facilities(state).some(x => x.type === 'workshop' && x.owner === f && state.map.settlement[x.idx] === s.id && !x.destroyed)) return 'Майстерня в цьому пункті вже є.';
    const sup = Politics.support(s, f);
    if (sup < W().supportAbove) return `Потрібна підтримка мешканців ≥${W().supportAbove}% (зараз ${Math.round(sup)}%).`;
    if (Logistics.ensureEconomy(state)[f].money < W().money) return `Потрібно ${W().money} грн.`;
    return null;
  }
  function foundWorkshop(state, f, sid) {
    const s = state.map.settlements[sid];
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = workshopReason(state, f, s);
    if (why) return { ok: false, reason: why };
    const grid = Engine.grid(state);
    const used = new Set(Logistics.facilities(state).map(x => x.idx));
    const cand = grid.within(s.center, 2).filter(i => state.map.settlement[i] === sid && !used.has(i)).sort((a, b) => grid.dist(a, s.center) - grid.dist(b, s.center) || a - b);
    const idx = cand.length ? cand[0] : s.center;
    Logistics.ensureEconomy(state)[f].money -= W().money;
    const fac = Logistics.makeFacility(state, 'workshop', idx, f, `Підпільна майстерня (${s.name})`);
    fac.hidden = true;
    fac.recipe = Object.keys(W().recipes)[0];
    fac.level = 0;
    Engine.log(state, `${s.name}: облаштовано підпільну майстерню (−${W().money} грн). Виробництво: «${W().recipes[fac.recipe].label}» (можна перелаштувати), ремонтує техніку поруч і дозволяє ставити зброю на машини.`, 'event', f);
    return { ok: true, id: fac.id };
  }
  // Перелаштувати майстерню на інший рецепт виробництва (запит гравця)
  function setWorkshopRecipe(state, f, facId, recipeKey) {
    const fac = Logistics.byId(state, facId);
    if (!fac || fac.type !== 'workshop' || fac.owner !== f) return { ok: false, reason: 'Майстерню не знайдено.' };
    if (!W().recipes[recipeKey]) return { ok: false, reason: 'Невідомий рецепт.' };
    fac.recipe = recipeKey;
    Engine.log(state, `«${fac.name}»: перелаштовано виробництво — ${W().recipes[recipeKey].label}.`, 'order', f);
    return { ok: true };
  }
  // Покращити майстерню (вищий вихід і ремонт) — запит гравця
  function upgradeWorkshopReason(state, f, facId) {
    const fac = Logistics.byId(state, facId);
    if (!fac || fac.type !== 'workshop' || fac.owner !== f) return 'Майстерню не знайдено.';
    if (fac.level) return 'Майстерню вже покращено.';
    if (Logistics.ensureEconomy(state)[f].money < W().upgrade.money) return `Потрібно ${W().upgrade.money} грн.`;
    return null;
  }
  function upgradeWorkshop(state, f, facId) {
    const fac = Logistics.byId(state, facId);
    const why = upgradeWorkshopReason(state, f, facId);
    if (why) return { ok: false, reason: why };
    Logistics.ensureEconomy(state)[f].money -= W().upgrade.money;
    fac.level = 1;
    Engine.log(state, `«${fac.name}»: майстерню покращено (−${W().upgrade.money} грн) — вищий вихід виробництва й швидший ремонт техніки поруч.`, 'event', f);
    return { ok: true };
  }
  function hourWorkshops(state) {
    for (const fac of Logistics.facilities(state).filter(x => x.type === 'workshop' && !x.destroyed)) {
      const sid = state.map.settlement[fac.idx];
      const s = sid >= 0 ? state.map.settlements[sid] : null;
      if (s && s.pop && Politics.support(s, fac.owner) < W().exposedBelow) {
        fac.destroyed = true; fac.stock = Logistics.emptyStock();
        Engine.log(state, `${s.name}: мешканці видали підпільну майстерню — її розгромлено (підтримка ${Math.round(Politics.support(s, fac.owner))}%).`, 'warn', fac.owner, null);
        continue;
      }
      // ремонт техніки поруч (покращена майстерня — швидше)
      const repairRate = W().repairPerHour + (fac.level ? W().upgrade.repairPerHourBonus : 0);
      for (const v of state.units.filter(x => x.vehicle && x.faction === fac.owner && Engine.grid(state).dist(x.idx, fac.idx) <= 1 && x.vehicle.condition < 100)) {
        const add = Math.min(repairRate, 100 - v.vehicle.condition);
        v.vehicle.condition += add;
        Engine.log(state, `${v.name}: ремонт у підпільній майстерні +${add}% (стан ${v.vehicle.condition}%).`, 'supply', v.faction);
      }
    }
  }

  // ---------------------------------------------------- чорний ринок
  function itemName(key) {
    const it = BM().items[key];
    if (it.kind === 'weapons') return key;
    if (it.kind === 'ammo') return CONFIG.ammo[key].name;
    return CONFIG.goods[key].name;
  }
  function itemUnit(key) {
    const it = BM().items[key];
    return it.kind === 'weapons' ? 'шт.' : it.kind === 'ammo' ? 'шт.' : CONFIG.goods[key].unit;
  }
  function buyReason(state, f, key, qty, store) {
    if (f === 0) return 'Соц. владі чорний ринок не потрібен — користуйтеся офіційними запитами до патрона.';
    const it = BM().items[key];
    if (!it) return 'Невідомий товар.';
    if (!(qty >= 1 && qty <= 20)) return 'Кількість партій — від 1 до 20.';
    if (!store || !Logistics.isStore(store) || store.owner !== f || store.destroyed) return 'Оберіть свій склад для доставки.';
    const price = it.price * qty;
    if (Logistics.ensureEconomy(state)[f].money < price) return `Потрібно ${price} грн.`;
    return null;
  }
  function buy(state, f, key, qty, storeId) {
    const store = Logistics.byId(state, storeId);
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = buyReason(state, f, key, qty, store);
    if (why) return { ok: false, reason: why };
    const it = BM().items[key];
    const price = it.price * qty;
    Logistics.ensureEconomy(state)[f].money -= price;
    const o = { id: (state.nextMarketId = (state.nextMarketId || 0) + 1), faction: f, key, qty, n: it.n * qty, kind: it.kind, storeId, arrive: state.time.turn + Math.ceil(BM().deliveryHours * Air.deliveryMult(state, f)), price };
    orders(state).push(o);
    Engine.log(state, `Чорний ринок: замовлено ${itemName(key)} — ${o.n} ${itemUnit(key)} за ${price} грн. Доставка на «${store.name}» через ${BM().deliveryHours} год.`, 'event', f);
    return { ok: true };
  }
  function hourMarket(state) {
    for (const o of orders(state).slice()) {
      if (state.time.turn + 1 < o.arrive) continue;
      state.market = orders(state).filter(x => x !== o);
      const store = Logistics.byId(state, o.storeId);
      if (!store || store.owner !== o.faction || store.destroyed) { Engine.log(state, `Чорний ринок: партію «${itemName(o.key)}» втрачено — склад доставки більше не ваш.`, 'warn', o.faction); continue; }
      const bucket = o.kind === 'weapons' ? store.stock.weapons : o.kind === 'ammo' ? store.stock.ammo : store.stock.goods;
      bucket[o.key] = (bucket[o.key] || 0) + o.n;
      Engine.log(state, `Чорний ринок: на «${store.name}» доставлено ${itemName(o.key)} — ${o.n} ${itemUnit(o.key)}.`, 'supply', o.faction);
    }
  }

  function endOfHour(state) { hourFormations(state); hourWorkshops(state); hourMarket(state); }

  return { needs, plan, form, formReason, queue, foundWorkshop, workshopReason, setWorkshopRecipe, upgradeWorkshopReason, upgradeWorkshop, buy, buyReason, orders, itemName, itemUnit, endOfHour };
})();
