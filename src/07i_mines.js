// ============================================================================
// МОДУЛЬ: МІННІ ПОЛЯ
// Інженери закладають протипіхотні (ПМН-2) і протитанкові (ТМ-62М) міни в гексі
// (Field.js керує самим інженерним проєктом — час, матеріали; цей модуль — дані
// мінного поля й те, що стається, коли хтось туди заходить). Свої міни підрозділ
// не чіпає (знає, де вони); чужий — чи то ворог, чи просто інша фракція — може
// на них наступити. Частина поля детонує й витрачається за прохід, решта лишається.
// ============================================================================
const Mines = (() => {
  const M = () => CONFIG.mines;
  const E = () => CONFIG.engineering;

  function store(state) { if (!state.map.mines) state.map.mines = {}; return state.map.mines; }
  function fieldAt(state, idx) { return store(state)[idx] || null; }

  // ---------------------------------------------------- Єгоза (запит гравця)
  // Загородження з колючого дроту (АКЛ) — не завдає шкоди (як міни), а стримує: чужий підрозділ,
  // що входить у гекс, витрачає частину ОР на подолання (своїм — безкоштовно); будь-хто, хто
  // захищається в гексі, отримує бонус cover (07_combat.js coverOf), незалежно від власника
  // загородження (як і бліндаж — суто місцевий фактор). Ставить і піхота, і інженери
  // (07f_field.js wireReason/layWireField — не через canEngineer).
  function wireStore(state) { if (!state.map.wire) state.map.wire = {}; return state.map.wire; }
  function wireAt(state, idx) { return wireStore(state)[idx] || null; }
  function wireCapLeft(state, faction, idx) {
    const f = wireAt(state, idx);
    const have = (f && f[faction]) || 0;
    return Math.max(0, E().wire.max - have);
  }
  function wireLevelAt(state, idx) {
    const f = wireAt(state, idx);
    if (!f) return 0;
    return Object.values(f).reduce((a, b) => a + b, 0);
  }
  function layWire(state, faction, idx, n) {
    const s = wireStore(state);
    if (!s[idx]) s[idx] = {};
    const def = E().wire;
    s[idx][faction] = Math.min(def.max, (s[idx][faction] || 0) + n);
    if (!state.map.wireLevel) state.map.wireLevel = new Array(state.map.terrain.length).fill(0);
    state.map.wireLevel[idx] = wireLevelAt(state, idx);
    Engine.log(state, `${Engine.fname(faction)}: встановили «Єгозу» у ${Engine.grid(state).label(idx)} — рівень ${s[idx][faction]}.`, 'info', faction, [faction]);
  }

  // Скільки ще мін цього типу можна закласти в гексі даній фракції, не перевищивши максимум
  function capLeft(state, faction, idx, kind) {
    const f = fieldAt(state, idx);
    const have = (f && f[faction] && f[faction][kind]) || 0;
    return Math.max(0, E()[kind === 'ap' ? 'mineAp' : 'mineAt'].max - have);
  }
  // Чи є в гексі міни ЧУЖОЇ фракції (є що розміновувати для faction)
  function anyForeign(state, faction, idx) {
    const f = fieldAt(state, idx);
    if (!f) return false;
    return Object.entries(f).some(([owner, n]) => Number(owner) !== faction && ((n.ap || 0) > 0 || (n.at || 0) > 0));
  }

  function lay(state, faction, idx, kind, n) {
    const s = store(state);
    if (!s[idx]) s[idx] = {};
    if (!s[idx][faction]) s[idx][faction] = { ap: 0, at: 0 };
    const def = E()[kind === 'ap' ? 'mineAp' : 'mineAt'];
    s[idx][faction][kind] = Math.min(def.max, s[idx][faction][kind] + n);
    Engine.log(state, `${Engine.fname(faction)}: заклали мінне поле (${def.name.toLowerCase()}) у ${Engine.grid(state).label(idx)} — тепер ${s[idx][faction][kind]} шт.`, 'info', faction, [faction]);
  }

  // Розмінування: знешкоджує до `n` чужих мін у гексі (АП і ПТ разом), почергово
  function clear(state, idx, n) {
    const s = store(state);
    const f = s[idx];
    if (!f) return 0;
    let left = n, cleared = 0;
    for (const owner of Object.keys(f)) {
      for (const kind of ['ap', 'at']) {
        if (left <= 0) break;
        const have = f[owner][kind] || 0;
        const take = Math.min(have, left);
        if (take > 0) { f[owner][kind] -= take; left -= take; cleared += take; }
      }
    }
    for (const owner of Object.keys(f)) if (!f[owner].ap && !f[owner].at) delete f[owner];
    if (!Object.keys(f).length) delete s[idx];
    return cleared;
  }

  // Підрозділ u входить у гекс idx (вже стоїть там: u.idx===idx) — перевіряємо чужі міни.
  // Повертає короткий звіт (для логу) або null, якщо нічого не спрацювало.
  function checkTrigger(state, u) {
    const s = store(state);
    const f = s[u.idx];
    const grid = Engine.grid(state);
    const lines = [];
    let destroyed = false;
    if (f) {
      for (const ownerKey of Object.keys(f)) {
        const owner = Number(ownerKey);
        if (owner === u.faction) continue;   // свої міни не зачіпають
        const rec = f[ownerKey];
        const mcfg = M();
        // протипіхотні — по живій силі
        if (rec.ap > 0 && u.personnel && u.personnel.fit > 0) {
          const n = Math.max(1, Math.round(rec.ap * mcfg.triggerShare));
          rec.ap = Math.max(0, rec.ap - n);
          const casRaw = n * mcfg.apCasualtyPerMine;
          const r = Combat.inflict(state, u, casRaw);
          if (r.cas > 0) {
            u.suppression = Math.min(100, u.suppression + 10 * n);
            lines.push(`протипіхотні міни (${n} спрацювало): уражено ${r.cas} (загинули ${r.killed}, поранені ${r.wounded})`);
          } else lines.push(`протипіхотні міни (${n} спрацювало): без втрат`);
        }
        // протитанкові — лише по техніці
        if (rec.at > 0 && u.vehicle) {
          const n = Math.max(1, Math.round(rec.at * mcfg.triggerShare));
          rec.at = Math.max(0, rec.at - n);
          const dmg = n * mcfg.atDamagePerMine;
          u.vehicle.condition = Math.max(0, u.vehicle.condition - dmg);
          lines.push(`протитанкові міни (${n} спрацювало): техніка −${Math.round(dmg)}% (стан ${u.vehicle.condition}%)`);
          if (u.vehicle.condition <= 0) { destroyed = true; lines.push('МАШИНУ ЗНИЩЕНО'); }
        }
        if (!rec.ap && !rec.at) delete f[ownerKey];
      }
      if (!Object.keys(f).length) delete s[u.idx];
    }
    // Єгоза (чуже загородження): не шкодить, лише забирає частину ОР на подолання.
    const wf = wireAt(state, u.idx);
    if (wf) {
      for (const ownerKey of Object.keys(wf)) {
        const owner = Number(ownerKey);
        if (owner === u.faction) continue;
        const lvl = wf[ownerKey];
        if (lvl > 0 && u.mp > 0) {
          const malus = Math.min(u.mp, lvl * E().wire.enemyMpPenalty);
          if (malus > 0) { u.mp -= malus; lines.push(`«Єгоза» (рівень ${lvl}): витрачено додатково ${Engine.fmt(malus)} ОР на подолання загородження`); }
        }
      }
    }
    // Блокпост противника: колона зупиняється на перевірці/під вогнем поста
    for (const cp of Logistics.facilityAt(state, u.idx)) {
      if (cp.type !== 'checkpoint' || cp.owner === u.faction || cp.owner < 0 || Politics.allied(state, cp.owner, u.faction)) continue;
      const malus = Math.min(u.mp, E().checkpoint.enemyMpPenalty);
      u.mp -= malus;
      lines.push(`блокпост «${CONFIG.factions[cp.owner].short}» — рух зупинено${malus > 0 ? `, витрачено ${Engine.fmt(malus)} ОР` : ''}`);
    }
    if (!lines.length) return null;
    const text = `ПЕРЕШКОДА: ${u.name} у ${grid.label(u.idx)} — ${lines.join('; ')}.`;
    Engine.log(state, text, 'alert', u.faction, [u.faction], { at: u.idx, uid: u.id });
    if (destroyed) { u.destroyed = true; Transport.wreck(state, u, []); Combat.cleanup(state); }
    return { destroyed, lines };
  }

  return { store, fieldAt, capLeft, anyForeign, lay, clear, checkTrigger, wireStore, wireAt, wireCapLeft, wireLevelAt, layWire };
})();
