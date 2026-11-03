// ============================================================================
// МОДУЛЬ: ГЕКСОВА ГЕОМЕТРІЯ ТА ДЕТЕРМІНОВАНИЙ ГЕНЕРАТОР
// Гекси з пласкою верхівкою, зберігання «odd-q» (непарні колонки зміщені вниз).
// ============================================================================
const SQRT3 = Math.sqrt(3);

const Hex = {
  // Осьові напрямки та кути (у градусах, вісь Y вниз) до центру сусіда
  DIRS: [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]],
  DIR_ANGLE: [30, -30, -90, -150, 150, 90],
  opposite(d) { return (d + 3) % 6; },

  toAxial(col, row) { return { q: col, r: row - ((col - (col & 1)) >> 1) }; },
  toOffset(q, r) { return { col: q, row: r + ((q - (q & 1)) >> 1) }; },

  // Центр гекса у світових координатах (розмір гекса = 1)
  center(col, row) { return { x: 1.5 * col, y: SQRT3 * (row + 0.5 * (col & 1)) }; },

  // Світові координати -> гекс (col,row)
  fromPoint(x, y) {
    const qf = (2 / 3) * x;
    const rf = (-1 / 3) * x + (SQRT3 / 3) * y;
    const sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    return Hex.toOffset(q, r);
  },

  distanceOffset(c1, r1, c2, r2) {
    const a = Hex.toAxial(c1, r1), b = Hex.toAxial(c2, r2);
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }
};

// Сітка фіксованого розміру з таблицею сусідів
class Grid {
  constructor(w, h) {
    this.w = w; this.h = h; this.size = w * h;
    this.nb = new Int32Array(this.size * 6).fill(-1);
    for (let i = 0; i < this.size; i++) {
      const col = i % w, row = (i / w) | 0;
      const a = Hex.toAxial(col, row);
      for (let d = 0; d < 6; d++) {
        const o = Hex.toOffset(a.q + Hex.DIRS[d][0], a.r + Hex.DIRS[d][1]);
        if (o.col >= 0 && o.col < w && o.row >= 0 && o.row < h) this.nb[i * 6 + d] = o.row * w + o.col;
      }
    }
  }
  idx(col, row) { return (col < 0 || row < 0 || col >= this.w || row >= this.h) ? -1 : row * this.w + col; }
  col(i) { return i % this.w; }
  row(i) { return (i / this.w) | 0; }
  neighbor(i, d) { return this.nb[i * 6 + d]; }
  dirTo(a, b) { for (let d = 0; d < 6; d++) if (this.nb[a * 6 + d] === b) return d; return -1; }
  dist(a, b) { return Hex.distanceOffset(this.col(a), this.row(a), this.col(b), this.row(b)); }
  center(i) { return Hex.center(this.col(i), this.row(i)); }
  // Позначення гекса для гравця: колонка-рядок, з 1
  label(i) { return String(this.col(i) + 1).padStart(2, '0') + '.' + String(this.row(i) + 1).padStart(2, '0'); }
  // Усі гекси в радіусі
  within(i, radius) {
    const out = [];
    const c = this.col(i), r = this.row(i);
    for (let rr = Math.max(0, r - radius - 1); rr <= Math.min(this.h - 1, r + radius + 1); rr++)
      for (let cc = Math.max(0, c - radius); cc <= Math.min(this.w - 1, c + radius); cc++)
        if (Hex.distanceOffset(c, r, cc, rr) <= radius) out.push(rr * this.w + cc);
    return out;
  }
}

// Детермінований генератор випадкових чисел (лише для генерації карти)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(seed, x, y) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, x0, y0), b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1), d = hash2(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function fbm(seed, x, y, octaves) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * valueNoise(seed + o * 1013, x * f, y * f);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return v / norm;
}

// Двійкова купа для A*
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length > 0) {
      let i = 0; const n = k.length;
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i;
        let mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
