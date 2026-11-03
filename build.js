const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'src');
const js=fs.readdirSync(dir).filter(f=>f.endsWith('.js')).sort().map(f=>'// ---- '+f+'\n'+fs.readFileSync(path.join(dir,f),'utf8')).join('\n');
const tpl=fs.readFileSync(path.join(dir,'index.template.html'),'utf8');
const out=tpl.replace('/*SCRIPT*/',()=>'"use strict";\n'+js);
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
// artifact version (no doctype: skeleton added on publish) and standalone version
fs.writeFileSync(path.join(__dirname,'dist','yugotaria.html'),out);
const standalone='<!DOCTYPE html>\n<html lang="uk">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'+out.replace('<style>','<style>\nbody{margin:0}\n').replace(/(<\/style>)/,'$1\n</head>\n<body>')+'\n</body>\n</html>\n';
fs.writeFileSync(path.join(__dirname,'dist','Yugotaria-Civil-War-stage4c.html'),standalone);
console.log('built', out.length, 'bytes');
