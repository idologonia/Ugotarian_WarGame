// ============================================================================
// МОДУЛЬ: СЦЕНАРІЙ — ТЕСТОВИЙ СЦЕНАРІЙ ЕТАПУ 1
// Склад сил, мораль, досвід та арсенали — ЗАГЛУШКИ для перевірки механік.
// ============================================================================
const Scenario = {
  // Основна стрілецька зброя фракцій (ЗАГЛУШКА тестового сценарію)
  arsenal: [
    { rifle: 'АК-74', carbine: 'АКС-74У' },   // Соціалістична влада
    { rifle: 'АКМ',   carbine: 'АКС-74У' },   // Демократичні повстанці
    { rifle: 'АКМ',   carbine: 'АКМ' }        // Націоналістичні повстанці
  ],
  startMorale: [70, 75, 75],   // ЗАГЛУШКА
  startExperience: [1, 0, 0],  // ЗАГЛУШКА: індекси CONFIG.experience

  // Склад сил тестового сценарію
  orbat: [
    ['inf_platoon', 'inf_platoon', 'inf_squad', 'inf_squad', 'mg_team', 'at_team', 'recon', 'mortar', 'medevac', 'eng_squad', 'ags_team', 'hmg_team', 'veh_mtlb', 'veh_kamaz', 'arty_team', 'veh_ural', 'ew_team'],
    ['inf_platoon', 'inf_squad', 'inf_squad', 'inf_squad', 'mg_team', 'at_team', 'recon', 'medevac', 'eng_squad', 'hmg_team', 'veh_uaz', 'veh_kamaz', 'civ_pickup:НСВ «Утьос»', 'civ_van', 'ew_team'],
    ['inf_platoon', 'inf_squad', 'inf_squad', 'inf_squad', 'mg_team', 'at_team', 'recon', 'mortar', 'eng_squad', 'ags_team', 'veh_uaz', 'civ_pickup:ПКМ', 'civ_car', 'ew_team']
  ],

  weaponsFor(typeId, faction) {
    const a = Scenario.arsenal[faction];
    const W = {};
    const add = (m, n) => { W[m] = (W[m] || 0) + n; };
    switch (typeId) {
      case 'inf_squad':   add(a.rifle, 4); add('РПК', 1); add('Одноразовий ПТГ', 1); break;
      case 'inf_platoon': add(a.rifle, 15); add('РПК', 2); add('ПКМ', 1); add('РПГ-7', 1); add('Снайперська гвинтівка', 1); break;
      case 'mg_team':     add('ПКМ', 1); add(a.rifle, 2); break;
      case 'at_team':     add('РПГ-7', 1); add(a.rifle, 2); add('Одноразовий ПТГ', 2); break;
      case 'recon':       add(a.rifle, 3); add('Снайперська гвинтівка', 1); break;
      case 'mortar':      add('Міномет 81 мм', 1); add(a.carbine, 4); break;
      case 'arty_team':   add('Д-30', 1); add(a.carbine, 5); break;
      case 'medevac':     add(a.carbine, 1); add('Пістолет', 2); break;
      case 'supply_team': add(a.carbine, 2); add('Пістолет', 2); break;
      case 'ew_team':     add(a.carbine, 2); add('Пістолет', 2); break;
      case 'eng_squad':   add(a.rifle, 5); add(a.carbine, 1); break;
      case 'ags_team':    add('АГС-17', 1); add(a.carbine, 3); break;
      case 'hmg_team':    add('НСВ «Утьос»', 1); add(a.carbine, 3); break;
      default: {
        const ut = CONFIG.unitTypes[typeId];
        if (ut && ut.vehicle) add(a.carbine, ut.vehicle.crew);
        if (typeId === 'veh_mtlb') add('ПКТ', 1);
      }
    }
    return W;
  },

  ammoFor(weapons) {
    const A = {};
    for (const [m, n] of Object.entries(weapons)) {
      const w = CONFIG.weapons[m];
      if (!w) continue;
      A[w.ammo] = (A[w.ammo] || 0) + w.basicLoad * n;
    }
    return A;
  },

  createUnit(state, typeId, faction, idx, number) {
    const ut = CONFIG.unitTypes[typeId];
    const weapons = Scenario.weaponsFor(typeId, faction);
    const u = {
      id: state.nextUnitId++,
      type: typeId,
      faction,
      name: `${ut.short} №${number} ${['СВ', 'ДП', 'НП'][faction]}`,
      idx,
      personnel: { assigned: ut.personnel, fit: ut.personnel, wounded: 0, killed: 0, captured: 0, missing: 0, straggling: 0 },
      morale: Scenario.startMorale[faction],
      baseMorale: Scenario.startMorale[faction],
      experience: Scenario.startExperience[faction],
      xp: CONFIG.combat.xpForLevel[Scenario.startExperience[faction]],
      weapons,
      ammo: Scenario.ammoFor(weapons),
      supply: 'Повний боєкомплект',
      order: null,
      pendingOrder: null,
      mp: ut.mp,
      movedThisPhase: false,
      comm: { radio: 'Не визначено (етап 2)', connected: true },
      vehicle: ut.vehicle ? { model: ut.vehicle.model, fuel: ut.vehicle.fuelMax, fuelMax: ut.vehicle.fuelMax, condition: 100, passengers: ut.vehicle.passengers } : null,
      lastReport: null
    };
    Scenario.addStage2Fields(u);
    return u;
  },

  // Умовні події тестового сценарію (ЗАГЛУШКИ; редагування — етап 6)
  events() {
    const ev = [
      { id: 'rally', name: 'Мітинг на центральній площі', text: 'У Місті А тисячі юготарів вийшли на мітинг проти війни. Підтримка контролюючої сторони серед юготарів падає.',
        trigger: { type: 'time', day: 1, hour: 18 }, effects: [{ type: 'support', settlement: 0, faction: 'controller', group: 'yug', delta: -6 }] },
      { id: 'city_falls', name: 'Зміна влади в Місті А', text: 'Місто А перейшло під інший контроль. Частина мешканців тікає, колишня влада втрачає кошти на евакуацію.',
        trigger: { type: 'control', settlement: 0 }, effects: [{ type: 'refugees', settlement: 0, share: 0.05 }] },
      { id: 'convoy', name: 'Гуманітарний конвой Червоного Хреста', text: 'Конвой доставив 40 комплектів медикаментів у шпиталь сторони, що контролює Місто А.',
        trigger: { type: 'time', day: 2, hour: 10 }, effects: [{ type: 'goods', faction: 'controller', settlement: 0, facility: 'hospital', goods: { med: 40 } }] },
      { id: 'front', name: 'Об’єднаний фронт повстанців', text: 'Демократичні й націоналістичні повстанці уклали союз. Юготари вітають єдність опозиції.',
        trigger: { type: 'diplomacy', a: 1, b: 2, agreement: 'alliance' }, effects: [{ type: 'supportAll', faction: 1, group: 'yug', delta: 4 }, { type: 'supportAll', faction: 2, group: 'yug', delta: 4 }] },
      { id: 'volunteers', name: 'Добровольці з сіл', text: 'У Село В прибуло відділення добровольців для націоналістичних повстанців.',
        trigger: { type: 'time', day: 2, hour: 6 }, effects: [{ type: 'spawn', faction: 2, settlement: 2, unitType: 'inf_squad', name: 'Добров. №1 НП' }] }
    ];
    for (let f = 0; f < 3; f++) ev.push({ id: 'mobcrisis' + f, name: `Мобілізаційна кампанія (${CONFIG.factions[f].short})`, text: `${CONFIG.factions[f].name} оголошує додаткову мобілізацію після важких втрат: +15 до резерву, але підтримка падає.`,
      trigger: { type: 'losses', faction: f, killed: 25 }, effects: [{ type: 'manpower', faction: f, delta: 15 }, { type: 'supportAll', faction: f, delta: -3 }] });
    return ev;
  },

  // Цілі перемоги тестового сценарію (ЗАГЛУШКИ)
  objectives() {
    return [
      [{ type: 'holdSettlement', settlement: 0, points: 30 }, { type: 'holdFacility', facility: 'oil_field', points: 10 }, { type: 'holdSettlement', settlement: 3, points: 5 },
        { type: 'holdSettlement', settlement: 4, points: 5 }, { type: 'support', points: 20, target: 60 }, { type: 'enemyLosses', points: 20, target: 60 }, { type: 'reputation', points: 10 }],
      [{ type: 'holdSettlement', settlement: 0, points: 25 }, { type: 'holdSettlement', settlement: 1, points: 10 }, { type: 'holdSettlement', settlement: 5, points: 10 },
        { type: 'support', points: 25, target: 60 }, { type: 'enemyLosses', points: 15, target: 60 }, { type: 'reputation', points: 15 }],
      [{ type: 'holdSettlement', settlement: 2, points: 10 }, { type: 'holdSettlement', settlement: 4, points: 10 }, { type: 'holdSettlement', settlement: 0, points: 20 },
        { type: 'groupSupport', group: 'yug', points: 30, target: 65 }, { type: 'enemyLosses', points: 15, target: 60 }, { type: 'reputation', points: 15 }]
    ];
  },

  // Встановити зброю на техніку (технічка)
  mountWeapon(u, model, ammo) {
    if (u.mount) { u.weapons[u.mount] = Math.max(0, (u.weapons[u.mount] || 0) - 1); if (!u.weapons[u.mount]) delete u.weapons[u.mount]; }
    u.weapons[model] = (u.weapons[model] || 0) + 1;
    const cat = CONFIG.weapons[model].ammo;
    u.ammo[cat] = (u.ammo[cat] || 0) + (ammo || 0);
    u.mount = model;
    u.deployed = true;
  },

  // Поля етапу 2 (бій, мораль, розвідка)
  addStage2Fields(u) {
    if (u.baseMorale == null) u.baseMorale = u.morale;
    if (u.xp == null) u.xp = CONFIG.combat.xpForLevel[u.experience] || 0;
    if (u.suppression == null) u.suppression = 0;
    if (u.fort == null) u.fort = 0;              // рівень підготовленої оборони
    if (u.stance == null) u.stance = 'none';     // none | defend | observe
    if (u.dispersal == null) u.dispersal = 0;    // 0 — немає, 1–2 — часткове, 3 — повне
    if (u.acc == null) u.acc = { cas: 0, kill: 0, veh: 0 };
    if (u.firedTurn == null) u.firedTurn = 0;
    if (u.attackedTurn == null) u.attackedTurn = 0;
    if (u.combatTurn == null) u.combatTurn = 0;   // остання година, коли підрозділ був у бою
    if (u.surrounded == null) u.surrounded = false;
    if (u.embarked === undefined) u.embarked = null;   // id машини, в якій їде підрозділ
    if (u.carrying == null) u.carrying = [];           // id пасажирів (для техніки)
    if (u.deployed == null) u.deployed = Object.keys(u.weapons || {}).some(m => CONFIG.weapons[m] && CONFIG.weapons[m].deploy);   // групова зброя розгорнута
    if (u.atdQuota == null) u.atdQuota = (u.weapons && u.weapons['Одноразовий ПТГ']) || 0;   // скільки одноразових ПТГ носить підрозділ
    if (u.mount === undefined) u.mount = null;
    if (u.cargo == null) u.cargo = { weapons: {}, ammo: {}, goods: {} };   // трофеї та запаси у вантажі
    if (u.cargo && !u.cargo.goods) u.cargo.goods = {};
    if (u.personnel && u.personnel.evacuated == null) u.personnel.evacuated = 0;   // евакуйовані поранені
    if (u.type === 'medevac' && u.carriedWounded == null) u.carriedWounded = 0;
  },

  // Новий стан гри з тестовим сценарієм
  build(seed) {
    const { width, height } = CONFIG.map;
    const map = MapGen.generate(seed, width, height);
    const state = {
      format: CONFIG.saveFormat,
      version: CONFIG.saveVersion,
      meta: { seed, scenario: 'Тестовий сценарій етапу 1', created: Date.now() },
      time: { day: 1, hour: CONFIG.startHour, turn: 1 },
      phase: 0,
      // Рішення автора: щоб жодна фракція не мала постійної «переваги першого ходу», порядок
      // фаз у межах години обертається щогодини (endPhase у 05_engine.js) — за 3 години кожна
      // фракція рівно по разу ходить першою, другою й третьою.
      phaseOrder: [0, 1, 2],
      geo: CONFIG.geopolitics.startRelation.slice(),   // стосунки з патроном (ПВК/добровольці), 0..100
      factions: CONFIG.factions.map(f => ({ id: f.id, name: f.name, human: true })),
      map,
      units: [],
      log: [],
      nextUnitId: 1,
      nextLogId: 1,
      intel: [{}, {}, {}],        // відомі ворожі підрозділи для кожної фракції
      caches: {},                 // місця боїв: загиблі, зброя, набої, уламки
      prisoners: [],              // { holder, origin, count, day, hour }
      lost: [],                   // знищені та полонені підрозділи
      lastCombat: null            // звіт останнього бою (для інтерфейсу)
    };
    const grid = new Grid(width, height);
    // Прикордонні переходи «з-за кордону» (ПВК, добровольці) — по одному на фракцію.
    // Тип і назва (порт/аеродром/гірський перевал/...) обчислюються за фактичною
    // місцевістю, знайденою у території фракції — див. коментар у pickBorderEntries.
    const be = Scenario.pickBorderEntries(grid, map);
    map.borderEntry = be.idx;
    map.borderEntryName = be.names;
    // Центри розміщення: місто (СВ), Село Б (ДП), Село В (НП)
    const anchors = [map.settlements[0].center, map.settlements[1].center, map.settlements[2].center];
    const used = new Set();
    Scenario.orbat.forEach((list, faction) => {
      const counters = {};
      // BFS навколо центру: прохідні гекси під контролем фракції
      const order = Scenario.bfsHexes(grid, map, anchors[faction], faction);
      let k = 0;
      for (const entry of list) {
        const [typeId, mount] = entry.split(':');
        counters[typeId] = (counters[typeId] || 0) + 1;
        const cls = CONFIG.unitTypes[typeId].move;
        while (k < order.length && (used.has(order[k]) || CONFIG.moveCost[cls][CONFIG.terrain[map.terrain[order[k]]].key] == null || map.river[order[k]])) k++;
        if (k >= order.length) break;
        const idx = order[k++];
        used.add(idx);
        const u = Scenario.createUnit(state, typeId, faction, idx, counters[typeId]);
        if (mount) Scenario.mountWeapon(u, mount, CONFIG.weapons[mount].basicLoad);
        state.units.push(u);
      }
    });
    Logistics.placeScenario(state);
    Air.placeAirport(state);
    Field.placeMotorpool(state);
    Logistics.ensureEconomy(state);
    Politics.init(state);
    return state;
  },

  // Прикордонний перехід фракції: гекс на самому краю карти в її початковій території
  // (прохідний, не річка/море), найдальший від власного центру впливу — якщо такого немає
  // (територія не сягає краю карти), беремо найдальший прохідний гекс своєї території
  // взагалі. Саме через цей гекс іде ПВК і добровольці (07h_foreign.js); його можна
  // відрізати ворогом — тоді зовнішня підтримка не дійде.
  //
  // Тип переходу (порт/аеродром/гірський перевал) шукається за фактичною місцевістю у
  // ВЛАСНІЙ території фракції — процедурна карта не гарантує, що в кожної фракції є своя
  // гора чи своє узбережжя (напр. націоналісти зазвичай не межують з горами взагалі, а
  // демократи навпаки часто дуже гористі), тож назва переходу обчислюється динамічно за
  // тим, що реально знайдено, а не підганяється під наперед вигадану назву патрона.
  pickBorderEntries(grid, map) {
    const N = grid.size;
    const seeds = [map.settlements[0].center, map.settlements[1].center, map.settlements[2].center];
    const PREF = [
      ['coast'],            // соц. влада — «Слов'янський корпус» заходить морем
      ['plain', 'farmland'],// демократи — НАТО-ПВК «Атлантик Шилд» заходить літаком, потрібна рівна ділянка
      ['mountains']         // націоналісти — «Легіон «Вовк»» заходить гірським перевалом
    ];
    const NAME_BY_TERRAIN = {
      coast: 'Порт',
      mountains: 'Гірський перевал',
      forest: 'Лісова стежка',
      denseForest: 'Лісова стежка',
      swamp: 'Стежка через болото'
    };
    const COUNTRY_SUFFIX = [' «Росія»', ' «НАТО»', ''];

    function findBest(f, wantKeys) {
      let best = -1, bestScore = -1;
      for (let i = 0; i < N; i++) {
        if (map.control[i] !== f || map.river[i]) continue;
        const terr = CONFIG.terrain[map.terrain[i]].key;
        if (terr === 'sea') continue;
        if (wantKeys && !wantKeys.includes(terr)) continue;
        const col = grid.col(i), row = grid.row(i);
        const onEdge = col === 0 || col === grid.w - 1 || row === 0 || row === grid.h - 1;
        const score = (onEdge ? 1000 : 0) + grid.dist(i, seeds[f]);
        if (score > bestScore) { bestScore = score; best = i; }
      }
      return best;
    }

    function midCoast() {
      let best = -1, bs = Infinity;
      for (let i = 0; i < N; i++) {
        if (map.control[i] !== 0 || map.river[i] || CONFIG.terrain[map.terrain[i]].key !== 'coast') continue;
        const row = grid.row(i);
        if (row < 8 || row > grid.h - 9 || grid.dist(i, seeds[0]) < 12) continue;
        const sc = Math.abs(row - grid.h / 2) * 10 + (map.road[i] ? 0 : 1);
        if (sc < bs) { bs = sc; best = i; }
      }
      return best;
    }

    const idx = [-1, -1, -1];
    const names = ['', '', ''];
    for (let f = 0; f < 3; f++) {
      // 1. шукаємо гекс найбажанішого для цього патрона типу місцевості у власній території;
      // 2. якщо такого немає — беремо будь-який прохідний гекс своєї території (як раніше).
      // Рішення автора: порт СВ — не на краю карти й не біля самого міста, а на узбережжі ближче
      // до середини карти (по вертикалі), не ближче 12 гексів до міста й 8 рядків до краю.
      let i = f === 0 ? midCoast() : -1;
      if (i < 0) i = findBest(f, PREF[f]);
      if (i < 0) i = findBest(f, null);
      idx[f] = i;
      if (i < 0) { names[f] = patron(f) ? patron(f).entryName : 'Прикордонний перехід'; continue; }
      // Аеродром НАТО — споруда, яку патрон сам будує на знайденій рівній ділянці, тож
      // його назва не залежить від того, яка саме місцевість трапилась (завжди «Аеродром»),
      // на відміну від порту й гірського перевалу, які прив'язані саме до місцевості.
      if (f === 1) { names[f] = `Аеродром${COUNTRY_SUFFIX[f]}`; continue; }
      const terr = CONFIG.terrain[map.terrain[i]].key;
      const base = NAME_BY_TERRAIN[terr] || 'Прикордонна дорога';
      names[f] = f === 2 ? base : `${base}${COUNTRY_SUFFIX[f]}`;
    }
    return { idx, names };

    function patron(f) { return CONFIG.geopolitics && CONFIG.geopolitics.patrons[f]; }
  },

  bfsHexes(grid, map, start, faction) {
    const seen = new Uint8Array(grid.size);
    const out = [];
    const q = [start]; seen[start] = 1;
    while (q.length) {
      const i = q.shift();
      if (map.terrain[i] !== TERRAIN_ID.sea && !map.river[i] && map.control[i] === faction) out.push(i);
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(i, d);
        if (n >= 0 && !seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return out;
  }
};
