// Сервер онлайн-гри: лобі й хост, строгий туман війни в картинах, перевірка наказів,
// боти на сервері, приватний чат, збереження/завантаження й повернення гравця.
const { fork } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const saves = fs.mkdtempSync(path.join(os.tmpdir(), 'yugo-saves-'));

function start() {
  return new Promise((resolve, reject) => {
    const port = 19000 + Math.floor(Math.random() * 3000);
    const p = fork(path.join(__dirname, '../server/server.js'), ['--port', String(port)], { env: Object.assign({}, process.env, { NO_BROWSER: '1', YUGO_QUIET: '1', YUGO_HOST_KEY: 'k', YUGO_SAVES: saves }), silent: true });
    p.on('message', m => resolve({ p, base: `http://127.0.0.1:${m.port}` }));
    p.on('exit', c => reject(new Error('server exit ' + c)));
    setTimeout(() => reject(new Error('timeout')), 30000);
  });
}
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const view = (base, t) => fetch(`${base}/api/view?token=${t}`).then(async r => ({ status: r.status, body: await r.json() }));
const cmd = (base, t, mod, fn, args) => post(base, '/api/cmd', { token: t, mod, fn, args });
// SSE: зібрати події за ms мілісекунд
function events(base, t, ms) {
  return new Promise(resolve => {
    const out = [];
    const req = http.get(`${base}/api/events?token=${t}`, res => {
      let buf = '';
      res.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /event: (\w+)/.exec(chunk), da = /data: (.*)/.exec(chunk); if (ev && da) out.push({ ev: ev[1], data: JSON.parse(da[1]) }); } });
    });
    setTimeout(() => { req.destroy(); resolve(out); }, ms);
  });
}

