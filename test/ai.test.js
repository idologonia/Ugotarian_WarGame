// Боти (09_ai.js): налаштування гравців, детермінованість, стабільність довгої гри,
// чесність (туман війни), дипломатія, збереження.
const L = require('./load.js')();
const { Engine, AI, Intel, SaveSystem, Politics } = L;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

let errors = 0;
const origErr = console.error;
console.error = (...a) => { errors++; if (errors < 5) origErr(...a); };

function play(levels, hours, seed = 1999) {
  const s = Engine.newGame(seed);
  AI.configure(s, levels);
  const stats = [{}, {}, {}];
  for (let i = 0; i < hours * 3 && !s.campaign.over; i++) {
    const r = AI.runPhase(s);
    if (r.ok) for (const k in r.stats) stats[r.faction][k] = (stats[r.faction][k] || 0) + r.stats[k];
    const e = Engine.endPhase(s);
    if (!e.ok) throw new Error('endPhase: ' + e.reason);
  }
  return { s, stats };
}
const strip = s => { const o = JSON.parse(SaveSystem.serialize(s)); delete o.savedAt; if (o.meta) delete o.meta.created; return JSON.stringify(o); };

// 1. Налаштування гравців
{
  const s = Engine.newGame(1999);
  ok(AI.controller(s, 0) === 'human' && !AI.isBot(s, 1), 'без налаштувань (старі збереження) — усі люди');
  AI.configure(s, ['human', 'easy', 'hard']);
  ok(AI.controller(s, 0) === 'human' && AI.controller(s, 1) === 'easy' && AI.controller(s, 2) === 'hard', 'configure: людина / легкий / важкий');
  ok(JSON.stringify(AI.humans(s)) === '[0]', 'humans() — лише фракція 0');
  AI.configure(s, ['bogus', 'hard']);
  ok(AI.controller(s, 0) === 'human' && AI.controller(s, 2) === 'human', 'невідомий рівень → людина');
  // фаза людини — бот нічого не робить
  AI.configure(s, ['human', 'hard', 'hard']);
  const before = strip(s);
  const r = AI.runPhase(s);
  ok(!r.ok && strip(s) === before, 'у фазі людини runPhase нічого не змінює');
}

// 2. Детермінованість: однакова гра → однакові ходи
{
  const a = play(['hard', 'easy', 'hard'], 6).s, b = play(['hard', 'easy', 'hard'], 6).s;
  ok(strip(a) === strip(b), 'дві однакові партії ботів дають ідентичний стан');
}

// 3. Довга гра: без помилок, боти діють, стан зберігається
for (const lv of [['easy', 'easy', 'easy'], ['hard', 'hard', 'hard']]) {
  errors = 0;
  const t = Date.now();
  const { s, stats } = play(lv, 24);
  ok(errors === 0, `${lv[0]}: 24 год без винятків у ШІ (${Date.now() - t} мс)`);
  ok(stats.every(x => (x.moves || 0) > 5), `${lv[0]}: кожна фракція віддає накази руху (${stats.map(x => x.moves || 0).join('/')})`);
  ok(stats.reduce((a, x) => a + (x.attacks || 0), 0) > 10, `${lv[0]}: боти ведуть бій (${stats.map(x => x.attacks || 0).join('/')} атак)`);
  const r = SaveSystem.deserialize(SaveSystem.serialize(s));
  ok(r.ok && AI.controller(r.state, 1) === lv[1] && r.state.ai && r.state.ai.mem.length === 3, `${lv[0]}: гравці й пам’ять бота зберігаються`);
  if (lv[0] === 'hard') ok(stats.some(x => (x.other || 0) > 0), 'важкий: є економічні/логістичні дії (набір, поповнення, посадка)');
}

// 4. Чесність: переміщення невідомого боту ворога не змінює його рішень
{
  const base = play(['human', 'hard', 'human'], 3).s;   // фаза людини 0 → гра стоїть на фазі
  // дійти до фази бота 1
  while (Engine.phaseFaction(base) !== 1) Engine.endPhase(base);
  const f = 1, g = Engine.grid(base);
  const knownIds = new Set(Intel.knownList(base, f, { allies: 'all' }).map(m => m.id));
  const hidden = base.units.find(u => u.faction !== f && !knownIds.has(u.id) && u.embarked == null && !Intel.hexObserved(base, f, u.idx));
  let moved = false;
  const A = JSON.parse(JSON.stringify(SaveSystem.serialize(base)));
  const sA = SaveSystem.deserialize(A).state, sB = SaveSystem.deserialize(A).state;
  if (hidden) {
    const hB = Engine.unitById(sB, hidden.id);
    for (let i = 0; i < g.size; i++) {
      if (i === hB.idx || Intel.hexObserved(sB, f, i) || !Engine.hexPassable(sB, 'foot', i)) continue;
      if (sB.units.some(u => u.idx === i) || g.dist(i, hB.idx) < 5) continue;
      if (sB.units.some(u => u.faction === f && g.dist(u.idx, i) < 12)) continue;
      hB.idx = i; moved = true; break;
    }
  }
  Intel.update(sA); Intel.update(sB);
  AI.runPhase(sA); AI.runPhase(sB);
  const orders = s => s.units.filter(u => u.faction === f).map(u => [u.id, u.idx, u.order ? u.order.target : null, u.stance].join(':')).join('|');
  ok(moved, 'знайдено невидимий для бота ворожий підрозділ');
  ok(orders(sA) === orders(sB), 'рішення бота не залежать від невидимого йому противника');
}

// 5. Дипломатія: пропозиція боту отримує відповідь у його фазі
{
  const s = Engine.newGame(1999);
  AI.configure(s, ['human', 'hard', 'easy']);
  while (Engine.phaseFaction(s) !== 0) Engine.endPhase(s);
  const p = Politics.propose(s, 0, 1, 'ceasefire', {});
  ok(p.ok, 'людина надіслала боту пропозицію перемир’я');
  while (Engine.phaseFaction(s) !== 1) { if (AI.isBot(s, Engine.phaseFaction(s))) AI.runPhase(s); Engine.endPhase(s); }
  AI.runPhase(s);
  const st = s.diplomacy.proposals.find(x => x.id === p.id).status;
  ok(st === 'accepted' || st === 'rejected', `бот відповів на пропозицію (${st})`);
}

console.error = origErr;
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
