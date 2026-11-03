// Запускає всі test/*.test.js паралельно (кожен — окремий процес) і друкує підсумок.
//   node test/run.js            — усі тести
//   node test/run.js combat ew  — лише ті, в чиїй назві є «combat» або «ew»
// Тест вважається проваленим, якщо завершився з ненульовим кодом.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const filters = process.argv.slice(2);
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'))
  .filter(f => !filters.length || filters.some(x => f.includes(x))).sort();
if (!files.length) { console.error('Тестів не знайдено.'); process.exit(1); }

const jobs = Math.max(1, Math.min(files.length, os.cpus().length));
const results = [];
let next = 0;
const t0 = Date.now();

function runOne(file) {
  return new Promise(resolve => {
    const start = Date.now();
    const p = spawn(process.execPath, [path.join(__dirname, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { out += '\n[перевищено час очікування 180 с]'; p.kill(); }, 180000);
    p.on('close', code => { clearTimeout(timer); resolve({ file, code, out, ms: Date.now() - start }); });
  });
}

async function worker() {
  while (next < files.length) {
    const r = await runOne(files[next++]);
    results.push(r);
    process.stdout.write(r.code === 0 ? '.' : 'F');
  }
}

Promise.all(Array.from({ length: jobs }, worker)).then(() => {
  process.stdout.write('\n');
  const failed = results.filter(r => r.code !== 0).sort((a, b) => a.file.localeCompare(b.file));
  for (const r of failed) {
    console.log(`\n✗ ${r.file} (код ${r.code})`);
    console.log(r.out.trim().split('\n').slice(-25).map(l => '    ' + l).join('\n'));
  }
  const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3).map(r => `${r.file} ${(r.ms / 1000).toFixed(1)} с`).join(', ');
  console.log(`\n${results.length - failed.length}/${results.length} пройдено за ${((Date.now() - t0) / 1000).toFixed(1)} с. Найдовші: ${slow}`);
  process.exit(failed.length ? 1 : 0);
});
