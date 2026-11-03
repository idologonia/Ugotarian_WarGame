// ============================================================================
// МОДУЛЬ: ІНЖЕНЕРНІ РОБОТИ ТА ТЕХНІКА (блок А)
// Понтонні мости, укриття, ремонт об’єктів, підрив мостів, відновлення
// уламків; покинута техніка як трофей; реквізиція цивільних машин;
// військовий автопарк; встановлення кулемета чи АГС на техніку.
// ============================================================================
const Field = (() => {
  const E = () => CONFIG.engineering;
  const g = s => Engine.grid(s);
  const fname = f => CONFIG.factions[f].name;
  const ABBR = ['СВ', 'ДП', 'НП'];

  function projects(state) { if (!state.projects) state.projects = []; return state.projects; }
  function projectOf(state, u) { return u.project ? projects(state).find(p => p.id === u.project) || null : null; }

  // ---------------------------------------------- матеріали з постачання
  // Інженерне майно/запчастини: вантаж машини в гексі або склад мережі (у зоні постачання)
  function findGoods(state, u, key, need) {
    for (const v of state.units) {
      if (v.faction !== u.faction || v.idx !== u.idx || !v.cargo || !v.cargo.goods) continue;
      if ((v.cargo.goods[key] || 0) >= need) return { from: v.name, take: () => { v.cargo.goods[key] -= need; } };
    }
    for (const f of Logistics.storesNear(state, u)) if ((f.stock.goods[key] || 0) >= need) return { from: f.name, take: () => { f.stock.goods[key] -= need; } };
    const net = Logistics.network(state, u.faction);
    if (net.dist[u.idx] >= 0) {
      const st = net.stores.filter(f => (f.stock.goods[key] || 0) >= need).sort((a, b) => g(state).dist(a.idx, u.idx) - g(state).dist(b.idx, u.idx))[0];
      if (st) return { from: st.name, take: () => { st.stock.goods[key] -= need; } };
    }
    return null;
  }

  // ---------------------------------------------------- інженерні роботи
  function canEngineer(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    if (u.type !== 'eng_squad') return 'Інженерні роботи виконує інженерне відділення.';
    if (u.embarked != null) return 'Спершу висадіть відділення.';
    if (u.personnel.fit < 2) return 'Замало боєздатних інженерів.';
    if (u.project) return 'Відділення вже виконує роботу (її можна скасувати наказом «Скасувати наказ»).';
    return null;
  }

  // Доступні роботи для інженерів у поточній позиції
  function options(state, u) {
    const out = [];
    if (canEngineer(state, u)) return out;
    const grid = g(state), m = state.map;
    for (let d = 0; d < 6; d++) {
      const n = grid.neighbor(u.idx, d); if (n < 0) continue;
      if (m.river[n] && !m.bridge[n]) out.push({ type: 'bridge', target: n, label: `${E().bridge.name} у ${grid.label(n)}` });
      if (m.river[n] && m.bridge[n]) out.push({ type: 'demolish', target: n, label: `${E().demolish.name} у ${grid.label(n)}` });
    }
    if (m.river[u.idx] && m.bridge[u.idx]) out.push({ type: 'demolish', target: u.idx, label: `${E().demolish.name} під собою` });
    if ((m.shelter[u.idx] || 0) < E().shelter.max) out.push({ type: 'shelter', target: u.idx, label: `${E().shelter.name} у ${grid.label(u.idx)} (рівень ${(m.shelter[u.idx] || 0) + 1})` });
    // Командний пункт — лише там, де вже є бліндаж, і лише один свій на гекс
    if ((m.shelter[u.idx] || 0) > 0 && !Logistics.facilities(state).some(f => f.type === 'cp' && f.idx === u.idx && f.owner === u.faction && !f.destroyed)) {
      out.push({ type: 'cp', target: u.idx, label: `${E().cp.name} у ${grid.label(u.idx)} (у бліндажі)` });
    }
    if (m.terrain[u.idx] !== TERRAIN_ID.sea) {
      if (Mines.capLeft(state, u.faction, u.idx, 'ap') > 0) out.push({ type: 'mineAp', target: u.idx, label: `${E().mineAp.name} у ${grid.label(u.idx)}` });
      if (Mines.capLeft(state, u.faction, u.idx, 'at') > 0) out.push({ type: 'mineAt', target: u.idx, label: `${E().mineAt.name} у ${grid.label(u.idx)}` });
      if (Mines.anyForeign(state, u.faction, u.idx)) out.push({ type: 'clearMines', target: u.idx, label: `${E().clearMines.name} у ${grid.label(u.idx)}` });
    }
    for (const f of Logistics.facilities(state)) {
      if (f.owner !== u.faction || grid.dist(f.idx, u.idx) > 1) continue;
      if (!Logistics.isStore(f) && f.condition < 100 && f.type !== 'motorpool') out.push({ type: 'repair', target: f.id, label: `${E().repair.name}: ${f.name} (${f.condition}%)` });
    }
    const sid = m.settlement[u.idx];
    if (sid != null && sid >= 0) {
      const s = m.settlements[sid];
      if (s.control === u.faction) {
        const total = Object.values(s.damage).reduce((a, b) => a + b, 0);
        if (total > 0.5) out.push({ type: 'rebuild', target: sid, label: `${E().rebuild.name}: ${s.name} (пошкодження ${Math.round(total / Object.keys(s.damage).length)}%)` });
      }
    }
    const c = Loot.cacheAt(state, u.idx, false);
    if (c && c.vehicles) c.vehicles.forEach((v, i) => { if (v.wreck) out.push({ type: 'restore', target: i, label: `${E().restore.name}: ${CONFIG.unitTypes[v.type].name} (уламки)` }); });
    return out;
  }

  function startProject(state, unitId, type, target) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u) || canEngineer(state, u);
    if (err) return { ok: false, reason: err };
    const opt = options(state, u).find(o => o.type === type && o.target === target);
    if (!opt) return { ok: false, reason: 'Ця робота тут недоступна.' };
    const def = E()[type];
    const need = def.eng ? { key: 'eng', n: def.eng } : def.parts ? { key: 'parts', n: type === 'repair' ? def.parts : def.parts } : def.goods ? { key: def.goods, n: def.n } : null;
    if (need) {
      const src = findGoods(state, u, need.key, need.n);
      if (!src) return { ok: false, reason: `Потрібно ${need.n} компл. «${CONFIG.goods[need.key].name}»: у власному вантажі, у вантажі іншого підрозділу в гексі, на складі поруч або в зоні постачання. Інженери й логістична група можуть самі завантажити це на складі («Завантажити»).` };
      src.take();
      opt.source = src.from;
    }
    if (u.order) u.order = null;
    u.stance = 'none'; u.fort = 0;
    const p = { id: (state.nextProjectId = (state.nextProjectId || 0) + 1), type, target, faction: u.faction, unitId: u.id, at: u.idx, progress: 0, hours: def.hours, label: opt.label, started: { day: state.time.day, hour: state.time.hour } };
    projects(state).push(p);
    u.project = p.id;
    Engine.log(state, `${u.name}: розпочато «${opt.label}» (${def.hours} год${opt.source ? `, матеріали: ${opt.source}` : ''}). Відділення має лишатися на місці.`, 'order', u.faction);
    return { ok: true, id: p.id };
  }

  function cancelProject(state, u, why) {
    const p = projectOf(state, u);
    if (!p) return;
    state.projects = projects(state).filter(x => x !== p);
    u.project = null;
    Engine.log(state, `${u.name}: роботу «${p.label}» перервано${why ? ' — ' + why : ''}. Витрачені матеріали не повертаються.`, 'warn', u.faction);
  }

  function finish(state, p, u) {
    const m = state.map, grid = g(state);
    switch (p.type) {
      case 'bridge': m.bridge[p.target] = 1; break;
      case 'demolish': m.bridge[p.target] = 0; m.road[p.target] = m.road[p.target]; break;
      case 'shelter': m.shelter[p.target] = Math.min(E().shelter.max, (m.shelter[p.target] || 0) + 1); break;
      case 'mineAp': Mines.lay(state, p.faction, p.target, 'ap', E().mineAp.n); break;
      case 'mineAt': Mines.lay(state, p.faction, p.target, 'at', E().mineAt.n); break;
      case 'clearMines': Mines.clear(state, p.target, E().clearMines.cleared); break;
      case 'cp': Logistics.makeFacility(state, 'cp', p.target, p.faction, `Командний пункт (${grid.label(p.target)})`); break;
      case 'restore': {
        const c = Loot.cacheAt(state, p.at, false);
        const v = c && c.vehicles && c.vehicles[p.target];
        if (v && v.wreck) { v.wreck = false; v.condition = E().restore.condition; v.fuel = 0; }
        break;
      }
    }
    Engine.log(state, `${u ? u.name : 'Інженери'}: «${p.label}» завершено.${p.type === 'restore' ? ' Машину можна забрати — потрібен екіпаж.' : ''}`, 'event', p.faction, p.type === 'bridge' || p.type === 'demolish' ? null : [p.faction]);
  }

  function endOfHour(state) {
    const turn = state.time.turn;
    for (const p of projects(state).slice()) {
      const u = Engine.unitById(state, p.unitId);
      if (!u || u.idx !== p.at || u.personnel.fit < 2) { if (u) cancelProject(state, u, 'відділення залишило місце робіт'); else state.projects = projects(state).filter(x => x !== p); continue; }
      if (u.combatTurn === turn) { Engine.log(state, `${u.name}: роботи призупинено через бій.`, 'warn', u.faction); continue; }
      if (p.type === 'repair') {
        const f = Logistics.byId(state, p.target);
        if (!f || f.owner !== u.faction) { cancelProject(state, u, 'об’єкт втрачено'); continue; }
        if (p.progress > 0) {
          const src = findGoods(state, u, 'parts', E().repair.parts);
          if (!src) { cancelProject(state, u, 'закінчилися запчастини'); continue; }
          src.take();
        }
        p.progress++;
        f.condition = Math.min(100, f.condition + E().repair.amount);
        if (f.condition >= 100) { f.offline = Math.min(f.offline, 0); state.projects = projects(state).filter(x => x !== p); u.project = null; Engine.log(state, `${u.name}: «${f.name}» відремонтовано (100%).`, 'event', u.faction); }
        else Engine.log(state, `${u.name}: ремонт «${f.name}» — стан ${f.condition}%.`, 'info', u.faction);
        continue;
      }
      if (p.type === 'rebuild') {
        const s = state.map.settlements[p.target];
        if (!s || s.control !== u.faction) { cancelProject(state, u, 'пункт утрачено'); continue; }
        if (p.progress > 0) {
          const src = findGoods(state, u, 'eng', E().rebuild.eng);
          if (!src) { cancelProject(state, u, 'закінчилося інженерне майно'); continue; }
          src.take();
        }
        p.progress++;
        for (const k of Object.keys(s.damage)) s.damage[k] = Math.max(0, Math.round((s.damage[k] - E().rebuild.amount) * 10) / 10);
        const total = Object.values(s.damage).reduce((a, b) => a + b, 0);
        if (total <= 0) { state.projects = projects(state).filter(x => x !== p); u.project = null; Engine.log(state, `${u.name}: відбудову «${s.name}» завершено — руйнувань не лишилось.`, 'event', u.faction); }
        else Engine.log(state, `${u.name}: відбудова «${s.name}» — середні пошкодження ${Math.round(total / Object.keys(s.damage).length)}%.`, 'info', u.faction);
        continue;
      }
      p.progress++;
      if (p.progress >= p.hours) { state.projects = projects(state).filter(x => x !== p); u.project = null; finish(state, p, u); }
    }
  }

  // ---------------------------------------- покинута техніка й уламки
  const FIXED = m => { const w = CONFIG.weapons[m]; return w && w.holder === false && !w.disposable; };
  // Викликається, коли техніка вибуває (знищена або без екіпажу)
  function leaveVehicle(state, u) {
    const c = Loot.cacheAt(state, u.idx, true);
    if (!c.vehicles) c.vehicles = [];
    const fixed = {};
    for (const [m, n] of Object.entries(u.weapons)) if (FIXED(m) || m === u.mount) { fixed[m] = n; delete u.weapons[m]; }
    const rec = { type: u.type, model: u.vehicle.model, from: u.faction, wreck: !!u.destroyed, condition: u.destroyed ? 0 : u.vehicle.condition, fuel: u.destroyed ? 0 : u.vehicle.fuel, weapons: u.destroyed ? {} : fixed, mount: u.destroyed ? null : u.mount, day: state.time.day, hour: state.time.hour };
    if (!u.destroyed) {
      // боєприпаси до бортової зброї лишаються в машині
      rec.ammo = {};
      for (const m of Object.keys(fixed)) { const cat = CONFIG.weapons[m].ammo; if (u.ammo[cat]) { rec.ammo[cat] = u.ammo[cat]; delete u.ammo[cat]; } }
    }
    // Рішення автора: вантаж машини (набої/майно, завантажені «Завантажити» зі складу) не
    // зникає разом з екіпажем — лишається в гексі як звичайні трофеї, щоб хтось міг забрати
    // («Забрати трофеї») чи розвантажити на склад, а не випаровувався безслідно.
    if (u.cargo) { Loot.add(c.weapons, u.cargo.weapons); Loot.add(c.ammo, u.cargo.ammo); Loot.add(c.goods, u.cargo.goods); u.cargo = { weapons: {}, ammo: {}, goods: {} }; }
    c.vehicles.push(rec);
    return rec;
  }

  function takeReason(state, u, rec) {
    if (!u || !rec) return 'Техніку не знайдено.';
    if (rec.wreck) return 'Це уламки: спершу відновіть машину (інженери).';
    if (u.vehicle) return 'Забрати машину може піший підрозділ (з нього сформують екіпаж).';
    if (u.embarked != null) return 'Спершу висадіть підрозділ.';
    const crew = CONFIG.unitTypes[rec.type].vehicle.crew;
    if (u.personnel.fit < crew) return `Потрібен екіпаж: ${crew} ос. (боєздатних ${u.personnel.fit}).`;
    const cost = Engine.mpMax(u) * CONFIG.loot.actionShare;
    if (u.mp < cost - 1e-9) return `Це займає ${CONFIG.loot.actionShare * 100}% години.`;
    return null;
  }
  function takeVehicle(state, unitId, index) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u);
    if (err) return { ok: false, reason: err };
    const c = Loot.cacheAt(state, u.idx, false);
    const rec = c && c.vehicles ? c.vehicles[index] : null;
    const why = takeReason(state, u, rec);
    if (why) return { ok: false, reason: why };
    const def = CONFIG.unitTypes[rec.type];
    const crew = def.vehicle.crew;
    const v = Scenario.createUnit(state, rec.type, u.faction, u.idx, 1);
    v.name = `${def.short} (трофей) ${ABBR[u.faction]}`;
    v.weapons = {}; v.ammo = {};
    // екіпаж бере частину особистої зброї з підрозділу
    const kit = Loot.give(state, v, pickHolders(u, crew), {});
    for (const [m, n] of Object.entries(rec.weapons || {})) v.weapons[m] = (v.weapons[m] || 0) + n;
    for (const [k, n] of Object.entries(rec.ammo || {})) v.ammo[k] = (v.ammo[k] || 0) + n;
    v.mount = rec.mount || null;
    v.vehicle.condition = rec.condition; v.vehicle.fuel = rec.fuel;
    v.experience = u.experience; v.xp = u.xp; v.morale = u.morale; v.baseMorale = u.baseMorale;
    v.mp = 0; v.movedThisPhase = true;
    u.personnel.fit -= crew; u.personnel.assigned = Math.max(0, u.personnel.assigned - crew);
    u.mp -= Engine.mpMax(u) * CONFIG.loot.actionShare;
    c.vehicles.splice(index, 1);
    state.units.push(v);
    let note = '';
    if (u.personnel.fit <= 0 && u.personnel.assigned <= 0 && u.personnel.wounded <= 0) { state.units = state.units.filter(x => x !== u); note = ` Увесь склад ${u.name} перейшов в екіпаж.`; }
    Engine.log(state, `${u.name}: забрано ${def.vehicle.model} (стан ${rec.condition}%, пальне ${Engine.fmt(rec.fuel)} л). Екіпаж — ${crew} ос.; новий підрозділ ${v.name}.${note}`, 'event', v.faction);
    Intel.update(state);
    return { ok: true, unitId: v.id };
  }
  function pickHolders(u, n) {
    const out = {};
    for (const [m, k] of Object.entries(u.weapons)) {
      if (n <= 0) break;
      if (!Loot.isHolder(m)) continue;
      const t = Math.min(k, n); out[m] = t; n -= t; u.weapons[m] -= t; if (!u.weapons[m]) delete u.weapons[m];
    }
    return out;
  }

  // ---------------------------------------------------- реквізиція
  function requisitionLeft(state, s) {
    const per = CONFIG.requisition.perPeople;
    return Math.max(0, Math.floor(Politics.totalPop(s) / per) - (s.requisitioned || 0));
  }
  function requisitionReason(state, f, s, type) {
    if (!s || !s.pop) return 'Населений пункт не знайдено.';
    if (s.control !== f) return 'Реквізиція можлива лише в підконтрольному пункті.';
    const R = CONFIG.requisition[type];
    if (!R) return 'Невідомий тип машини.';
    if (requisitionLeft(state, s) <= 0) return 'Цивільних машин у пункті більше немає.';
    const eco = Logistics.ensureEconomy(state)[f];
    if (eco.money < R.money) return `Потрібно ${R.money} грн.`;
    const crew = CONFIG.unitTypes[type].vehicle.crew;
    if (eco.manpower < crew) return `Потрібно ${crew} ос. з резерву для екіпажу.`;
    if (Engine.unitsAt(state, s.center).some(u => u.faction !== f)) return 'У центрі пункту противник.';
    return null;
  }
  function requisition(state, f, sid, type) {
    const s = state.map.settlements[sid];
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = requisitionReason(state, f, s, type);
    if (why) return { ok: false, reason: why };
    const R = CONFIG.requisition[type];
    const eco = Logistics.ensureEconomy(state)[f];
    const crew = CONFIG.unitTypes[type].vehicle.crew;
    eco.money -= R.money; eco.manpower -= crew;
    s.requisitioned = (s.requisitioned || 0) + 1;
    Politics.adjustSupport(s, f, -R.support, null, 'реквізиція техніки', state);
    const n = 1 + state.units.concat(state.lost).filter(u => u.faction === f && u.type === type).length;
    const v = Scenario.createUnit(state, type, f, s.center, n);
    v.vehicle.fuel = Math.round(v.vehicle.fuelMax / 2);
    v.experience = 0; v.xp = 0; v.morale = 60; v.baseMorale = 60;
    v.mp = 0; v.movedThisPhase = true;
    const a = Scenario.arsenal[f];
    v.weapons = { [a.carbine]: crew }; v.ammo = Scenario.ammoFor(v.weapons);
    state.units.push(v);
    Engine.log(state, `${s.name}: реквізовано ${CONFIG.unitTypes[type].name.toLowerCase()} (−${R.money} грн, екіпаж ${crew} з резерву). Підтримка мешканців −${R.support}. Залишилось машин: ${requisitionLeft(state, s)}.`, 'event', f);
    Intel.update(state);
    return { ok: true, unitId: v.id };
  }

  // ---------------------------------------------------- автопарк
  function motorpoolReason(state, f, fac, type) {
    if (!fac || fac.type !== 'motorpool' || fac.destroyed) return 'Автопарк не знайдено.';
    if (fac.owner !== f) return 'Це не ваш автопарк.';
    if (!fac.vehicles || !(fac.vehicles[type] > 0)) return 'Таких машин в автопарку немає.';
    const crew = CONFIG.unitTypes[type].vehicle.crew;
    if (Logistics.ensureEconomy(state)[f].manpower < crew) return `Потрібно ${crew} ос. з резерву для екіпажу.`;
    if (Engine.unitsAt(state, fac.idx).some(u => u.faction !== f)) return 'В автопарку противник.';
    return null;
  }
  function issueVehicle(state, f, facId, type) {
    const fac = Logistics.byId(state, facId);
    if (Engine.phaseFaction(state) !== f) return { ok: false, reason: 'Лише у фазі своєї фракції.' };
    const why = motorpoolReason(state, f, fac, type);
    if (why) return { ok: false, reason: why };
    const crew = CONFIG.unitTypes[type].vehicle.crew;
    Logistics.ensureEconomy(state)[f].manpower -= crew;
    fac.vehicles[type]--;
    const n = 1 + state.units.concat(state.lost).filter(u => u.faction === f && u.type === type).length;
    const v = Scenario.createUnit(state, type, f, fac.idx, n);
    v.experience = 0; v.xp = 0; v.mp = 0; v.movedThisPhase = true;
    state.units.push(v);
    Engine.log(state, `«${fac.name}»: видано ${CONFIG.unitTypes[type].name.replace(' (екіпаж)', '')} — ${v.name}, екіпаж ${crew} ос. з резерву. Залишилось: ${fac.vehicles[type]}.`, 'event', f);
    Intel.update(state);
    return { ok: true, unitId: v.id };
  }

  // ---------------------------------------------------- встановлення зброї
  function mountSources(state, v) {
    const out = [];
    for (const f of Logistics.facilities(state)) if (f.idx === v.idx && f.owner === v.faction && !f.destroyed) for (const m of CONFIG.mount.allowed) if ((f.stock.weapons[m] || 0) > 0) out.push({ m, src: f, kind: 'facility' });
    for (const m of CONFIG.mount.allowed) if (v.cargo && (v.cargo.weapons[m] || 0) > 0) out.push({ m, src: v, kind: 'cargo' });
    for (const u of state.units) if (u !== v && u.faction === v.faction && u.idx === v.idx && u.embarked == null) for (const m of CONFIG.mount.allowed) if ((u.weapons[m] || 0) > 0 && !u.vehicle) out.push({ m, src: u, kind: 'unit' });
    return out;
  }
  function mountReason(state, v, m) {
    if (!v || !CONFIG.unitTypes[v.type].mountable) return 'На цю машину не можна встановити зброю (лише пікап або УАЗ).';
    const cost = Engine.mpMax(v) * CONFIG.mount.share;
    if (v.mp < cost - 1e-9) return `Встановлення займає ${CONFIG.mount.share * 100}% години.`;
    if (m && !mountSources(state, v).some(x => x.m === m)) return 'Потрібна зброя на об’єкті в гексі, у вантажі або в підрозділі поруч.';
    return null;
  }
  function mount(state, vehicleId, model) {
    const v = Engine.unitById(state, vehicleId);
    const err = Engine.checkCommandable(state, v) || mountReason(state, v, model);
    if (err) return { ok: false, reason: err };
    const src = mountSources(state, v).find(x => x.m === model);
    const cat = CONFIG.weapons[model].ammo;
    let ammo = 0;
    if (src.kind === 'facility') { src.src.stock.weapons[model]--; ammo = Math.min(CONFIG.weapons[model].basicLoad, src.src.stock.ammo[cat] || 0); src.src.stock.ammo[cat] = (src.src.stock.ammo[cat] || 0) - ammo; }
    else if (src.kind === 'cargo') { v.cargo.weapons[model]--; ammo = Math.min(CONFIG.weapons[model].basicLoad, v.cargo.ammo[cat] || 0); v.cargo.ammo[cat] = (v.cargo.ammo[cat] || 0) - ammo; }
    else { src.src.weapons[model]--; if (!src.src.weapons[model]) delete src.src.weapons[model]; ammo = Math.min(CONFIG.weapons[model].basicLoad, src.src.ammo[cat] || 0); src.src.ammo[cat] -= ammo; }
    const old = v.mount;
    if (old) { const c = Loot.ensureCargo(v); c.weapons[old] = (c.weapons[old] || 0) + 1; }
    Scenario.mountWeapon(v, model, ammo);
    v.mp -= Engine.mpMax(v) * CONFIG.mount.share;
    Engine.log(state, `${v.name}: встановлено ${model} (набоїв ${ammo})${old ? `; ${old} знято у вантаж` : ''}. Тепер це технічка.`, 'order', v.faction);
    return { ok: true };
  }

  // ---------------------------------------------------- бінокль для розвідки (запит гравця)
  function issueBinocularsReason(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    if (u.type !== 'recon') return 'Бінокль видається лише розвідувальній групі.';
    if (u.binoculars) return 'У підрозділу вже є бінокль.';
    if (u.embarked != null) return 'Спершу висадіть групу.';
    const cost = Engine.mpMax(u) * CONFIG.deployShare;
    if (u.mp < cost - 1e-9) return `Отримання спорядження займає ${CONFIG.deployShare * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
    if (!findGoods(state, u, 'bino', 1)) return 'Немає бінокля у вантажі поруч чи на складі в радіусі постачання.';
    return null;
  }
  function issueBinoculars(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u) || issueBinocularsReason(state, u);
    if (err) return { ok: false, reason: err };
    const src = findGoods(state, u, 'bino', 1);
    src.take();
    u.mp -= Engine.mpMax(u) * CONFIG.deployShare;
    u.movedThisPhase = true;
    u.binoculars = true;
    Engine.log(state, `${u.name}: отримано бінокль (із «${src.from}») — дальність спостереження зросла.`, 'order', u.faction);
    return { ok: true };
  }

  // ---------------------------------------------------- Єгоза (запит гравця)
  // «Її може розміщувати і піхота, і інженери» — на відміну від мостів/бліндажів/мін (canEngineer,
  // лише eng_squad) це швидка дія НА МІСЦІ (як збір трофеїв), не черговий інженерний проєкт,
  // тому доступна й бойовій піхоті. Ефект і дані — Mines.wireCapLeft/layWire (07i_mines.js).
  const WIRE_UNITS = ['eng_squad', 'inf_squad', 'inf_platoon', 'mg_team', 'at_team', 'recon'];
  function wireReason(state, u) {
    if (!u) return 'Підрозділ не знайдено.';
    if (!WIRE_UNITS.includes(u.type)) return 'Єгозу ставлять піхота чи інженери.';
    if (u.embarked != null) return 'Спершу висадіть підрозділ.';
    if (u.personnel.fit <= 0) return 'Немає боєздатних бійців.';
    if (Mines.wireCapLeft(state, u.faction, u.idx) <= 0) return `Тут уже максимум загородження (рівень ${E().wire.max}).`;
    const cost = Engine.mpMax(u) * E().wire.actionShare;
    if (u.mp < cost - 1e-9) return `Встановлення «Єгози» займає ${E().wire.actionShare * 100}% години (залишилось ${Engine.fmt(u.mp)} ОР).`;
    if (!findGoods(state, u, 'eng', E().wire.eng)) return `Потрібно ${E().wire.eng} компл. «Інженерне майно» у вантажі поруч або на складі в зоні постачання.`;
    return null;
  }
  function layWireField(state, unitId) {
    const u = Engine.unitById(state, unitId);
    const err = Engine.checkCommandable(state, u) || wireReason(state, u);
    if (err) return { ok: false, reason: err };
    const src = findGoods(state, u, 'eng', E().wire.eng);
    src.take();
    u.mp -= Engine.mpMax(u) * E().wire.actionShare;
    u.movedThisPhase = true;
    Mines.layWire(state, u.faction, u.idx, 1);
    return { ok: true };
  }

  // Автопарк для старих збережень і нових кампаній
  function placeMotorpool(state) {
    if (Logistics.facilities(state).some(f => f.type === 'motorpool')) return;
    const dep = Logistics.facilities(state).find(f => f.type === 'depot' && f.owner === 0);
    if (!dep) return;
    const grid = g(state);
    const used = new Set(Logistics.facilities(state).map(f => f.idx));
    const cand = grid.within(dep.idx, 3).filter(i => state.map.settlement[i] === 0 && !used.has(i) && !state.map.river[i]).sort((a, b) => grid.dist(a, dep.idx) - grid.dist(b, dep.idx) || a - b);
    const idx = cand.length ? cand[0] : dep.idx;
    const f = Logistics.makeFacility(state, 'motorpool', idx, 0, 'Військовий автопарк');
    f.vehicles = { veh_uaz: 4 };
  }

  return { projects, projectOf, options, startProject, cancelProject, endOfHour, canEngineer, leaveVehicle, takeVehicle, takeReason, requisition, requisitionReason, requisitionLeft, issueVehicle, motorpoolReason, mount, mountReason, mountSources, placeMotorpool, findGoods, issueBinoculars, issueBinocularsReason, wireReason, layWireField };
})();
