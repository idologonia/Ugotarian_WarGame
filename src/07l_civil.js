// ============================================================================
// МОДУЛЬ: ЦИВІЛЬНІ КОЛОНИ І БІЖЕНЦІ (запит гравця)
// Люди, що тікають від боїв і руйнувань, виходять із пункту колоною цивільних авто дорогами
// до краю карти (за межі зони конфлікту). Колону видно на карті тим, хто бачить її гекс (або
// на своїй території). Поки діє угода «гуманітарний коридор» для пункту, звідти йде
// організована евакуація — більше людей за годину, і ці колони ПІД ЗАХИСТОМ (зелений коридор).
// Обстріл колони вбиває цивільних, б’є по підтримці стрільця серед населення того пункту й по
// його репутації; обстріл захищеної колони — ще й порушення коридору (як атака в коридорі).
// ============================================================================
const Civil = (() => {
  const CV = () => CONFIG.civil;
  const g = state => Engine.grid(state);

  function columns(state) { if (!state.civColumns) state.civColumns = []; return state.civColumns; }
  function columnsAt(state, idx) { return columns(state).filter(c => c.idx === idx && c.people > 0); }

  // Вартість кроку для цивільних авто: дорогою швидко, полем повільно, річка без мосту — ні
  function stepCost(state, i) {
    const m = state.map;
    const k = CONFIG.terrain[m.terrain[i]].key;
    if (k === 'sea') return Infinity;
    if (m.river[i] && !m.bridge[i]) return Infinity;
    if (m.road[i]) return 1;
    return { plain: 2.5, farmland: 2.5, coast: 2.5, village: 2, city: 2, industrial: 2, forest: 4 }[k] || 6;
  }
  // Куди тікати: найближчий (за дорогою) гекс краю карти на суші
  function escapePath(state, from) {
    const grid = g(state), N = grid.size;
    const isEdge = i => { const c = grid.col(i), r = grid.row(i); return c === 0 || r === 0 || c === grid.w - 1 || r === grid.h - 1; };
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const heap = new MinHeap();
    dist[from] = 0; heap.push(0, from);
    let goal = -1;
    while (heap.size) {
      const cur = heap.pop();
      if (isEdge(cur) && cur !== from) { goal = cur; break; }
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(cur, d); if (n < 0) continue;
        const c = stepCost(state, n); if (!isFinite(c)) continue;
        const nd = dist[cur] + c;
        if (nd < dist[n]) { dist[n] = nd; prev[n] = cur; heap.push(nd, n); }
      }
    }
    if (goal < 0) return [];
    const path = [];
    for (let c = goal; c !== from && c >= 0; c = prev[c]) path.push(c);
    return path.reverse();
  }

  // Вихід людей із пункту: зливаємо з колоною, що ще поруч, або формуємо нову
  function spawn(state, s, people, corridor) {
    people = Math.round(people);
    if (people <= 0) return null;
    const near = columns(state).find(c => c.from === s.id && c.corridor === !!corridor && c.people > 0 && g(state).dist(c.idx, s.center) <= 1);
    if (near) { near.people += people; return near; }
    if (people < CV().minColumn) return null;
    const c = { id: (state.nextCivId = (state.nextCivId || 0) + 1), from: s.id, people, idx: s.center, path: escapePath(state, s.center), corridor: !!corridor, killed: 0, turn: state.time.turn };
    columns(state).push(c);
    const ctl = s.control;
    Engine.log(state, `${s.name}: виїжджає колона ${corridor ? 'евакуації (гуманітарний коридор)' : 'біженців'} — ${people} осіб, ≈${cars(c)} цивільних авто.`, 'event', ctl >= 0 ? ctl : null, null, { at: s.center });
    return c;
  }
  function cars(c) { return Math.max(1, Math.ceil(c.people / CV().peoplePerCar)); }

  // Щогодини: евакуація з пунктів під коридором, рух колон, вихід за межі карти
  function hour(state) {
    for (const s of state.map.settlements) {
      if (!s.pop || !Politics.corridorAt(state, s.id)) continue;
      const n = Math.round(Politics.totalPop(s) * CV().corridorEvacShare);
      if (n <= 0) continue;
      Politics.removePeople(s, n); s.refugees += n; s.evacuated = (s.evacuated || 0) + n;
      spawn(state, s, n, true);
    }
    for (const c of columns(state)) {
      let budget = CV().speed;
      while (c.path.length && budget > 0) {
        const cost = stepCost(state, c.path[0]);
        if (cost > budget && budget < CV().speed) break;
        budget -= cost; c.idx = c.path.shift();
      }
      if (!c.path.length && c.people > 0) {
        const s = state.map.settlements[c.from];
        Engine.log(state, `Колона ${c.corridor ? 'евакуації' : 'біженців'} (${s.name}, ${c.people} осіб) покинула зону конфлікту.`, 'event', s.control >= 0 ? s.control : null, null);
        c.people = 0;
      }
    }
    state.civColumns = columns(state).filter(c => c.people > 0);
  }

  // Обстріл гекса з колоною
  function onFire(state, idx, shooter, fireSoft, indirect) {
    const out = [];
    for (const c of columnsAt(state, idx)) {
      const n = Math.min(c.people, Math.max(1, Math.round(fireSoft * (indirect ? CV().indirectK : CV().directK))));
      c.people -= n; c.killed += n;
      const s = state.map.settlements[c.from];
      Politics.adjustSupport(s, shooter, -(c.corridor ? CV().supportHitCorridor : CV().supportHit), null, 'обстріл колони біженців', state);
      state.diplomacy.reputation[shooter] = Math.max(0, state.diplomacy.reputation[shooter] - (c.corridor ? CV().repHitCorridor : CV().repHit));
      // зелений коридор: обстріл захищеної колони — порушення угоди
      if (c.corridor) for (let x = 0; x < 3; x++) {
        if (x === shooter) continue;
        const r = Politics.rel(state, shooter, x);
        const list = r ? r.agreements.filter(a => a.type === 'corridor' && a.terms && a.terms.settlement === c.from && (a.until == null || a.until > state.time.turn)) : [];
        if (list.length) Politics.breakAgreements(state, shooter, x, list);
      }
      Engine.log(state, `ОБСТРІЛЯНО КОЛОНУ ${c.corridor ? 'ЕВАКУАЦІЇ' : 'БІЖЕНЦІВ'} (${s.name}) у ${g(state).label(idx)}: загинули ${n} цивільних. Стріляли — «${CONFIG.factions[shooter].short}».`, 'alert', null, null, { at: idx });
      out.push({ n, corridor: c.corridor });
    }
    state.civColumns = columns(state).filter(c => c.people > 0);
    return out;
  }
  // Хто бачить колону: свій контроль гекса або гекс під спостереженням
  function visibleTo(state, f, c) { return state.map.control[c.idx] === f || Intel.hexObserved(state, f, c.idx); }

  return { columns, columnsAt, spawn, hour, onFire, visibleTo, cars, escapePath };
})();
