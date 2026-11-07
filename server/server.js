#!/usr/bin/env node
// ============================================================================
// Yugotaria: Civil War — сервер онлайн-гри (запускається на ПК хоста)
// Без сторонніх бібліотек: лише Node.js (18+). Запуск: node server/server.js [--port 8080]
//
// Сервер тримає ПОВНИЙ стан гри й сам виконує всі накази тими самими модулями правил,
// що й браузер (src/*.js). Кожен гравець отримує лише картину своєї фракції (08b_view.js):
// невидимі вороги, чужа економіка, розвідка й міни до браузера не потрапляють.
// Зв’язок: звичайний HTTP (працює через проброс порту й тунелі) — команди POST-запитами,
// сповіщення сервера — Server-Sent Events, великі відповіді стискаються gzip.
// ============================================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argPort = (() => { const i = process.argv.indexOf('--port'); return i >= 0 ? Number(process.argv[i + 1]) : null; })();
const PORT = argPort || Number(process.env.PORT) || 8080;
const SAVE_DIR = process.env.YUGO_SAVES || path.join(__dirname, 'saves');
const QUIET = !!process.env.YUGO_QUIET;
const HOST_KEY = process.env.YUGO_HOST_KEY || crypto.randomBytes(6).toString('hex');
fs.mkdirSync(SAVE_DIR, { recursive: true });
const say = (...a) => { if (!QUIET) console.log(...a); };

// ---------------------------------------------------------------- гра й правила
function buildPage() {
  try {
    const prev = console.log; console.log = () => {};
    try { delete require.cache[require.resolve('../build.js')]; require('../build.js'); } finally { console.log = prev; }
  } catch (e) { say('Збірка не вдалася, беру готову dist/:', e.message); }
  return fs.readFileSync(path.join(ROOT, 'dist', 'Yugotaria-Civil-War.html'));
}
function loadEngine() {
  const dir = path.join(ROOT, 'src');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('9') && !f.startsWith('85')).sort();
  const code = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') +
    '\n;({CONFIG,Engine,Intel,Combat,Transport,Loot,Logistics,Politics,Field,Recruit,Foreign,Mines,Air,Decisions,Civil,AI,SaveSystem,View,Scenario})';
  const ctx = vm.createContext({ console, Math, JSON, Date });
  return vm.runInContext('"use strict";\n' + code, ctx, { filename: 'yugotaria-engine.js' });
}
const E = loadEngine();
let PAGE = buildPage();

// Накази, які гравець може надіслати. Перевірки: фаза гравця; підрозділ (перший аргумент) —
// свій; або фракція (перший аргумент) — своя. Решта — перевіряють самі правила.
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

// ---------------------------------------------------------------- лобі
const KINDS = ['human', 'easy', 'hard'];
const G = {
  phase: 'lobby',                 // lobby | game
  seed: 1999,
  slots: [{ kind: 'human', owner: null }, { kind: 'easy', owner: null }, { kind: 'easy', owner: null }],
  players: new Map(),             // token -> { token, name, isHost, seen }
  state: null,
  rev: 0,
  chat: [],
  nextChat: 1,
  clients: new Set()              // { res, token }
};
const token = () => crypto.randomBytes(16).toString('hex');
const factionOf = t => { const k = G.slots.findIndex(s => s.kind === 'human' && s.owner === t); return k >= 0 ? k : null; };
const fname = f => E.CONFIG.factions[f].name;

function lobbyFor(t) {
  const me = G.players.get(t);
  const st = G.state;
  return {
    phase: G.phase, seed: G.seed, rev: G.rev,
    me: me ? { name: me.name, isHost: me.isHost, faction: factionOf(t) } : null,
    slots: G.slots.map((s, f) => ({ faction: f, name: fname(f), kind: s.kind, owner: s.owner ? (G.players.get(s.owner) || {}).name || '—' : null, online: !!(s.owner && [...G.clients].some(c => c.token === s.owner)) })),
    players: [...G.players.values()].map(p => ({ name: p.name, isHost: p.isHost, faction: factionOf(p.token), online: [...G.clients].some(c => c.token === p.token) })),
    game: st ? { time: E.Engine.timeLabel(st.time), phaseFaction: E.Engine.phaseFaction(st), over: !!(st.campaign && st.campaign.over), reason: st.campaign ? st.campaign.reason : '' } : null,
    saves: me && me.isHost ? listSaves() : []
  };
}

