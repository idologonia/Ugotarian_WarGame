#!/usr/bin/env node
// ============================================================================
// Процес правил гри для HGS (запускає server/logic.py).
// HGS виконує серверну логіку на Python, а правила гри написані на JavaScript, — тож
// logic.py тримає цей процес і передає йому дії. Тут ті самі модулі src/*.js, що й у
// браузері: механіки, баланс і формат збережень — побайтово ті самі.
//
// Протокол: один JSON-об’єкт на рядок. Запит {id, op, room, ...} → відповідь {id, ok, ...}.
//   new      {room, seed, players}       нова гра (players: ['human'|'easy'|'hard'] ×3)
//   load     {room, save}                 відновити гру зі збереження (рядок SaveSystem)
//   unload   {room}                       прибрати гру з пам’яті
//   players  {room, players}              хто керує сторонами (людина / бот); боти ходять
//   cmd      {room, faction, mod, fn, args}  наказ гравця (перевірки — тут, за правилами)
//   view     {room, faction}              картина фракції (строгий туман війни, 08b_view.js)
//   info     {room}                       час, чия фаза, чи завершено
//   save     {room}                       рядок збереження (той самий формат, що й офлайн)
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const readline = require('readline');

const SRC = path.join(__dirname, '..', 'src');
function loadEngine() {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js') && !f.startsWith('9') && !f.startsWith('85')).sort();
  const code = files.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n') +
    '\n;({CONFIG,Engine,Intel,Combat,Transport,Loot,Logistics,Politics,Field,Recruit,Foreign,Mines,Air,Decisions,Civil,AI,SaveSystem,View,Scenario})';
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error: (...a) => process.stderr.write(a.join(' ') + '\n') }, Math, JSON, Date });
  return vm.runInContext('"use strict";\n' + code, ctx, { filename: 'yugotaria-engine.js' });
}
const E = loadEngine();

// Накази гравця: перевіряємо фазу, білий список і що підрозділ / сторона — свої
const UNIT_FIRST = new Set([
  'Engine.issueMoveOrder', 'Engine.setStance', 'Engine.deploy', 'Engine.cancelOrder', 'Combat.attack',
  'Transport.disembark', 'Transport.disembarkAll', 'Transport.board', 'Transport.splitSquad', 'Transport.merge', 'Transport.abandonVehicle',
  'Loot.loot', 'Loot.dropCargo', 'Loot.recoverDead',
  'Logistics.resupply', 'Logistics.pickupWounded', 'Logistics.loadItem', 'Logistics.loadFromStore', 'Logistics.issueFromCargo',
  'Logistics.unloadToStore', 'Logistics.destroyFacility', 'Logistics.claimFacility',
  'Field.takeVehicle', 'Field.startProject', 'Field.mount', 'Field.layWireField', 'Field.issueBinoculars'
]);
const FACTION_FIRST = new Set([
  'Politics.aid', 'Politics.propaganda', 'Politics.raiseMilitia', 'Politics.sendSpies', 'Politics.propose', 'Politics.dissolveAlliance',
  'Politics.setLabor', 'Politics.interrogate',
  'Recruit.foundWorkshop', 'Recruit.form', 'Recruit.buy', 'Recruit.setWorkshopRecipe', 'Recruit.upgradeWorkshop',
  'Foreign.sellRF', 'Foreign.requestInvestment', 'Foreign.officialRequest', 'Foreign.hirePmc', 'Foreign.callVolunteers',
  'Field.requisition', 'Field.issueVehicle', 'Air.launch', 'Decisions.start', 'Decisions.cancel'
]);
const OTHER = new Set(['Engine.endPhase', 'Politics.respond']);
const KINDS = ['human', 'easy', 'hard'];

const games = new Map();   // room -> state
function game(room) { const st = games.get(String(room)); if (!st) throw new Error('Гри в цій кімнаті немає.'); return st; }
function setPlayers(st, players) {
  const list = (players || []).map(k => (KINDS.includes(k) ? k : 'human'));
  st.players = [0, 1, 2].map(f => (list[f] && list[f] !== 'human' ? { type: 'ai', level: list[f] } : { type: 'human' }));
  if (!st.ai) st.ai = { mem: [{}, {}, {}] };
}
// Боти ходять, доки фаза належить боту. Повертає, скільки годин минуло.
function runBots(st) {
  let guard = 0, hours = 0;
  while (!(st.campaign && st.campaign.over) && E.AI.isBot(st, E.Engine.phaseFaction(st)) && guard++ < 300) {
    try { E.AI.runPhase(st); } catch (e) { process.stderr.write('ШІ: ' + (e && e.stack) + '\n'); }
    const r = E.Engine.endPhase(st);
    if (!r.ok) break;
    if (r.hourEnded) hours++;
  }
  return hours;
}
function info(st) {
  return { time: E.Engine.timeLabel(st.time), turn: st.time.turn, phaseFaction: E.Engine.phaseFaction(st),
    over: !!(st.campaign && st.campaign.over), reason: st.campaign ? st.campaign.reason || '' : '' };
}

