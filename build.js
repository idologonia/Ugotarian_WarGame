// Збирає гру в один HTML-файл: усі src/*.js (за алфавітом) вставляються в шаблон
// src/index.template.html на місце /*SCRIPT*/.
//   dist/yugotaria.html          — версія для Artifact (без doctype: скелет додається при публікації)
//   dist/Yugotaria-Civil-War.html — самостійна сторінка, відкривається просто з диска
// node build.js --release <назва>  — додатково кладе копію самостійної версії в
//   releases/Yugotaria-Civil-War-<назва>.html (знімок етапу, напр. stage5).
const fs = require('fs'), path = require('path'), vm = require('vm');

const dir = path.join(__dirname, 'src');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const js = files.map(f => '// ---- ' + f + '\n' + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

// Перевірка синтаксису до запису: помилка в одному модулі інакше виявиться лише в браузері.
try { new vm.Script('"use strict";\n' + js, { filename: 'yugotaria.js' }); }
catch (e) { console.error('Синтаксична помилка у зібраному коді:\n' + e.stack.split('\n').slice(0, 5).join('\n')); process.exit(1); }

const tpl = fs.readFileSync(path.join(dir, 'index.template.html'), 'utf8');
const out = tpl.replace('/*SCRIPT*/', () => '"use strict";\n' + js);
const standalone = '<!DOCTYPE html>\n<html lang="uk">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  out.replace('<style>', '<style>\nbody{margin:0}\n').replace(/(<\/style>)/, '$1\n</head>\n<body>') + '\n</body>\n</html>\n';

const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'yugotaria.html'), out);
fs.writeFileSync(path.join(dist, 'Yugotaria-Civil-War.html'), standalone);

const rel = process.argv.indexOf('--release');
if (rel >= 0) {
  const name = process.argv[rel + 1];
  if (!name || !/^[\w.-]+$/.test(name)) { console.error('Вкажіть назву релізу: node build.js --release stage5'); process.exit(1); }
  fs.mkdirSync(path.join(__dirname, 'releases'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'releases', `Yugotaria-Civil-War-${name}.html`), standalone);
  console.log(`реліз: releases/Yugotaria-Civil-War-${name}.html`);
}
console.log(`зібрано ${files.length} модулів → dist/ (${(Buffer.byteLength(standalone) / 1024).toFixed(0)} КБ)`);