// ---------------------------------------------------------------- SSE
function send(c, event, data) { try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* закритий */ } }
function broadcastLobby() { for (const c of G.clients) send(c, 'lobby', lobbyFor(c.token)); }
function broadcastUpdate() { for (const c of G.clients) send(c, 'update', { rev: G.rev, phaseFaction: G.state ? E.Engine.phaseFaction(G.state) : null }); }
function chatVisible(m, t) { if (m.to === 'all') return true; const f = factionOf(t); return m.fromToken === t || f === m.to; }
function chatOut(m) { return { id: m.id, t: m.t, from: m.from, fromFaction: m.fromFaction, to: m.to, text: m.text, system: !!m.system }; }
function pushChat(m) {
  m.id = G.nextChat++; m.t = Date.now();
  G.chat.push(m); if (G.chat.length > 300) G.chat.splice(0, G.chat.length - 300);
  for (const c of G.clients) if (chatVisible(m, c.token)) send(c, 'chat', chatOut(m));
}
const sys = text => pushChat({ from: 'Сервер', fromFaction: null, to: 'all', text, system: true });
setInterval(() => { for (const c of G.clients) { try { c.res.write(': keepalive\n\n'); } catch (e) { /* */ } } }, 20000).unref();

// ---------------------------------------------------------------- гра
function syncPlayers() {
  if (!G.state) return;
  G.state.players = G.slots.map(s => (s.kind === 'human' ? { type: 'human' } : { type: 'ai', level: s.kind }));
  if (!G.state.ai) G.state.ai = { mem: [{}, {}, {}] };
}
function runBots() {
  const st = G.state;
  let guard = 0, hours = 0;
  while (st && !(st.campaign && st.campaign.over) && E.AI.isBot(st, E.Engine.phaseFaction(st)) && guard++ < 300) {
    try { E.AI.runPhase(st); } catch (e) { console.error('ШІ:', e); }
    const r = E.Engine.endPhase(st);
    if (!r.ok) break;
    if (r.hourEnded) hours++;
  }
  return hours;
}
function startGame() {
  G.state = E.Engine.newGame(G.seed);
  syncPlayers();
  G.phase = 'game';
  runBots();
  G.rev++;
  autosave();
  sys(`Кампанію розпочато (карта ${G.seed}).`);
}
function stamp() { return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19); }
function saveTo(file) {
  if (!G.state) return null;
  const data = { format: 'yugotaria-server-save', savedAt: Date.now(), seed: G.seed,
    slots: G.slots.map(s => ({ kind: s.kind, owner: s.owner, ownerName: s.owner ? (G.players.get(s.owner) || {}).name : null })),
    state: JSON.parse(E.SaveSystem.serialize(G.state)) };
  fs.writeFileSync(path.join(SAVE_DIR, file), JSON.stringify(data));
  return file;
}
function autosave() { try { saveTo('autosave.json'); } catch (e) { console.error('Автозбереження:', e.message); } }
function listSaves() {
  try {
    return fs.readdirSync(SAVE_DIR).filter(f => f.endsWith('.json')).map(f => {
      const st = fs.statSync(path.join(SAVE_DIR, f));
      return { file: f, time: st.mtimeMs };
    }).sort((a, b) => b.time - a.time).slice(0, 30);
  } catch (e) { return []; }
}
function loadFrom(file) {
  const safe = path.basename(file);
  const data = JSON.parse(fs.readFileSync(path.join(SAVE_DIR, safe), 'utf8'));
  const raw = data.format === 'yugotaria-server-save' ? data.state : data;
  const r = E.SaveSystem.deserialize(JSON.stringify(raw));
  if (!r.ok) throw new Error((r.errors || []).join('; ') || 'пошкоджене збереження');
  G.state = r.state;
  if (data.seed) G.seed = data.seed;
  if (Array.isArray(data.slots)) {
    data.slots.forEach((s, f) => {
      G.slots[f].kind = KINDS.includes(s.kind) ? s.kind : 'human';
      // гравець із тим самим токеном (браузер пам’ятає його) повертається на свою сторону
      G.slots[f].owner = s.owner && s.kind === 'human' ? s.owner : null;
      if (s.owner && !G.players.has(s.owner)) G.players.set(s.owner, { token: s.owner, name: s.ownerName || 'Гравець', isHost: false, seen: Date.now() });
    });
  } else {
    (G.state.players || []).forEach((p, f) => { G.slots[f].kind = p && p.type === 'ai' ? p.level : 'human'; });
  }
  syncPlayers();
  G.phase = 'game';
  runBots();
  G.rev++;
}

