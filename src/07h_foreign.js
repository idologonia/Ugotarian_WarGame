// ============================================================================
// МОДУЛЬ: ГЕОПОЛІТИКА, ПВК, ДОБРОВОЛЬЦІ
// Два канали зовнішньої підтримки, обидва йдуть лише через прикордонний перехід фракції
// (map.borderEntry): ПВК — купується за гроші (ціна/кулдаун залежать від стосунків із
// патроном), добровольці — приходять безкоштовно хвилею після звільнення пункту або за
// спробою гравця «закликати» їх (ціна/кулдаун спроби теж залежать від стосунків).
// ============================================================================
const Foreign = (() => {
  const G = () => CONFIG.geopolitics;
  const fname = f => CONFIG.factions[f].name;
  const ABBR = ['СВ', 'ДП', 'НП'];
  const GROUP_LABEL = { yug: 'юготарці', rus: 'росіяни', cauc: 'кавказці' };

  // ---------------------------------------------------- геополітика (стосунки з патроном)
  function geoArr(state) { if (!state.geo) state.geo = G().startRelation.slice(); return state.geo; }
  function geo(state, f) { return geoArr(state)[f]; }
  function patron(f) { return G().patrons[f]; }
  // Держава-спонсор (стосунки, офіційні запити, інвестиції) — окремо від ПВК (patron)
  function sponsor(f) { return (G().sponsors && G().sponsors[f]) || { name: patron(f).name, volunteers: 'Добровольці' }; }
  function adjustGeo(state, f, delta, why) {
    const arr = geoArr(state);
    const before = Math.round(arr[f]);
    arr[f] = Math.max(G().min, Math.min(G().max, arr[f] + delta));
    const after = Math.round(arr[f]);
    if (after !== before) Engine.log(state, `${fname(f)}: стосунки з «${sponsor(f).name}» ${delta > 0 ? 'покращились' : 'погіршились'} (${before} → ${after}) — ${why}.`, 'event', f, null);
  }
  // Лінійна інтерполяція между значенням «за гірших стосунків» (at0) і «за найкращих» (at100)
  function relLerp(state, f, at0, at100) {
    const t = (geo(state, f) - G().min) / (G().max - G().min);
    return at0 + (at100 - at0) * t;
  }

  // ---------------------------------------------------- прикордонний перехід
  function entryIdx(state, f) { const b = state.map.borderEntry; return b && b[f] != null ? b[f] : -1; }
  // Назва переходу — береться з фактичної місцевості, обчисленої при генерації карти
  // (map.borderEntryName; залежить від того, яка місцевість реально є у території фракції —
  // див. Scenario.pickBorderEntries), зі старим статичним текстом CONFIG як запасний варіант
  // (старі збереження без цього поля).
  function entryName(state, f) {
    const n = state.map.borderEntryName;
    return (n && n[f]) || patron(f).entryName;
  }
  // Перевіряє, що перехід відкритий (свій, без ворога) і — якщо задано toIdx — що територія
  // між переходом і пунктом прибуття не розрізана ворогом (одна компонента мережі постачання).
  // Для старих збережень без borderEntry (idx<0) нічого не блокує — зворотна сумісність.
  function borderReason(state, f, toIdx) {
    const idx = entryIdx(state, f);
    if (idx < 0) return null;
    const EN = entryName(state, f);
    if (state.map.control[idx] !== f) return `${EN} втрачено — немає зв’язку з закордоном.`;
    if (Engine.unitsAt(state, idx).some(u => u.faction !== f && u.personnel.fit > 0)) return `${EN} заблоковано противником.`;
    if (toIdx != null && toIdx !== idx) {
      const net = Logistics.network(state, f);
      if (net.comp[idx] < 0 || net.comp[toIdx] < 0 || net.comp[idx] !== net.comp[toIdx]) return `${EN} відрізано від обраного пункту прибуття — територію розсічено ворогом.`;
    }
    return null;
  }

  // ---------------------------------------------------- спільна черга прибуття (ПВК і добровольці)
  function queue(state) { if (!state.foreignOrders) state.foreignOrders = []; return state.foreignOrders; }

  // ---------------------------------------------------- ПВК (найм за гроші)
  function lastPmcTurn(state) { if (!state.pmcLast) state.pmcLast = {}; return state.pmcLast; }
  function pmcCooldownLeft(state, f) {
    const last = lastPmcTurn(state)[f];
    return last == null ? 0 : Math.max(0, G().pmc.cooldownHours - (state.time.turn - last));
  }
  // Рішення автора (запит гравця): «можна зробити заклик до ПВК, після чого появиться окреме
  // меню замовлення» — кулдаун і стосунки гейтять сам ВИКЛИК (контакт із патроном), а що саме
  // він надішле — обирається з каталогу patron(f).items (різний у кожного патрона, в соц.
  // влади — найбагатший, включно з МТ-ЛБ, «по-вагнерівськи»). pmcItems/pmcPrice повернені
  // назовні для меню замовлення в 90_ui.js.
  function pmcItems(f) { return patron(f).items || { platoon: { unitType: G().pmc.unitType, label: 'Взвод', priceMult: 1 } }; }
  function pmcPrice(state, f, itemKey) {
    const item = pmcItems(f)[itemKey] || { priceMult: 1 };
    return Math.round(G().pmc.money * item.priceMult * relLerp(state, f, G().pmc.priceAt0, G().pmc.priceAt100));
  }
  function pmcReason(state, f, store, itemKey) {
    if (!store || !Logistics.isStore(store) || store.owner !== f || store.destroyed) return 'Оберіть свій склад для прибуття ПВК.';
    const item = pmcItems(f)[itemKey];
    if (!item) return 'Оберіть, що замовити.';
    const left = pmcCooldownLeft(state, f);
    if (left > 0) return `«${patron(f).name}» можна найняти раз на ${G().pmc.cooldownHours} год. (ще ${left} год.)`;
    const br = borderReason(state, f, store.idx);
    if (br) return br;
    const price = pmcPrice(state, f, itemKey);
    if (Logistics.ensureEconomy(state)[f].money < price) return `Потрібно ${price} грн (є ${Math.round(Logistics.ensureEconomy(state)[f].money)}).`;
    return null;
  }
  function hirePmc(state, f, storeId, itemKey) {
    const store = Logistics.byId(state, storeId);
    const item = pmcItems(f)[itemKey];
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = pmcReason(state, f, store, itemKey);
    if (why) return { ok: false, reason: why };
    const price = pmcPrice(state, f, itemKey);
    Logistics.ensureEconomy(state)[f].money -= price;
    lastPmcTurn(state)[f] = state.time.turn;
    // вантажний рейс через аеропорт (ДП) — швидше
    const dh = Math.ceil(G().pmc.deliveryHours * Air.deliveryMult(state, f));
    const arrive = state.time.turn + dh;
    queue(state).push({ id: (state.nextForeignId = (state.nextForeignId || 0) + 1), kind: 'pmc', faction: f, storeId, idx: store.idx, arrive, unitType: item.unitType, itemLabel: item.label });
    Engine.log(state, `${fname(f)}: замовлено в «${patron(f).name}»: ${item.label} (−${price} грн). Прибуття на «${store.name}» через ${dh} год${dh < G().pmc.deliveryHours ? ' (вантажним рейсом через аеропорт)' : ''}.`, 'event', f);
    adjustGeo(state, f, G().events.pmcUsed, `найм «${patron(f).name}»`);
    return { ok: true };
  }

  // ---------------------------------------------------- офіційні запити до патрона (запит гравця)
  // «Соціалісти НЕ мають підпілля — забираємо майстерню й чорний ринок, даємо офіційні запити
  // на РФ, просимо партії чогось за гроші, і вони кажуть чи так чи ні». На відміну від чорного
  // ринку (гарантована доставка) тут патрон може ВІДМОВИТИ — шанс схвалення залежить від
  // стосунків (Foreign.geo), детерміновано (hash2), без Math.random(). Лише для соц. влади (f===0) —
  // решта фракцій і так мають майстерню/чорний ринок.
  const OS_ = () => CONFIG.officialSupply;
  function lastOfficialTurn(state) { if (!state.offLast) state.offLast = {}; return state.offLast; }
  function officialCooldownLeft(state, f) {
    const last = lastOfficialTurn(state)[f];
    return last == null ? 0 : Math.max(0, OS_().cooldownHours - (state.time.turn - last));
  }
  function officialChance(state, f) { return relLerp(state, f, OS_().acceptChanceAt0, OS_().acceptChanceAt100); }
  // Назва товару будь-якого каталогу (закупівлі, продаж): боєприпаси, майно чи зброя
  function officialItemName(key) {
    if (CONFIG.ammo[key]) return CONFIG.ammo[key].name;
    if (CONFIG.goods[key]) return CONFIG.goods[key].name;
    return key;
  }
  function officialOrders(state) { if (!state.officialOrders) state.officialOrders = []; return state.officialOrders; }
  function officialReason(state, f, key, qty, store) {
    if (f !== 0) return 'Офіційні запити до патрона доступні лише соц. владі.';
    const it = OS_().items[key];
    if (!it) return 'Невідомий товар.';
    if (!(qty >= 1 && qty <= 20)) return 'Кількість партій — від 1 до 20.';
    if (!store || !Logistics.isStore(store) || store.owner !== f || store.destroyed) return 'Оберіть свій склад для доставки.';
    const left = officialCooldownLeft(state, f);
    if (left > 0) return `Офіційний запит можливий раз на ${OS_().cooldownHours} год. (ще ${left} год.)`;
    const price = it.price * qty;
    if (Logistics.ensureEconomy(state)[f].money < price) return `Потрібно ${price} грн (є ${Math.round(Logistics.ensureEconomy(state)[f].money)}).`;
    return null;
  }
  function officialRequest(state, f, key, qty, storeId) {
    const store = Logistics.byId(state, storeId);
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = officialReason(state, f, key, qty, store);
    if (why) return { ok: false, reason: why };
    const it = OS_().items[key];
    const price = it.price * qty;
    lastOfficialTurn(state)[f] = state.time.turn;
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const roll = hash2(seed ^ Math.imul(f + 1, 2654435761), state.time.turn, qty * 31 + key.length) * 100;
    const approved = roll < officialChance(state, f);
    if (!approved) {
      Engine.log(state, `Офіційний запит до «${sponsor(f).name}»: партію «${officialItemName(key)}» відхилено.`, 'event', f);
      return { ok: true, approved: false };
    }
    Logistics.ensureEconomy(state)[f].money -= price;
    const o = { id: (state.nextMarketId = (state.nextMarketId || 0) + 1), faction: f, key, qty, n: it.n * qty, kind: it.kind, storeId, arrive: state.time.turn + OS_().deliveryHours, price };
    officialOrders(state).push(o);
    Engine.log(state, `Офіційний запит до «${sponsor(f).name}»: СХВАЛЕНО — ${officialItemName(key)} ×${o.n} за ${price} грн. Доставка на «${store.name}» через ${OS_().deliveryHours} год.`, 'event', f);
    return { ok: true, approved: true };
  }
  function hourOfficial(state) {
    for (const o of officialOrders(state).slice()) {
      if (state.time.turn + 1 < o.arrive) continue;
      state.officialOrders = officialOrders(state).filter(x => x !== o);
      const store = Logistics.byId(state, o.storeId);
      if (!store || store.owner !== o.faction || store.destroyed) { Engine.log(state, `Офіційна партія «${officialItemName(o.key)}» втрачена — склад доставки більше не ваш.`, 'warn', o.faction); continue; }
      const bucket = o.kind === 'weapons' ? store.stock.weapons : o.kind === 'ammo' ? store.stock.ammo : store.stock.goods;
      bucket[o.key] = (bucket[o.key] || 0) + o.n;
      Engine.log(state, `На «${store.name}» доставлено офіційну партію — ${officialItemName(o.key)} ×${o.n}.`, 'supply', o.faction);
    }
  }

  // ---------------------------------------------------- продаж у РФ (запит гравця)
  // Соц. влада продає нафту, пальне й продукцію заводів через перехід «Росія». Товар знімається
  // одразу з її об’єктів, пов’язаних своєю територією з переходом; гроші — коли партія дійде
  // до кордону. Перехід втрачено/заблоковано до того — партія пропала.
  const RT_ = () => CONFIG.russiaTrade;
  function saleOrders(state) { if (!state.rfSales) state.rfSales = []; return state.rfSales; }
  function saleCooldownLeft(state, f) {
    const last = (state.rfSaleLast || {})[f];
    return last == null ? 0 : Math.max(0, RT_().cooldownHours - (state.time.turn - last));
  }
  function salePriceMult(state, f) { return relLerp(state, f, RT_().priceAt0, RT_().priceAt100); }
  function salePrice(state, f, key) { const it = RT_().items[key]; return it ? Math.round(it.price * salePriceMult(state, f)) : 0; }
  function bucketOf(st, kind) { return kind === 'weapons' ? st.weapons : kind === 'ammo' ? st.ammo : st.goods; }
  // Об’єкти, з яких можна вивезти товар: свої, цілі, у тій самій частині території, що й перехід
  function saleSources(state, f) {
    const idx = entryIdx(state, f);
    if (idx < 0) return [];
    const net = Logistics.network(state, f);
    if (net.comp[idx] < 0) return [];
    return Logistics.facilities(state).filter(x => x.owner === f && !x.destroyed && x.stock && net.comp[x.idx] === net.comp[idx]);
  }
  function saleAvailable(state, f, key) {
    const it = RT_().items[key];
    if (!it) return 0;
    return saleSources(state, f).reduce((a, x) => a + Math.floor(bucketOf(x.stock, it.kind)[key] || 0), 0);
  }
  function saleReason(state, f, key, qty) {
    if (f !== 0) return 'Продаж у РФ доступний лише соц. владі.';
    const it = RT_().items[key];
    if (!it) return 'Невідомий товар.';
    if (!(qty >= 1 && qty <= RT_().maxBatches)) return `Кількість партій — від 1 до ${RT_().maxBatches}.`;
    const br = borderReason(state, f, null);
    if (br) return br;
    if (entryIdx(state, f) < 0) return 'Немає прикордонного переходу.';
    const left = saleCooldownLeft(state, f);
    if (left > 0) return `Наступна партія на експорт — через ${left} год.`;
    const have = saleAvailable(state, f, key);
    if (have < it.n * qty) return `Бракує товару на об’єктах, пов’язаних із переходом: потрібно ${it.n * qty}, є ${have}.`;
    return null;
  }
  function sellRF(state, f, key, qty) {
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = saleReason(state, f, key, qty);
    if (why) return { ok: false, reason: why };
    const it = RT_().items[key];
    let need = it.n * qty;
    // спершу зі складів, потім із виробництв (НПЗ, термінал, заводи) — ближчих до переходу
    const g = Engine.grid(state), e = entryIdx(state, f);
    const srcs = saleSources(state, f).sort((a, b) => (Logistics.isStore(b) ? 1 : 0) - (Logistics.isStore(a) ? 1 : 0) || g.dist(a.idx, e) - g.dist(b.idx, e) || a.id - b.id);
    for (const x of srcs) {
      if (need <= 0) break;
      const b = bucketOf(x.stock, it.kind);
      const take = Math.min(need, Math.floor(b[key] || 0));
      if (take > 0) { b[key] -= take; need -= take; }
    }
    const price = salePrice(state, f, key) * qty;
    if (!state.rfSaleLast) state.rfSaleLast = {};
    state.rfSaleLast[f] = state.time.turn;
    const o = { id: (state.nextMarketId = (state.nextMarketId || 0) + 1), faction: f, key, qty, n: it.n * qty, kind: it.kind, price, arrive: state.time.turn + RT_().deliveryHours };
    saleOrders(state).push(o);
    Engine.log(state, `Експорт у РФ: ${officialItemName(key)} ×${o.n} вирушило до «${entryName(state, f)}». Оплата ${price} грн — коли партія перетне кордон (≈${RT_().deliveryHours} год).`, 'event', f);
    return { ok: true, price };
  }
  function hourSales(state) {
    for (const o of saleOrders(state).slice()) {
      if (state.time.turn + 1 < o.arrive) continue;
      state.rfSales = saleOrders(state).filter(x => x !== o);
      const br = borderReason(state, o.faction, null);
      if (br) { Engine.log(state, `Експортна партія «${officialItemName(o.key)}» ×${o.n} пропала: ${br}`, 'warn', o.faction); continue; }
      Logistics.ensureEconomy(state)[o.faction].money += o.price;
      Engine.log(state, `Експорт у РФ: партію «${officialItemName(o.key)}» ×${o.n} прийнято, отримано ${o.price} грн.`, 'supply', o.faction);
      adjustGeo(state, o.faction, RT_().geoPerSale, 'торгівля через кордон');
    }
  }

  // ---------------------------------------------------- іноземні інвестиції (запит гравця, лише повстанці)
  // «Повстанці можуть просити іноземні інвестиції» — третій канал зовнішньої підтримки, окремо
  // від ПВК (найм за гроші) і добровольців (безкоштовна хвиля людей): цей дає ГРОШІ, не людей чи
  // товар, і лише для повстанців (f===1/2); соц. влада має офіційні запити officialSupply.
  // Патрон може ВІДМОВИТИ — детермінований hash2-кидок, шанс і сума залежать від стосунків
  // (geo[f]), той самий підхід, що й officialRequest вище.
  const INV_ = () => G().investment;
  function lastInvestTurn(state) { if (!state.invLast) state.invLast = {}; return state.invLast; }
  function investCooldownLeft(state, f) {
    const last = lastInvestTurn(state)[f];
    return last == null ? 0 : Math.max(0, INV_().cooldownHours - (state.time.turn - last));
  }
  function investChance(state, f) { return relLerp(state, f, INV_().acceptChanceAt0, INV_().acceptChanceAt100); }
  function investAmount(state, f) { return Math.round(relLerp(state, f, INV_().amountAt0, INV_().amountAt100)); }
  function investOrders(state) { if (!state.investOrders) state.investOrders = []; return state.investOrders; }
  function investReason(state, f) {
    if (f !== 1 && f !== 2) return 'Іноземні інвестиції доступні лише повстанцям.';
    const left = investCooldownLeft(state, f);
    if (left > 0) return `Заявку на інвестиції можна подати раз на ${INV_().cooldownHours} год. (ще ${left} год.)`;
    return null;
  }
  function requestInvestment(state, f) {
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = investReason(state, f);
    if (why) return { ok: false, reason: why };
    lastInvestTurn(state)[f] = state.time.turn;
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const roll = hash2(seed ^ Math.imul(f + 1, 2654435761), state.time.turn, 777) * 100;
    const approved = roll < investChance(state, f);
    if (!approved) {
      Engine.log(state, `${fname(f)}: заявку на іноземні інвестиції відхилено.`, 'event', f);
      return { ok: true, approved: false };
    }
    const amount = investAmount(state, f);
    investOrders(state).push({ id: (state.nextForeignId = (state.nextForeignId || 0) + 1), faction: f, amount, arrive: state.time.turn + INV_().deliveryHours });
    Engine.log(state, `${fname(f)}: заявку на іноземні інвестиції СХВАЛЕНО — ${amount} грн надійде через ${INV_().deliveryHours} год.`, 'event', f);
    return { ok: true, approved: true, amount };
  }
  function hourInvestment(state) {
    for (const o of investOrders(state).slice()) {
      if (state.time.turn + 1 < o.arrive) continue;
      state.investOrders = investOrders(state).filter(x => x !== o);
      Logistics.ensureEconomy(state)[o.faction].money += o.amount;
      Engine.log(state, `${fname(o.faction)}: надійшли іноземні інвестиції — ${o.amount} грн.`, 'supply', o.faction);
    }
  }

  // ---------------------------------------------------- добровольці (подія + спроба закликати)
  function lastVolTurn(state) { if (!state.volLast) state.volLast = {}; return state.volLast; }
  function volCooldownHours(state, f) { return Math.round(relLerp(state, f, G().volunteers.callCooldownAt0, G().volunteers.callCooldownAt100)); }
  function volCooldownLeft(state, f) {
    const last = lastVolTurn(state)[f];
    return last == null ? 0 : Math.max(0, volCooldownHours(state, f) - (state.time.turn - last));
  }
  function volCost(state, f) { return Math.round(relLerp(state, f, G().volunteers.callMoneyAt0, G().volunteers.callMoneyAt100)); }
  function callReason(state, f) {
    const left = volCooldownLeft(state, f);
    if (left > 0) return `Заклик добровольців можливий раз на ${volCooldownHours(state, f)} год. (ще ${left} год.)`;
    const idx = entryIdx(state, f);
    const br = borderReason(state, f, idx >= 0 ? idx : null);
    if (br) return br;
    const cost = volCost(state, f);
    if (cost > 0 && Logistics.ensureEconomy(state)[f].money < cost) return `Потрібно ${cost} грн на організацію переправи (є ${Math.round(Logistics.ensureEconomy(state)[f].money)}).`;
    return null;
  }
  function callVolunteers(state, f) {
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = callReason(state, f);
    if (why) return { ok: false, reason: why };
    const cost = volCost(state, f);
    if (cost > 0) Logistics.ensureEconomy(state)[f].money -= cost;
    lastVolTurn(state)[f] = state.time.turn;
    queueVolunteers(state, f, `спроба закликати добровольців${cost > 0 ? ` (−${cost} грн)` : ''}`);
    Engine.log(state, `${fname(f)}: заклик до добровольців («${sponsor(f).volunteers}»)${cost > 0 ? ` (−${cost} грн)` : ''}. Прибуття через ${G().volunteers.deliveryHours} год, якщо перехід буде відкрито.`, 'event', f);
    return { ok: true };
  }
  function queueVolunteers(state, f, why, opts) {
    opts = opts || {};
    const idx = entryIdx(state, f);
    const hours = opts.hours != null ? opts.hours : G().volunteers.deliveryHours;
    const arrive = state.time.turn + Math.max(1, hours);
    queue(state).push({ id: (state.nextForeignId = (state.nextForeignId || 0) + 1), kind: 'volunteers', faction: f, storeId: null, idx: idx >= 0 ? idx : null, arrive, why, unitType: opts.unitType || null });
  }
  // Запит гравця: «добровольці — не ПВК, довго прибувають». Хвиля при звільненні села тепер
  // асиметрична: переможець (узяв село) — трохи добровольців, звично (фаворити й так перемагають,
  // не сильно спішать); переможений (щойно втратив село) — БІЛЬШЕ добровольців і ШВИДШЕ (бачать,
  // що їхній фаворит «не вивозить», реагують різкіше). Кількість — детермінована (hash2), не
  // Math.random(). G().volunteers.captureWave задає діапазони.
  function captureWave(state, winner, loser, settlement) {
    const wave = G().volunteers.captureWave;
    if (!wave) { queueVolunteers(state, winner, `хвиля добровольців після звільнення «${settlement.name}»`); return; }
    const seed = ((state.meta && state.meta.seed) || 0) >>> 0;
    const winN = wave.winMin + Math.floor(hash2(seed ^ Math.imul(winner + 1, 2654435761), state.time.turn, settlement.id * 13 + 1) * (wave.winMax - wave.winMin + 1));
    for (let i = 0; i < winN; i++) queueVolunteers(state, winner, `переможна хвиля добровольців — взято «${settlement.name}»`, { unitType: 'inf_squad' });
    const loseN = wave.loseMin + Math.floor(hash2(seed ^ Math.imul(loser + 1, 2654435761), state.time.turn, settlement.id * 13 + 2) * (wave.loseMax - wave.loseMin + 1));
    const loseHours = Math.max(1, Math.round(G().volunteers.deliveryHours * wave.loseDeliveryMult));
    for (let i = 0; i < loseN; i++) queueVolunteers(state, loser, `тривожна хвиля добровольців — втрачено «${settlement.name}»`, { unitType: 'inf_squad', hours: loseHours });
    Engine.log(state, `${settlement.name}: хвиля добровольців — ${winN} відділ. у ${fname(winner)} (неспішно), ${loseN} відділ. у ${fname(loser)} (швидше: їхній фаворит не вивозить).`, 'event', winner, [winner, loser]);
  }
  // Викликається з 05_engine.js, коли центр населеного пункту переходить від одного
  // живого власника до іншого (не від «нічийого») — тобто пункт саме звільнено, а не просто
  // вперше зайнято. Безкоштовна «хвиля підтримки» вдома + безкоштовна хвиля добровольців
  // (асиметрична captureWave, якщо відомий попередній живий власник).
  function onLiberate(state, f, settlement, prevOwner) {
    if (settlement && settlement.pop) Politics.adjustSupport(settlement, f, G().volunteers.liberationSupport, null, 'хвиля підтримки після звільнення', state);
    adjustGeo(state, f, G().events.liberate, `звільнення «${settlement.name}»`);
    Engine.log(state, `${settlement.name}: звільнення викликало хвилю підтримки (+${G().volunteers.liberationSupport}%) і добровольців із-за кордону.`, 'event', f, null);
    if (prevOwner != null && prevOwner >= 0 && prevOwner !== f) captureWave(state, f, prevOwner, settlement);
    else queueVolunteers(state, f, `хвиля добровольців після звільнення «${settlement.name}»`);
  }

  // ---------------------------------------------------- прибуття (щогодини)
  function hourForeign(state) {
    for (const o of queue(state).slice()) {
      if (state.time.turn + 1 < o.arrive) continue;
      state.foreignOrders = queue(state).filter(x => x !== o);
      const P = patron(o.faction);
      let destIdx, destName;
      if (o.kind === 'pmc') {
        const store = Logistics.byId(state, o.storeId);
        if (!store || store.owner !== o.faction || store.destroyed) {
          Engine.log(state, `${fname(o.faction)}: підкріплення від «${P.name}» втрачено — склад прибуття більше не ваш.`, 'warn', o.faction);
          continue;
        }
        destIdx = store.idx; destName = store.name;
      } else {
        destIdx = o.idx;
        if (destIdx == null || destIdx < 0 || state.map.control[destIdx] !== o.faction || Engine.unitsAt(state, destIdx).some(u => u.faction !== o.faction && u.personnel.fit > 0)) {
          Engine.log(state, `${fname(o.faction)}: добровольці з-за кордону не змогли прорватись — ${entryName(state, o.faction).toLowerCase()} заблоковано.`, 'warn', o.faction);
          continue;
        }
        destName = entryName(state, o.faction);
      }
      const kindCfg = o.kind === 'pmc' ? G().pmc : G().volunteers;
      const prefix = o.kind === 'pmc' ? 'ПВК' : 'Добровольці';
      // unitType/itemLabel — із конкретного замовлення (меню ПВК); для старих збережень без
      // цих полів — запасний варіант kindCfg.unitType (завжди піхотний взвод), як і було раніше.
      const unitType = o.unitType || kindCfg.unitType;
      const n = 1 + state.units.concat(state.lost || []).filter(u => u.faction === o.faction && u.foreignKind === o.kind).length;
      const u = Scenario.createUnit(state, unitType, o.faction, destIdx, n);
      // ПВК — найманці конкретної компанії; добровольці — від своєї спільноти, без назви ПВК
      u.name = o.kind === 'pmc' ? `${prefix} №${n} ${ABBR[o.faction]} (${P.name})${o.itemLabel ? ` — ${o.itemLabel}` : ''}` : `${sponsor(o.faction).volunteers} №${n} ${ABBR[o.faction]}`;
      u.foreignKind = o.kind;
      u.experience = kindCfg.experience; u.xp = 0;
      u.morale = kindCfg.morale; u.baseMorale = kindCfg.morale;
      u.mp = 0; u.movedThisPhase = true; u.deployed = false;
      state.units.push(u);
      let txt = o.kind === 'pmc' ? `«${destName}»: прибули бійці ПВК від «${P.name}» — ${u.name}.` : `«${destName}»: прибули ${sponsor(o.faction).volunteers.toLowerCase()} — ${u.name}.`;
      if (o.kind === 'pmc' && P.ammo) {
        const store = Logistics.byId(state, o.storeId);
        store.stock.ammo[P.ammo.key] = (store.stock.ammo[P.ammo.key] || 0) + P.ammo.n;
        txt += ` Також доставлено ${CONFIG.ammo[P.ammo.key].name} ×${P.ammo.n}.`;
      }
      Engine.log(state, txt, 'supply', o.faction);
      if (o.kind === 'pmc') {
        let hit = 0;
        for (const s of state.map.settlements) {
          if (s.control !== o.faction || !s.pop) continue;
          Politics.adjustSupport(s, o.faction, -G().pmc.supportPenalty, P.penaltyGroup, `видима присутність «${P.name}»`, state);
          hit++;
        }
        if (hit) Engine.log(state, `Видима присутність «${P.name}» підриває підтримку групи «${GROUP_LABEL[P.penaltyGroup]}» у ${hit} підконтрольних пунктах (−${G().pmc.supportPenalty}%).`, 'warn', o.faction, null);
      }
      Intel.update(state);
    }
    hourOfficial(state);
    hourSales(state);
    hourInvestment(state);
  }

  return { saleOrders, saleCooldownLeft, salePrice, salePriceMult, saleSources, saleAvailable, saleReason, sellRF,
    geo, patron, sponsor, adjustGeo, entryIdx, entryName, borderReason,
    pmcItems, pmcPrice, pmcCooldownLeft, pmcReason, hirePmc,
    officialReason, officialRequest, officialCooldownLeft, officialChance, officialOrders, officialItemName,
    investReason, requestInvestment, investCooldownLeft, investChance, investAmount, investOrders,
    volCost, volCooldownHours, volCooldownLeft, callReason, callVolunteers, onLiberate,
    queue, hourForeign
  };
})();
