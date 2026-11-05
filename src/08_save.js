// ============================================================================
// МОДУЛЬ: ЗБЕРЕЖЕННЯ — СЕРІАЛІЗАЦІЯ, ПЕРЕВІРКА, ВЕРСІЇ, СЛОТИ
// ============================================================================
const SaveSystem = (() => {
  const MAP_ARRAYS = {
    terrain: Uint8Array, river: Uint8Array, bridge: Uint8Array, road: Uint8Array,
    roadDirs: Uint8Array, control: Int8Array, settlement: Int16Array, region: Uint8Array, shelter: Uint8Array
  };
  const SLOT_KEYS = ['auto', 'slot1', 'slot2', 'slot3'];
  const PREFIX = 'yugotaria.cw.';

  function serialize(state) {
    const map = {};
    for (const [k, v] of Object.entries(state.map)) {
      map[k] = (v && v.buffer instanceof ArrayBuffer) ? Array.from(v) : v;
    }
    const out = Object.assign({}, state, { map, savedAt: Date.now() });
    out.format = CONFIG.saveFormat;
    out.version = CONFIG.saveVersion;
    return JSON.stringify(out);
  }

  // Міграції між версіями формату: migrations[n] переводить версію n у n+1
  const migrations = {
    // v1 (етап 1) -> v2 (етап 2): бій, мораль, розвідка
    1(raw) {
      raw.intel = [{}, {}, {}];
      raw.prisoners = [];
      raw.lost = [];
      raw.lastCombat = null;
      for (const u of raw.units || []) if (u && typeof u === 'object') Scenario.addStage2Fields(u);
      for (const e of raw.log || []) if (e && e.vis === undefined) e.vis = null;
      raw.version = 2;
      return raw;
    },
    // v7 -> v8: набір підрозділів, національні ополчення, підпілля, чорний ринок
    7(raw) {
      raw.formations = raw.formations || [];
      raw.market = raw.market || [];
      raw.version = 8;
      return raw;
    },
    // v6 -> v7: інженери, важка зброя, цивільна й трофейна техніка, автопарк
    6(raw) {
      const N = raw.map.w * raw.map.h;
      if (!Array.isArray(raw.map.shelter)) raw.map.shelter = new Array(N).fill(0);
      for (const u of raw.units || []) if (u && typeof u === 'object') Scenario.addStage2Fields(u);
      for (const c of Object.values(raw.caches || {})) {
        if (!c.vehicles) c.vehicles = (c.wrecks || []).map(model => ({ type: Object.keys(CONFIG.unitTypes).find(k => CONFIG.unitTypes[k].vehicle && CONFIG.unitTypes[k].vehicle.model === model) || 'veh_uaz', model, wreck: true, condition: 0, fuel: 0, weapons: {}, from: -1 }));
      }
      raw.projects = raw.projects || [];
      Field.placeMotorpool(raw);
      raw.version = 7;
      return raw;
    },
    // v5 -> v6: населення, дипломатія, події, цілі перемоги
    5(raw) {
      Politics.init(raw);
      raw.version = 6;
      return raw;
    },
    // v4 -> v5: склади, шпиталі, підприємства, економіка
    4(raw) {
      for (const u of raw.units || []) if (u && typeof u === 'object') Scenario.addStage2Fields(u);
      raw.facilities = [];
      raw.nextFacilityId = 1;
      Logistics.placeScenario(raw);
      Logistics.ensureEconomy(raw);
      raw.version = 5;
      return raw;
    },
    // v3 -> v4: місця боїв і трофеї
    3(raw) {
      raw.caches = raw.caches || {};
      for (const u of raw.units || []) if (u && typeof u === 'object' && !u.cargo) u.cargo = { weapons: {}, ammo: {} };
      raw.version = 4;
      return raw;
    },
    // v2 -> v3: транспорт і реорганізація
    2(raw) {
      for (const u of raw.units || []) if (u && typeof u === 'object') { if (u.embarked === undefined) u.embarked = null; if (!Array.isArray(u.carrying)) u.carrying = []; }
      raw.version = 3;
      return raw;
    }
  };

  function deserialize(text) {
    const errors = [];
    let raw;
    try { raw = typeof text === 'string' ? JSON.parse(text) : text; }
    catch (e) { return { ok: false, errors: ['Файл не є коректним JSON: ' + e.message] }; }
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Порожній або пошкоджений файл.'] };
    if (raw.format !== CONFIG.saveFormat) return { ok: false, errors: ['Це не файл збереження Yugotaria: Civil War.'] };
    if (typeof raw.version !== 'number') return { ok: false, errors: ['Не вказано версію формату збереження.'] };
    if (raw.version > CONFIG.saveVersion) {
      return { ok: false, errors: [`Збереження створене новішою версією гри (формат ${raw.version}, підтримується до ${CONFIG.saveVersion}).`] };
    }
    const notes = [];
    while (raw.version < CONFIG.saveVersion) {
      const m = migrations[raw.version];
      if (!m) return { ok: false, errors: [`Немає перетворення для формату версії ${raw.version}.`] };
      raw = m(raw);
      notes.push(`Збереження оновлено до формату ${raw.version}.`);
    }

    // --- перевірка структури
    const m = raw.map;
    if (!m || !Number.isInteger(m.w) || !Number.isInteger(m.h) || m.w < 4 || m.h < 4 || m.w * m.h > 4000000) {
      return { ok: false, errors: ['Пошкоджені розміри карти.'] };
    }
    const N = m.w * m.h;
    for (const k of Object.keys(MAP_ARRAYS)) {
      if (!Array.isArray(m[k]) || m[k].length !== N) errors.push(`Шар карти «${k}» відсутній або має неправильну довжину.`);
    }
    if (Array.isArray(m.terrain) && m.terrain.some(t => !Number.isInteger(t) || t < 0 || t >= CONFIG.terrain.length)) errors.push('Невідомий тип місцевості в карті.');
    if (!Array.isArray(m.settlements)) errors.push('Відсутній список населених пунктів.');
    if (!raw.time || !Number.isInteger(raw.time.day) || !Number.isInteger(raw.time.hour) || raw.time.hour < 0 || raw.time.hour > 23) errors.push('Пошкоджений ігровий час.');
    if (!Number.isInteger(raw.phase) || raw.phase < 0 || raw.phase > 2) errors.push('Пошкоджена поточна фаза.');
    if (!Array.isArray(raw.units)) errors.push('Відсутній список підрозділів.');
    else {
      const ids = new Set();
      raw.units.forEach((u, n) => {
        const where = `Підрозділ №${n + 1}`;
        if (!u || typeof u !== 'object') { errors.push(`${where}: пошкоджений запис.`); return; }
        if (!CONFIG.unitTypes[u.type]) errors.push(`${where}: невідомий тип «${u.type}».`);
        if (!Number.isInteger(u.faction) || u.faction < 0 || u.faction > 2) errors.push(`${where}: невідома фракція.`);
        if (!Number.isInteger(u.idx) || u.idx < 0 || u.idx >= N) errors.push(`${where}: позиція поза картою.`);
        if (!u.personnel || typeof u.personnel.fit !== 'number') errors.push(`${where}: немає даних про особовий склад.`);
        if (ids.has(u.id)) errors.push(`${where}: повторний ідентифікатор ${u.id}.`);
        ids.add(u.id);
        if (u.embarked != null && !raw.units.some(v => v && v.id === u.embarked && Array.isArray(v.carrying) && v.carrying.includes(u.id))) errors.push(`${where}: пошкоджені дані посадки.`);
        if (u.order && (!Array.isArray(u.order.path) || u.order.path.some(i => !Number.isInteger(i) || i < 0 || i >= N))) errors.push(`${where}: пошкоджений маршрут наказу.`);
      });
    }
    if (!Array.isArray(raw.log)) errors.push('Відсутній журнал.');
    if (!Array.isArray(raw.intel) || raw.intel.length !== 3) errors.push('Пошкоджені дані розвідки.');
    if (!Array.isArray(raw.prisoners) || !Array.isArray(raw.lost)) errors.push('Пошкоджені дані про полонених або втрати.');
    if (!Array.isArray(raw.facilities) || raw.facilities.some(f => !f || !CONFIG.facilities[f.type] || !Number.isInteger(f.idx) || f.idx < 0 || f.idx >= N || !f.stock)) errors.push('Пошкоджені дані про склади та підприємства.');
    if (!Array.isArray(raw.economy) || raw.economy.length !== 3) errors.push('Пошкоджені економічні дані.');
    if (!raw.diplomacy || !raw.diplomacy.rel || !Array.isArray(raw.diplomacy.proposals)) errors.push('Пошкоджені дипломатичні дані.');
    if (!raw.campaign || !Array.isArray(raw.campaign.objectives) || !Array.isArray(raw.events)) errors.push('Пошкоджені дані кампанії.');
    if (Array.isArray(m.settlements) && m.settlements.some(s => !s.pop || !s.support)) errors.push('Пошкоджені дані про населення.');
    if (!raw.caches || typeof raw.caches !== 'object' || Object.values(raw.caches).some(c => !c || !Number.isInteger(c.idx) || c.idx < 0 || c.idx >= N || !Array.isArray(c.dead))) errors.push('Пошкоджені дані про місця боїв.');
    if (Array.isArray(raw.units)) raw.units.forEach((u, n) => {
      if (u && (typeof u.morale !== 'number' || u.morale < 0 || u.morale > 100)) errors.push(`Підрозділ №${n + 1}: некоректна мораль.`);
      if (u && (!u.acc || typeof u.suppression !== 'number')) errors.push(`Підрозділ №${n + 1}: відсутні бойові дані.`);
    });
    if (errors.length) return { ok: false, errors };

    // --- відновлення
    const map = Object.assign({}, m);
    for (const [k, T] of Object.entries(MAP_ARRAYS)) map[k] = T.from(m[k]);
    const state = Object.assign({}, raw, { map });
    delete state.savedAt;
    // Сумісність зі старими збереженнями (до ротації порядку фаз): немає phaseOrder або він
    // пошкоджений — початковий порядок [0,1,2].
    if (!Array.isArray(state.phaseOrder) || state.phaseOrder.length !== 3 || [0, 1, 2].some(f => !state.phaseOrder.includes(f))) state.phaseOrder = [0, 1, 2];
    // Сумісність зі старими збереженнями (до прикордонних переходів/ПВК/добровольців): немає
    // map.borderEntry — вважаємо, що переходів немає (Foreign.borderReason тоді нічого не блокує).
    if (!Array.isArray(state.map.borderEntry) || state.map.borderEntry.length !== 3) state.map.borderEntry = [-1, -1, -1];
    if (!Array.isArray(state.map.borderEntryName) || state.map.borderEntryName.length !== 3) state.map.borderEntryName = [null, null, null];
    if (!Array.isArray(state.geo) || state.geo.length !== 3) state.geo = CONFIG.geopolitics.startRelation.slice();
    // Старі збереження без аеропорту ДП — будуємо його на місці аеродрому (якщо перехід є)
    if (state.facilities && typeof Air !== 'undefined' && !Air.airport(state, 1) && state.map.borderEntry[1] >= 0) Air.placeAirport(state);
    return { ok: true, state, notes, savedAt: raw.savedAt || null };
  }

  // ----------------------------------------------------- локальне сховище
  function storage() {
    try {
      const s = window.localStorage;
      const t = PREFIX + '__test';
      s.setItem(t, '1'); s.removeItem(t);
      return s;
    } catch (e) { return null; }
  }

  function slotName(key) { return key === 'auto' ? 'Автозбереження' : 'Слот ' + key.slice(4); }

  function listSlots() {
    const s = storage();
    return SLOT_KEYS.map(key => {
      const entry = { key, name: slotName(key), empty: true };
      if (!s) return entry;
      try {
        const metaText = s.getItem(PREFIX + key + '.meta');
        if (metaText) Object.assign(entry, JSON.parse(metaText), { empty: false });
      } catch (e) { entry.broken = true; }
      return entry;
    });
  }

  function saveToSlot(key, state) {
    const s = storage();
    if (!s) return { ok: false, reason: 'Сховище браузера недоступне. Скористайтеся експортом у файл.' };
    try {
      const data = serialize(state);
      s.setItem(PREFIX + key, data);
      s.setItem(PREFIX + key + '.meta', JSON.stringify({
        savedAt: Date.now(), day: state.time.day, hour: state.time.hour, phase: state.phase,
        scenario: state.meta.scenario, units: state.units.length, bytes: data.length
      }));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'Не вдалося записати збереження (можливо, сховище переповнене): ' + e.message };
    }
  }

  function loadFromSlot(key) {
    const s = storage();
    if (!s) return { ok: false, errors: ['Сховище браузера недоступне.'] };
    let text;
    try { text = s.getItem(PREFIX + key); } catch (e) { return { ok: false, errors: ['Помилка читання сховища: ' + e.message] }; }
    if (!text) return { ok: false, errors: ['Слот порожній.'] };
    return deserialize(text);
  }

  function deleteSlot(key) {
    const s = storage();
    if (!s) return { ok: false };
    try { s.removeItem(PREFIX + key); s.removeItem(PREFIX + key + '.meta'); } catch (e) { return { ok: false }; }
    return { ok: true };
  }

  return { serialize, deserialize, listSlots, saveToSlot, loadFromSlot, deleteSlot, slotName, storageAvailable: () => !!storage() };
})();
