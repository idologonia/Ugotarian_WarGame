// ============================================================================
// МОДУЛЬ: КАРТИНА ФРАКЦІЇ ДЛЯ ОНЛАЙН-ГРИ (строгий туман війни)
// Сервер тримає повний стан; кожен гравець отримує лише те, що знає його фракція:
// свої й союзні підрозділи; противника — тільки видимого зараз, і лише те, що видно
// ззовні (позиція, клас техніки, позиції/укріплення, оцінка чисельності з розвідки);
// свою економіку, розвідку, журнал, накази, черги, рішення. Невидимі ворожі підрозділи,
// чужі запаси, міни, плани й розвіддані до браузера не потрапляють узагалі.
// Клієнт на картині нічого не симулює: усі накази виконує сервер (85_net.js).
// ============================================================================
const View = (() => {
  const MAP_ARRAYS = {
    terrain: Uint8Array, river: Uint8Array, bridge: Uint8Array, road: Uint8Array,
    roadDirs: Uint8Array, control: Int8Array, settlement: Int16Array, region: Uint8Array, shelter: Uint8Array
  };
  const LOG_KEEP = 1500;
  const emptyStock = () => ({ ammo: {}, weapons: {}, goods: {} });

  // Видимий ворог: лише зовнішні ознаки. Тип — справжній, якщо розвідка його впізнала;
  // інакше — узагальнений за класом (піхота / колісна / броньована техніка).
  function enemyStub(u, rec) {
    const ut = CONFIG.unitTypes[u.type];
    const veh = !!ut.vehicle;
    let type = u.type;
    if (!rec || !rec.type) type = veh ? (ut.vehicle.armor === 'armored' ? 'veh_mtlb' : 'veh_uaz') : 'inf_squad';
    const fit = rec && rec.fit != null ? rec.fit : CONFIG.unitTypes[type].personnel;
    const vt = CONFIG.unitTypes[type].vehicle;
    return {
      id: u.id, faction: u.faction, type, idx: u.idx, name: rec ? rec.label : (veh ? 'Невідома техніка' : 'Невідомий підрозділ'),
      personnel: { assigned: fit, fit, wounded: 0, killed: 0, captured: 0, missing: 0, straggling: 0 },
      morale: 50, baseMorale: 50, experience: 0, xp: 0, weapons: {}, ammo: {}, cargo: { weapons: {}, ammo: {}, goods: {} },
      stance: u.stance === 'ambush' ? 'none' : u.stance, fort: u.fort || 0, deployed: !!u.deployed, mount: u.mount || null,
      order: null, pendingOrder: null, mp: 0, embarked: null, carrying: [], suppression: 0, dispersal: 0,
      vehicle: vt ? { model: vt.model, fuel: 0, fuelMax: vt.fuelMax, condition: 100, passengers: vt.passengers } : null,
      comm: { connected: false }, lastReport: null, stub: true
    };
  }

  function make(state, f) {
    const raw = JSON.parse(SaveSystem.serialize(state));
    delete raw.savedAt;
    const allied = x => x === f || (typeof Politics !== 'undefined' && state.diplomacy && Politics.allied(state, f, x));
    const vis = Intel.visibleIds(state, f);
    const intel = (state.intel && state.intel[f]) || {};
    raw.units = raw.units.filter(u => allied(u.faction) || (vis.has(u.id) && u.embarked == null))
      .map(u => allied(u.faction) ? u : enemyStub(u, intel[u.id]));
    raw.lost = (raw.lost || []).filter(u => u.faction === f);
    raw.intel = [0, 1, 2].map(x => (x === f ? raw.intel[f] : {}));
    raw.log = (raw.log || []).filter(e => e.vis == null || e.vis.includes(f)).slice(-LOG_KEEP);
    // місця боїв — лише відомі; об’єкти — свої або відомі (чужі без запасів)
    const caches = {};
    for (const [k, c] of Object.entries(raw.caches || {})) if ((c.knownBy || []).includes(f)) caches[k] = c;
    raw.caches = caches;
    raw.facilities = (raw.facilities || []).filter(x => x.owner === f || (x.knownBy || []).includes(f)).map(x => {
      if (x.owner === f) return x;
      return Object.assign({}, x, { stock: emptyStock(), patients: 0, captureHold: null });
    });
    raw.economy = (raw.economy || []).map((e, x) => (x === f ? e : { money: 0, manpower: 0, manAcc: 0, deadOfWounds: 0, recovered: 0, last: null }));
    if (raw.diplomacy) raw.diplomacy.proposals = raw.diplomacy.proposals.filter(p => p.from === f || p.to === f);
    for (const k of ['foreignOrders', 'officialOrders', 'rfSales', 'formations', 'investOrders', 'convoys', 'projects', 'market']) {
      if (Array.isArray(raw[k])) raw[k] = raw[k].filter(o => o.faction === f);
    }
    raw.prisoners = (raw.prisoners || []).filter(p => p.holder === f || p.origin === f);
    if (raw.uav) raw.uav = { [f]: raw.uav[f] };
    if (raw.decisions) {
      raw.decisions.active = raw.decisions.active.map((a, x) => (x === f ? a : null));
      raw.decisions.done = raw.decisions.done.map((d, x) => (x === f ? d : []));
      raw.decisions.history = (raw.decisions.history || []).filter(h => h.f === f);
      raw.decisions.watch = [];
    }
    raw.civColumns = (state.civColumns || []).filter(c => typeof Civil === 'undefined' || Civil.visibleTo(state, f, c)).map(c => Object.assign({}, c));
    // міни й «єгоза» — лише свої (чужі невидимі; гравець дізнається, наступивши)
    const own = obj => { const o = {}; for (const [idx, byF] of Object.entries(obj || {})) if (byF && byF[f] != null) o[idx] = { [f]: byF[f] }; return o; };
    raw.map.mines = own(raw.map.mines);
    raw.map.wire = own(raw.map.wire);
    if (raw.lastCombat && !(raw.lastCombat.visibleTo || []).includes(f)) raw.lastCombat = null;
    delete raw.ai;
    if (Array.isArray(raw.geo)) raw.geo = raw.geo.map((x, i) => (i === f ? x : null));   // чужі стосунки зі спонсорами
    raw.view = { faction: f, visible: [...vis], rev: state.rev || 0 };
    return raw;
  }

  // Клієнт: відновити типізовані масиви карти
  function restore(raw) {
    const map = Object.assign({}, raw.map);
    for (const [k, T] of Object.entries(MAP_ARRAYS)) if (Array.isArray(map[k])) map[k] = T.from(map[k]);
    return Object.assign({}, raw, { map });
  }

  // Відповідь сервера на наказ: об’єкти-підрозділи замінюємо коротким описом (щоб не
  // передати разом із результатом деталі противника), решту лишаємо як є
  function sanitize(value, f) {
    const seen = new WeakSet();
    const walk = v => {
      if (v == null || typeof v !== 'object') return v;
      if (seen.has(v)) return null;
      seen.add(v);
      if (ArrayBuffer.isView(v)) return Array.from(v);
      if (Array.isArray(v)) return v.map(walk);
      if (v.personnel && v.faction != null && v.idx != null && v.type) return { id: v.id, name: v.faction === f ? v.name : 'противник', faction: v.faction, idx: v.idx };
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    };
    return walk(value);
  }

  return { make, restore, sanitize, enemyStub };
})();