const viewCache = new Map();   // `${rev}:${f}` -> gzip
function viewJson(f) { G.state.rev = G.rev; return JSON.stringify(E.View.make(G.state, f)); }

// Наказ гравця
function command(t, mod, fn, args) {
  const f = factionOf(t);
  if (G.phase !== 'game' || !G.state) return { ok: false, reason: 'Гра ще не почалася.' };
  if (f == null) return { ok: false, reason: 'Ви не керуєте жодною стороною.' };
  const key = `${mod}.${fn}`;
  if (!UNIT_FIRST.has(key) && !FACTION_FIRST.has(key) && !OTHER.has(key)) return { ok: false, reason: 'Невідомий наказ.' };
  const st = G.state;
  if (st.campaign && st.campaign.over) return { ok: false, reason: 'Кампанію завершено.' };
  if (E.Engine.phaseFaction(st) !== f) return { ok: false, reason: 'Зараз не ваша фаза.' };
  args = Array.isArray(args) ? args.slice(0, 8) : [];
  if (UNIT_FIRST.has(key)) {
    const u = E.Engine.unitById(st, args[0]);
    if (!u || u.faction !== f) return { ok: false, reason: 'Це не ваш підрозділ.' };
    if (key === 'Transport.merge' || key === 'Transport.board') { const v = E.Engine.unitById(st, args[1]); if (!v || v.faction !== f) return { ok: false, reason: 'Це не ваш підрозділ.' }; }
    if (key === 'Combat.attack') args[3] = args[3] && args[3].suppress ? { suppress: true } : {};
  }
  if (FACTION_FIRST.has(key) && args[0] !== f) return { ok: false, reason: 'Можна діяти лише від імені своєї сторони.' };
  if (key === 'Politics.respond') { const p = st.diplomacy.proposals.find(x => x.id === args[0]); if (!p || p.to !== f) return { ok: false, reason: 'Пропозицію не знайдено.' }; }
  let result;
  try { result = E[mod][fn](st, ...args); }
  catch (e) { console.error(`Наказ ${key}:`, e); return { ok: false, reason: 'Помилка на сервері: ' + e.message }; }
  let hour = !!(result && result.hourEnded);
  if (key === 'Engine.endPhase' && result && result.ok) { if (runBots() > 0) hour = true; }
  if (hour) autosave();
  G.rev++;
  return { ok: true, result: E.View.sanitize(result, f) };
}