(async () => {
  let { p, base } = await start();
  // 1. лобі
  const H = await post(base, '/api/join', { name: 'Хост', hostKey: 'k' });
  const F = await post(base, '/api/join', { name: 'Друг' });
  const X = await post(base, '/api/join', { name: 'Глядач' });
  ok(H.isHost && !F.isHost, 'хост за ключем, друг — ні');
  ok((await post(base, '/api/lobby', { token: F.token, action: 'start' })).ok === false, 'друг не може стартувати гру');
  await post(base, '/api/lobby', { token: H.token, action: 'slot', faction: 1, kind: 'human' });
  ok((await post(base, '/api/lobby', { token: H.token, action: 'take', faction: 0 })).ok, 'хост зайняв СВ');
  ok((await post(base, '/api/lobby', { token: F.token, action: 'take', faction: 1 })).ok, 'друг зайняв ДП');
  ok((await post(base, '/api/lobby', { token: X.token, action: 'take', faction: 1 })).ok === false, 'зайняту сторону не взяти');
  ok((await post(base, '/api/lobby', { token: X.token, action: 'take', faction: 2 })).ok === false, 'сторону бота не взяти');
  await post(base, '/api/lobby', { token: H.token, action: 'seed', seed: 1999 });
  ok((await post(base, '/api/lobby', { token: H.token, action: 'start' })).ok, 'гру розпочато');

  // 2. туман війни
  const vF = (await view(base, F.token)).body, vH = (await view(base, H.token)).body;
  ok(vF.units.every(u => u.faction === 1 || vF.view.visible.includes(u.id)), 'ДП отримує лише свої й видимі підрозділи');
  ok(vF.units.filter(u => u.faction === 0).length < vH.units.filter(u => u.faction === 0).length, `приховані підрозділи СВ не передано (${vF.units.filter(u => u.faction === 0).length} з ${vH.units.filter(u => u.faction === 0).length})`);
  ok(vF.economy[0].money === 0 && vF.economy[1].money > 0, 'чужа економіка прихована, своя — є');
  ok(Object.keys(vF.intel[0]).length === 0 && Object.keys(vF.intel[2]).length === 0, 'чужа розвідка прихована');
  ok(vF.geo[0] === null && vF.geo[1] != null, 'чужі стосунки зі спонсорами приховані');
  ok(!vF.ai, 'пам’ять ботів не передається');
  ok(vF.facilities.filter(x => x.owner === 0).every(x => !Object.keys(x.stock.ammo).length), 'запаси чужих об’єктів приховані');
  ok((await view(base, X.token)).status === 403, 'глядач без сторони картини не отримує');

  // 3. накази
  ok((await cmd(base, F.token, 'Engine', 'endPhase', [])).reason === 'Зараз не ваша фаза.', 'не у свою фазу — відхилено');
  ok((await cmd(base, H.token, 'Engine', 'newGame', [5])).reason === 'Невідомий наказ.', 'функція поза білим списком — відхилено');
  const dpUnit = vF.units.find(u => u.faction === 1);
  ok((await cmd(base, H.token, 'Engine', 'setStance', [dpUnit.id, 'defend'])).reason === 'Це не ваш підрозділ.', 'чужий підрозділ — відхилено');
  ok((await cmd(base, H.token, 'Foreign', 'requestInvestment', [1])).reason === 'Можна діяти лише від імені своєї сторони.', 'дія від імені іншої сторони — відхилено');
  const myUnit = vH.units.find(u => u.faction === 0 && u.type === 'inf_squad');
  const st = await cmd(base, H.token, 'Engine', 'setStance', [myUnit.id, 'defend']);
  ok(st.ok && st.result.ok && st.view.units.find(u => u.id === myUnit.id).stance === 'defend', 'наказ виконано на сервері, відповідь містить нову картину');
  const atk = await cmd(base, H.token, 'Combat', 'attack', [myUnit.id, { hex: 0 }, 'normal', { anyPhase: true, forceVisible: true }]);
  ok(atk.ok && atk.result && atk.result.ok === false, 'атака з підробленими службовими прапорцями не проходить');

  // 4. фази й боти на сервері: СВ → ДП (гравці), НП — бот
  ok((await cmd(base, H.token, 'Engine', 'endPhase', [])).ok, 'СВ завершила фазу');
  const e1 = await cmd(base, F.token, 'Engine', 'endPhase', []);
  ok(e1.ok, 'ДП завершила фазу');
  const v2 = (await view(base, H.token)).body;
  ok(v2.time.turn === 2, 'бот НП відходив на сервері, настала наступна година (хід ' + v2.time.turn + ')');

  // 5. чат: приватне повідомлення бачить лише адресат і автор
  const evF = events(base, F.token, 1200), evX = events(base, X.token, 1200);
  await new Promise(r => setTimeout(r, 300));
  await post(base, '/api/chat', { token: H.token, to: 1, text: 'Пропоную перемир’я' });
  await post(base, '/api/chat', { token: H.token, to: 'all', text: 'Усім привіт' });
  const [aF, aX] = await Promise.all([evF, evX]);
  const chatsF = aF.filter(e => e.ev === 'chat').map(e => e.data.text), chatsX = aX.filter(e => e.ev === 'chat').map(e => e.data.text);
  ok(chatsF.includes('Пропоную перемир’я') && chatsF.includes('Усім привіт'), 'ДП отримала приватне й загальне повідомлення');
  ok(!chatsX.includes('Пропоную перемир’я') && chatsX.includes('Усім привіт'), 'сторонній не бачить приватного повідомлення');
  ok(aF.some(e => e.ev === 'lobby') , 'SSE надсилає стан лобі');

  // 6. збереження, перезапуск сервера, повернення гравців за токеном
  ok((await post(base, '/api/lobby', { token: H.token, action: 'save' })).ok, 'хост зберіг гру');
  const turnBefore = v2.time.turn;
  p.kill('SIGTERM'); await new Promise(r => setTimeout(r, 500));
  ({ p, base } = await start());
  const H2 = await post(base, '/api/join', { name: 'Хост', hostKey: 'k' });
  const lob = await events(base, H2.token, 500);
  const saveList = lob.find(e => e.ev === 'lobby').data.saves;
  ok(saveList.some(s => s.file === 'autosave.json'), 'після перезапуску є автозбереження');
  ok((await post(base, '/api/lobby', { token: H2.token, action: 'load', file: 'autosave.json' })).ok, 'хост завантажив гру');
  const F2 = await post(base, '/api/join', { name: 'Друг', token: F.token });
  ok(F2.token === F.token, 'друг повернувся зі своїм токеном');
  const vF2 = await view(base, F.token);
  ok(vF2.status === 200 && vF2.body.view.faction === 1 && vF2.body.time.turn === turnBefore, 'друг знову керує ДП у тій самій грі');
  p.kill('SIGTERM');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
