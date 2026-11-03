const L=require('./load.js')();
const {Engine,Scenario,Intel,Combat,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Користувач: привести бій до стандарту жанру варгеймів — видима, обмежена випадковість
// (±band), але детермінована (seed карти + юніти + година), а не Math.random().

function blank(seed){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}
function setup(seed,turn=1){
  const {s,g}=blank(seed);
  const a=Scenario.createUnit(s,'inf_platoon',0,g.idx(20,20),1);
  const d=Scenario.createUnit(s,'inf_platoon',1,g.idx(21,20),1);
  s.units=[a,d]; s.time.turn=turn; Intel.update(s);
  return {s,g,a,d};
}

// 1. кидок бою видимий у звіті й у межах ±band
{
  const band=CONFIG.combat.combatRoll.band;
  const {s,a,d}=setup(1000);
  const r=Combat.attack(s,a.id,{unitId:d.id});
  ok(r.ok,'attack ok');
  const step4=r.report.steps.find(x=>x.title.startsWith('4.'));
  const rollLine=step4.lines.find(l=>/кидок ×/.test(l));
  const m=rollLine&&rollLine.match(/кидок ×([\d,]+)/);
  ok(!!m,'roll is shown in the combat report: '+JSON.stringify(step4.lines));
  const roll=parseFloat(m[1].replace(',','.'));
  ok(roll>=1-band-1e-9&&roll<=1+band+1e-9,'roll within ±'+band+' band: '+roll);
}

// 2. детермінованість: той самий seed/юніти/година -> той самий кидок (не Math.random())
{
  const {s:s1,a:a1,d:d1}=setup(2000,5);
  const {s:s2,a:a2,d:d2}=setup(2000,5);
  const r1=Combat.attack(s1,a1.id,{unitId:d1.id});
  const r2=Combat.attack(s2,a2.id,{unitId:d2.id});
  ok(JSON.stringify(r1.report.steps)===JSON.stringify(r2.report.steps),'identical seed+turn -> identical combat report (deterministic roll)');
}

// 3. мінливість: інша година дає інший кидок для тих самих юнітів
{
  const {s,a,d}=setup(3000,1);
  const r1=Combat.attack(s,a.id,{unitId:d.id});
  const line1=r1.report.steps.find(x=>x.title.startsWith('4.')).lines.find(l=>/кидок ×/.test(l));
  const {s:s2,a:a2,d:d2}=setup(3000,2);
  const r2=Combat.attack(s2,a2.id,{unitId:d2.id});
  const line2=r2.report.steps.find(x=>x.title.startsWith('4.')).lines.find(l=>/кидок ×/.test(l));
  ok(line1!==line2,'different hour -> different roll for the same units: '+line1+' vs '+line2);
}

// 4. вимикач: combatRoll.enabled=false -> завжди ×1 (для юзабіліті/тестів старої поведінки)
{
  const prev=CONFIG.combat.combatRoll.enabled;
  CONFIG.combat.combatRoll.enabled=false;
  const {s,a,d}=setup(4000);
  const r=Combat.attack(s,a.id,{unitId:d.id});
  const step4=r.report.steps.find(x=>x.title.startsWith('4.'));
  const rollLine=step4.lines.find(l=>/кидок ×/.test(l));
  ok(rollLine&&/кидок ×1(?!\d)/.test(rollLine),'roll disabled -> ×1: '+JSON.stringify(step4.lines));
  CONFIG.combat.combatRoll.enabled=prev;
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