function command(st, f, mod, fn, args) {
  const key = `${mod}.${fn}`;
  if (!UNIT_FIRST.has(key) && !FACTION_FIRST.has(key) && !OTHER.has(key)) return { ok: false, reason: 'Невідомий наказ.' };
  if (st.campaign && st.campaign.over) return { ok: false, reason: 'Кампанію завершено.' };
  if (E.Engine.phaseFaction(st) !== f) return { ok: false, reason: 'Зараз не ваша фаза.' };
  args = Array.isArray(args) ? args.slice(0, 8) : [];
  if (UNIT_FIRST.has(key)) {
    const u = E.Engine.unitById(st, args[0]);
    if (!u || u.faction !== f) return { ok: false, reason: 'Це не ваш підрозділ.' };
    if (key === 'Transport.merge' || key === 'Transport.board') { const v = E.Engine.unitById(st, args[1]); if (!v || v.faction !== f) return { ok: false, reason: 'Це не ваш підрозділ.' }; }
    // службові прапорці атаки (стрільба поза фазою, засідка) гравцю недоступні
    if (key === 'Combat.attack') args[3] = args[3] && args[3].suppress ? { suppress: true } : {};
  }
  if (FACTION_FIRST.has(key) && args[0] !== f) return { ok: false, reason: 'Можна діяти лише від імені своєї сторони.' };
  if (key === 'Politics.respond') { const p = st.diplomacy.proposals.find(x => x.id === args[0]); if (!p || p.to !== f) return { ok: false, reason: 'Пропозицію не знайдено.' }; }
  const result = E[mod][fn](st, ...args);
  let hour = !!(result && result.hourEnded);
  if (key === 'Engine.endPhase' && result && result.ok && runBots(st) > 0) hour = true;
  return { ok: true, result: E.View.sanitize(result, f), hourEnded: hour };
}

function handle(q) {
  const room = q.room != null ? String(q.room) : null;
  switch (q.op) {
    case 'ping': return {};
    case 'new': {
      const st = E.Engine.newGame(Math.max(1, Math.min(999999, Math.floor(Number(q.seed)) || 1999)));
      setPlayers(st, q.players);
      games.set(room, st);
      runBots(st);
      return { info: info(st) };
    }
    case 'load': {
      const r = E.SaveSystem.deserialize(String(q.save));
      if (!r.ok) return { ok: false, reason: (r.errors || []).join('; ') || 'Пошкоджене збереження.' };
      const st = r.state;
      if (q.players) setPlayers(st, q.players);
      games.set(room, st);
      runBots(st);
      return { info: info(st) };
    }
    case 'unload': games.delete(room); return {};
    case 'players': { const st = game(room); setPlayers(st, q.players); const h = runBots(st); return { info: info(st), hourEnded: h > 0 }; }
    case 'cmd': {
      const st = game(room);
      const r = command(st, q.faction, String(q.mod || ''), String(q.fn || ''), q.args);
      if (!r.ok) return { ok: true, accepted: false, reason: r.reason };
      return { accepted: true, result: r.result, hourEnded: r.hourEnded, info: info(st) };
    }
    case 'view': return { view: E.View.make(game(room), q.faction) };
    case 'info': return { info: info(game(room)) };
    case 'save': return { save: E.SaveSystem.serialize(game(room)), info: info(game(room)) };
    default: return { ok: false, reason: 'Невідома операція.' };
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line.trim()) return;
  let q;
  try { q = JSON.parse(line); } catch (e) { return; }
  let out;
  try { out = Object.assign({ ok: true }, handle(q)); }
  catch (e) { process.stderr.write(`Помилка ${q.op}: ${e && e.stack}\n`); out = { ok: false, reason: 'Помилка на сервері: ' + (e && e.message) }; }
  out.id = q.id;
  process.stdout.write(JSON.stringify(out) + '\n');
});
rl.on('close', () => process.exit(0));
process.stdout.write(JSON.stringify({ id: 0, ok: true, ready: true }) + '\n');