// ---------------------------------------------------------------- HTTP
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', d => { n += d.length; if (n > 256 * 1024) { reject(new Error('завеликий запит')); req.destroy(); } else parts.push(d); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function reply(req, res, code, obj, raw) {
  const body = raw || Buffer.from(JSON.stringify(obj));
  const gz = (req.headers['accept-encoding'] || '').includes('gzip') && body.length > 1024;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(gz ? zlib.gzipSync(body) : body);
}
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Гравець';

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    const gz = (req.headers['accept-encoding'] || '').includes('gzip');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
    return res.end(gz ? zlib.gzipSync(PAGE) : PAGE);
  }
  if (p === '/api/hello') return reply(req, res, 200, { ok: true, game: 'yugotaria', phase: G.phase });
  if (req.method === 'GET' && p === '/api/events') {
    const t = url.searchParams.get('token');
    if (!G.players.has(t)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const c = { res, token: t };
    G.clients.add(c);
    send(c, 'lobby', lobbyFor(t));
    send(c, 'chatlog', G.chat.filter(m => chatVisible(m, t)).slice(-80).map(chatOut));
    if (G.phase === 'game') send(c, 'update', { rev: G.rev, phaseFaction: E.Engine.phaseFaction(G.state) });
    broadcastLobby();
    req.on('close', () => { G.clients.delete(c); broadcastLobby(); });
    return;
  }
  if (req.method === 'GET' && p === '/api/view') {
    const t = url.searchParams.get('token');
    const f = factionOf(t);
    if (G.phase !== 'game' || f == null) return reply(req, res, 403, { ok: false, reason: 'Немає картини для вас.' });
    const k = `${G.rev}:${f}`;
    if (!viewCache.has(k)) { if (viewCache.size > 12) viewCache.clear(); viewCache.set(k, Buffer.from(viewJson(f))); }
    return reply(req, res, 200, null, viewCache.get(k));
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
  let b;
  try { b = await readBody(req); } catch (e) { return reply(req, res, 400, { ok: false, reason: 'Некоректний запит.' }); }

  if (p === '/api/join') {
    let t = b.token && G.players.has(b.token) ? b.token : null;
    const isHost = b.hostKey === HOST_KEY;
    if (!t) { t = token(); G.players.set(t, { token: t, name: cleanName(b.name), isHost, seen: Date.now() }); say(`Підключився: ${cleanName(b.name)}${isHost ? ' (хост)' : ''}`); }
    const pl = G.players.get(t);
    if (b.name) pl.name = cleanName(b.name);
    if (isHost) pl.isHost = true;
    broadcastLobby();
    return reply(req, res, 200, { ok: true, token: t, isHost: pl.isHost });
  }
  const t = b.token;
  const pl = G.players.get(t);
  if (!pl) return reply(req, res, 403, { ok: false, reason: 'Спершу приєднайтеся до гри.' });
  pl.seen = Date.now();

  if (p === '/api/lobby') {
    const a = b.action;
    const host = pl.isHost;
    const f = Number(b.faction);
    const okF = f === 0 || f === 1 || f === 2;
    let msg = null;
    if (a === 'take') {
      if (!okF) return reply(req, res, 400, { ok: false, reason: 'Невідома сторона.' });
      const s = G.slots[f];
      if (s.kind !== 'human') return reply(req, res, 200, { ok: false, reason: 'Цією стороною керує бот.' });
      if (s.owner && s.owner !== t) return reply(req, res, 200, { ok: false, reason: 'Сторону вже зайнято.' });
      for (const x of G.slots) if (x.owner === t) x.owner = null;
      s.owner = t; msg = `${pl.name} грає за «${fname(f)}».`;
    } else if (a === 'leave') {
      for (const x of G.slots) if (x.owner === t) x.owner = null;
    } else if (a === 'name') {
      pl.name = cleanName(b.name);
    } else if (!host) {
      return reply(req, res, 403, { ok: false, reason: 'Лише хост.' });
    } else if (a === 'slot' && okF && KINDS.includes(b.kind)) {
      G.slots[f].kind = b.kind; if (b.kind !== 'human') G.slots[f].owner = null;
      if (G.phase === 'game') { syncPlayers(); runBots(); G.rev++; broadcastUpdate(); msg = `«${fname(f)}» тепер: ${b.kind === 'human' ? 'гравець' : b.kind === 'hard' ? 'бот (важкий)' : 'бот (легкий)'}.`; }
    } else if (a === 'kick' && okF) {
      G.slots[f].owner = null;
    } else if (a === 'seed') {
      G.seed = Math.max(1, Math.min(999999, Math.floor(Number(b.seed)) || 1999));
    } else if (a === 'start') {
      if (!G.slots.some(s => s.kind === 'human' && s.owner)) return reply(req, res, 200, { ok: false, reason: 'Займіть хоча б одну сторону.' });
      startGame(); broadcastUpdate();
    } else if (a === 'save') {
      const file = saveTo(`save-${stamp()}.json`);
      if (!file) return reply(req, res, 200, { ok: false, reason: 'Немає гри для збереження.' });
      msg = `Гру збережено: ${file}.`;
    } else if (a === 'load') {
      try { loadFrom(String(b.file || '')); msg = `Завантажено збереження ${path.basename(String(b.file))}.`; broadcastUpdate(); }
      catch (e) { return reply(req, res, 200, { ok: false, reason: 'Не вдалося завантажити: ' + e.message }); }
    } else if (a === 'toLobby') {
      autosave(); G.phase = 'lobby'; G.state = null; G.rev++; msg = 'Хост повернувся до лобі (гру збережено в autosave.json).';
    } else return reply(req, res, 400, { ok: false, reason: 'Невідома дія.' });
    if (msg) sys(msg);
    broadcastLobby();
    return reply(req, res, 200, { ok: true });
  }
  if (p === '/api/cmd') {
    const r = command(t, String(b.mod || ''), String(b.fn || ''), b.args);
    if (!r.ok) return reply(req, res, 200, r);
    const f = factionOf(t);
    const view = viewJson(f);
    viewCache.set(`${G.rev}:${f}`, Buffer.from(view));
    broadcastUpdate();
    broadcastLobby();
    return reply(req, res, 200, null, Buffer.from(`{"ok":true,"rev":${G.rev},"result":${JSON.stringify(r.result === undefined ? null : r.result)},"view":${view}}`));
  }
  if (p === '/api/chat') {
    const text = String(b.text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 400);
    if (!text) return reply(req, res, 200, { ok: false, reason: 'Порожнє повідомлення.' });
    const to = b.to === 0 || b.to === 1 || b.to === 2 ? b.to : 'all';
    pushChat({ from: pl.name, fromToken: t, fromFaction: factionOf(t), to, text });
    return reply(req, res, 200, { ok: true });
  }
  res.writeHead(404); res.end();
}

const server = http.createServer((req, res) => { handle(req, res).catch(e => { console.error(e); try { reply(req, res, 500, { ok: false, reason: 'Помилка сервера.' }); } catch (x) { /* */ } }); });
server.keepAliveTimeout = 65000;
server.listen(PORT, () => {
  const port = server.address().port;
  if (process.send) process.send({ port, hostKey: HOST_KEY });
  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) lan.push(a.address);
  const hostUrl = `http://localhost:${port}/?host=${HOST_KEY}`;
  say('');
  say('  Юготарія — сервер онлайн-гри запущено');
  say('  ─────────────────────────────────────');
  say(`  Ви (хост) відкрийте:   ${hostUrl}`);
  for (const ip of lan) say(`  Гравці в тій самій мережі: http://${ip}:${port}/`);
  say(`  Гравці через інтернет: адреса вашого тунелю чи http://<ваша-зовнішня-IP>:${port}/ (див. README → «Онлайн-гра»)`);
  say(`  Збереження: ${SAVE_DIR}`);
  say('  Зупинити сервер: Ctrl+C (гра автоматично збережеться).');
  say('');
  if (!process.env.NO_BROWSER && !process.send) {
    const cmd = process.platform === 'win32' ? `start "" "${hostUrl}"` : process.platform === 'darwin' ? `open "${hostUrl}"` : `xdg-open "${hostUrl}"`;
    exec(cmd, () => {});
  }
});
function shutdown() { if (G.state) autosave(); say('Сервер зупинено, гру збережено.'); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
module.exports = { G, command, E };
