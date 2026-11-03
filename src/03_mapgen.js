// ============================================================================
// МОДУЛЬ: ДАНІ СВІТУ — ГЕНЕРАЦІЯ ТЕСТОВОЇ КАРТИ
// Детермінована: однаковий seed дає однакову карту.
// Назви — тимчасові позначки, змінюватимуться в редакторі (етап 6).
// ============================================================================
const MapGen = {
  generate(seed, w, h) {
    const grid = new Grid(w, h);
    const N = grid.size;
    const rnd = mulberry32(seed);
    const map = {
      w, h,
      terrain: new Uint8Array(N),
      river: new Uint8Array(N),
      bridge: new Uint8Array(N),
      road: new Uint8Array(N),      // 0 — немає, 1 — ґрунтова, 2 — асфальт
      roadDirs: new Uint8Array(N),  // бітова маска напрямків дороги
      control: new Int8Array(N).fill(-1),
      settlement: new Int16Array(N).fill(-1),
      region: new Uint8Array(N),
      shelter: new Uint8Array(N),   // інженерні укриття (рівні)
      settlements: [],
      regions: [{ id: 0, name: 'Область 1' }]
    };
    const T = TERRAIN_ID;

    // 1. Базовий рельєф
    for (let i = 0; i < N; i++) {
      const c = grid.col(i), r = grid.row(i);
      const nw = Math.max(0, 1 - Math.hypot(c / w, r / h) * 1.6);
      const e = fbm(seed + 11, c / 10, r / 10, 4) * 0.7 + nw * 0.4;
      const f = fbm(seed + 29, c / 9, r / 9, 4);
      let t = T.plain;
      if (e > 0.63) t = T.mountains;
      else if (f > 0.68) t = T.denseForest;
      else if (f > 0.58) t = T.forest;
      map.terrain[i] = t;
    }

    // 2. Море на сході: лінія узбережжя з шумом
    for (let r = 0; r < h; r++) {
      const coastCol = Math.round(w - 12 + (fbm(seed + 41, 0.5, r / 10, 3) - 0.5) * 10 + (r / h) * 3);
      for (let c = coastCol; c < w; c++) {
        const i = grid.idx(c, r);
        map.terrain[i] = T.sea;
      }
    }
    for (let i = 0; i < N; i++) {
      if (map.terrain[i] === T.sea) continue;
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(i, d);
        if (n >= 0 && map.terrain[n] === T.sea) { map.terrain[i] = T.coast; break; }
      }
    }

    // 3. Річка: від північного краю до моря, меандри за шумовим полем
    const srcCol = 18 + Math.floor(rnd() * 10);
    const source = grid.idx(srcCol, 0);
    const mouthRow = Math.floor(h * 0.45 + rnd() * h * 0.15);
    let mouth = -1;
    for (let c = 0; c < w; c++) {
      const i = grid.idx(c, mouthRow);
      if (map.terrain[i] === T.coast) { mouth = i; break; }
    }
    const riverPath = MapGen.astar(grid, source, mouth, (a, b) => {
      if (map.terrain[b] === T.sea) return Infinity;
      return 1 + fbm(seed + 53, grid.col(b) / 4, grid.row(b) / 4, 2) * 6;
    });
    riverPath.unshift(source);
    for (const i of riverPath) map.river[i] = 1;

    // 4. Болота біля гирла
    for (const i of grid.within(mouth, 9)) {
      if (map.terrain[i] === T.sea) continue;
      let nearRiver = false;
      for (const j of grid.within(i, 2)) if (map.river[j]) { nearRiver = true; break; }
      if (nearRiver && fbm(seed + 67, grid.col(i) / 3, grid.row(i) / 3, 2) > 0.32 && map.terrain[i] !== T.coast) map.terrain[i] = T.swamp;
    }

    // 5. Місто на річці, ближче до моря, з промзоною біля узбережжя
    const cityRiverIdx = riverPath[Math.floor(riverPath.length * 0.62)];
    const cityCenter = grid.idx(Math.max(4, grid.col(cityRiverIdx) - 2), grid.row(cityRiverIdx));
    const city = { id: 0, name: 'Місто А', kind: 'city', center: cityCenter, control: -1 };
    map.settlements.push(city);
    for (const i of grid.within(cityCenter, 3)) {
      if (map.terrain[i] === T.sea) continue;
      map.terrain[i] = T.city; map.settlement[i] = 0;
    }
    for (const i of grid.within(cityCenter, 6)) {
      if (map.terrain[i] === T.sea || map.settlement[i] >= 0) continue;
      if (grid.dist(i, cityCenter) >= 4 && grid.col(i) > grid.col(cityCenter) + 1) {
        map.terrain[i] = T.industrial; map.settlement[i] = 0;
      }
    }

    // 6. Села
    const villageSpots = [
      ['Село Б', 0.15, 0.20], ['Село В', 0.18, 0.78], ['Село Г', 0.47, 0.12],
      ['Село Д', 0.42, 0.85], ['Село Е', 0.05, 0.50]
    ];
    for (const [name, fx, fy] of villageSpots) {
      let c = Math.round(fx * w + (rnd() - 0.5) * 6), r = Math.round(fy * h + (rnd() - 0.5) * 6);
      c = Math.min(w - 1, Math.max(1, c)); r = Math.min(h - 2, Math.max(1, r));
      let center = grid.idx(c, r);
      // уникаємо річки та моря
      let guard = 0;
      while ((map.river[center] || map.terrain[center] === T.sea || map.settlement[center] >= 0) && guard++ < 40) {
        center = grid.neighbor(center, guard % 6) >= 0 ? grid.neighbor(center, guard % 6) : center;
      }
      const id = map.settlements.length;
      map.settlements.push({ id, name, kind: 'village', center, control: -1 });
      for (const i of grid.within(center, 1)) {
        if (map.terrain[i] === T.sea || map.settlement[i] >= 0) continue;
        map.terrain[i] = T.village; map.settlement[i] = id;
      }
      for (const i of grid.within(center, 5)) {
        if (map.settlement[i] >= 0) continue;
        const t = map.terrain[i];
        if ((t === T.plain || t === T.forest) && grid.dist(i, center) >= 2 &&
            fbm(seed + 79, grid.col(i) / 3, grid.row(i) / 3, 2) > 0.42) map.terrain[i] = T.farmland;
      }
    }

    // 6б. Друга річка (запит гравця: «додай ще одну річку біля якогось села, щоб трохи
    // протестувати бій біля річки і переправи») — коротка притока головного русла в західній
    // частині карти, біля Села Е (яке головне русло не зачіпає), з власною гарантованою
    // переправою нижче (секція 7). Огинає вже розставлені пункти (не ріже їх навпіл).
    const villE = map.settlements[5];
    const villCol = grid.col(villE.center);
    const srcCol2 = Math.max(1, Math.min(w - 2, villCol + Math.floor((rnd() - 0.5) * 4)));
    const dstCol2 = Math.max(1, Math.min(w - 2, villCol + Math.floor((rnd() - 0.5) * 4)));
    const source2 = grid.idx(srcCol2, 0);
    const target2 = grid.idx(dstCol2, h - 1);
    const river2Path = MapGen.astar(grid, source2, target2, (a, b) => {
      if (map.terrain[b] === T.sea || map.settlement[b] >= 0) return Infinity;
      return 1 + fbm(seed + 97, grid.col(b) / 4, grid.row(b) / 4, 2) * 6;
    });
    if (river2Path.length) {
      river2Path.unshift(source2);
      for (const i of river2Path) if (map.settlement[i] < 0) map.river[i] = 1;
    }

    // 7. Дороги
    const roadCost = (a, b) => {
      const t = map.terrain[b];
      if (t === T.sea) return Infinity;
      let c;
      switch (t) {
        case T.plain: case T.farmland: case T.village: case T.city: case T.industrial: c = 1; break;
        case T.coast: c = 1.5; break;
        case T.forest: c = 3; break;
        case T.denseForest: c = 6; break;
        case T.mountains: c = 9; break;
        case T.swamp: c = 9; break;
        default: c = 2;
      }
      if (map.river[b]) c += 8;
      if (map.road[b]) c *= 0.3;
      return c;
    };
    const lay = (a, b, level) => {
      const path = MapGen.astar(grid, a, b, roadCost);
      const full = [a].concat(path);
      for (let k = 0; k < full.length; k++) {
        const i = full[k];
        map.road[i] = Math.max(map.road[i], level);
        if (map.river[i]) map.bridge[i] = 1;
        if (k + 1 < full.length) {
          const j = full[k + 1];
          const d = grid.dirTo(i, j);
          map.roadDirs[i] |= (1 << d);
          map.roadDirs[j] |= (1 << Hex.opposite(d));
        }
      }
    };
    const S = map.settlements;
    const westEdge = grid.idx(0, grid.row(cityCenter));
    // прибережна дорога вздовж моря
    let northCoast = -1, southCoast = -1;
    for (let r = 2; r < h; r++) { for (let c = 0; c < w; c++) { const i = grid.idx(c, r); if (map.terrain[i] === T.coast && !map.river[i]) { northCoast = i; break; } } if (northCoast >= 0) break; }
    for (let r = h - 3; r >= 0; r--) { for (let c = 0; c < w; c++) { const i = grid.idx(c, r); if (map.terrain[i] === T.coast && !map.river[i]) { southCoast = i; break; } } if (southCoast >= 0) break; }
    // переправа вище за течією: ґрунтова дорога через міст на третині русла
    const ford = riverPath[Math.floor(riverPath.length * 0.3)];
    lay(S[3].center, ford, 1);
    if (northCoast >= 0) lay(ford, northCoast, 1);
    lay(cityCenter, westEdge, 2);                 // траса на захід
    lay(cityCenter, S[3].center, 2);              // асфальт на північ (Село Г)
    lay(cityCenter, S[4].center, 2);              // асфальт на південь (Село Д)
    lay(S[1].center, S[3].center, 1);             // ґрунтові дороги між селами
    lay(S[1].center, S[5].center, 1);
    lay(S[5].center, S[2].center, 1);
    lay(S[2].center, S[4].center, 1);
    lay(S[5].center, westEdge, 1);
    // гарантована переправа через другу річку (секція 6б) — ґрунтова дорога від Села Е
    if (river2Path.length) lay(villE.center, river2Path[Math.floor(river2Path.length * 0.5)], 1);
    if (northCoast >= 0) lay(cityCenter, northCoast, 1);
    if (southCoast >= 0) lay(cityCenter, southCoast, 1);
    // міський міст: річка ділить Місто А — асфальт через русло на східний берег
    {
      const onEast = new Uint8Array(N);
      let rivHex = -1, bd = Infinity;
      for (const i of grid.within(cityCenter, 4)) {
        if (!map.river[i] || map.settlement[i] !== 0) continue;
        const d = grid.dist(i, cityCenter);
        if (d < bd) { bd = d; rivHex = i; }
      }
      if (rivHex >= 0) {
        // східний берег: суходіл, досяжний від русла без перетину річки, східніше переправи
        let start = -1;
        for (let d = 0; d < 6; d++) {
          const n = grid.neighbor(rivHex, d);
          if (n >= 0 && !map.river[n] && map.terrain[n] !== T.sea && grid.col(n) > grid.col(rivHex)) { start = n; break; }
        }
        if (start >= 0) {
          const q = [start]; onEast[start] = 1;
          while (q.length) {
            const cur = q.shift();
            for (let d = 0; d < 6; d++) {
              const n = grid.neighbor(cur, d);
              if (n < 0 || onEast[n] || map.river[n] || map.terrain[n] === T.sea) continue;
              if (grid.dist(n, rivHex) > 14) continue;
              onEast[n] = 1; q.push(n);
            }
          }
          // ціль — центр східної частини міста
          const part = []; for (let i = 0; i < N; i++) if (onEast[i] && map.settlement[i] === 0) part.push(i);
          let target = start;
          if (part.length) {
            const cc = part.reduce((a, i) => a + grid.col(i), 0) / part.length, rr = part.reduce((a, i) => a + grid.row(i), 0) / part.length;
            let best = Infinity;
            for (const i of part) { const d = Math.hypot(grid.col(i) - cc, grid.row(i) - rr); if (d < best) { best = d; target = i; } }
          }
          const lim = (a, b) => (map.river[b] && b !== rivHex) ? Infinity : roadCost(a, b);
          const layVia = (a, b, level, cost) => {
            const full = [a].concat(MapGen.astar(grid, a, b, cost));
            for (let k = 0; k < full.length; k++) {
              const i = full[k];
              map.road[i] = Math.max(map.road[i], level);
              if (map.river[i]) map.bridge[i] = 1;
              if (k + 1 < full.length) { const j = full[k + 1], d = grid.dirTo(i, j); map.roadDirs[i] |= (1 << d); map.roadDirs[j] |= (1 << Hex.opposite(d)); }
            }
          };
          layVia(cityCenter, rivHex, 2, lim);
          layVia(rivHex, target, 2, lim);
          // з’єднання з найближчою дорогою східного берега
          let near = -1, nd = Infinity;
          for (let i = 0; i < N; i++) if (onEast[i] && map.road[i] && map.settlement[i] !== 0) { const d = grid.dist(i, target); if (d < nd) { nd = d; near = i; } }
          if (near >= 0) layVia(target, near, 1, (a, b) => map.river[b] ? Infinity : roadCost(a, b));
        }
      }
    }

    // 8. Початковий контроль: найближчий «центр впливу» фракції (тестовий сценарій)
    const seeds = [cityCenter, S[1].center, S[2].center];
    for (let i = 0; i < N; i++) {
      if (map.terrain[i] === T.sea) continue;
      let best = -1, bd = Infinity;
      for (let f = 0; f < 3; f++) {
        const d = grid.dist(i, seeds[f]) * (f === 0 ? 0.8 : 1);
        if (d < bd) { bd = d; best = f; }
      }
      map.control[i] = best;
    }
    for (const s of map.settlements) s.control = map.control[s.center];
    return map;
  },

  // Універсальний A* по сітці; повертає шлях без початкового гекса
  astar(grid, start, goal, cost) {
    if (start < 0 || goal < 0) return [];
    const N = grid.size;
    const g = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    g[start] = 0; heap.push(grid.dist(start, goal), start);
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      if (cur === goal) break;
      closed[cur] = 1;
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(cur, d);
        if (n < 0 || closed[n]) continue;
        const c = cost(cur, n);
        if (!isFinite(c)) continue;
        const ng = g[cur] + c;
        if (ng < g[n]) { g[n] = ng; came[n] = cur; heap.push(ng + grid.dist(n, goal) * 0.3, n); }
      }
    }
    if (start !== goal && came[goal] < 0) return [];
    const path = [];
    for (let c = goal; c !== start; c = came[c]) path.push(c);
    return path.reverse();
  }
};
