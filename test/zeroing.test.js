const L=require('./load.js')();
const {Engine,Intel,Combat,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const s=Engine.newGame(1999);s.campaign.disabled=true;
const g=Engine.grid(s);
const mor=s.units.find(u=>u.faction===0&&u.type==='mortar');
if(!mor.deployed)Engine.deploy(s,mor.id);
const z=Combat.fireZone(s,mor);
const hex=[...z.hexes].find(i=>g.dist(i,mor.idx)>5&&!s.units.some(u=>u.idx===i));
ok(hex!=null,'found empty target hex in range');
const Z=CONFIG.combat.zeroing;
// 1-ша година: базова точність знижена
mor.ammo.m81=40;
let pv=Combat.previewAttack(s,mor.id,{hex});
ok(pv.ok&&pv.zeroing.n===1&&Math.abs(pv.zeroing.mult-Z.first)<1e-9,'1st shot: n=1, mult='+pv.zeroing.mult);
Combat.attack(s,mor.id,{hex});
ok(mor.zeroing&&mor.zeroing.hex===hex&&mor.zeroing.n===1,'zeroing state recorded after shot 1');
// та сама година, та сама ціль, та ж позиція не йде вперед (жодної нової години) — перевіримо наступну годину
s.time.turn++;mor.attackedTurn=-1;mor.ammo.m81=40;
pv=Combat.previewAttack(s,mor.id,{hex});
ok(pv.zeroing.n===2&&Math.abs(pv.zeroing.mult-Z.second)<1e-9,'2nd consecutive hour: n=2, mult='+pv.zeroing.mult);
Combat.attack(s,mor.id,{hex});
s.time.turn++;mor.attackedTurn=-1;mor.ammo.m81=40;
pv=Combat.previewAttack(s,mor.id,{hex});
ok(pv.zeroing.n===3&&Math.abs(pv.zeroing.mult-Z.third)<1e-9,'3rd consecutive hour: n=3 (zeroed in), mult='+pv.zeroing.mult);
Combat.attack(s,mor.id,{hex});
s.time.turn++;mor.attackedTurn=-1;mor.ammo.m81=40;
pv=Combat.previewAttack(s,mor.id,{hex});
ok(pv.zeroing.n===3&&Math.abs(pv.zeroing.mult-Z.third)<1e-9,'4th+ consecutive hour stays at n=3 (capped)');
Combat.attack(s,mor.id,{hex});
// пропуск години скидає пристрілку
s.time.turn+=2;mor.attackedTurn=-1;mor.ammo.m81=40;
pv=Combat.previewAttack(s,mor.id,{hex});
ok(pv.zeroing.n===1,'skipping an hour resets zeroing to n=1: got '+pv.zeroing.n);
Combat.attack(s,mor.id,{hex});
// зміна цілі (іншого гекса) скидає пристрілку
const hex2=[...z.hexes].find(i=>i!==hex&&g.dist(i,mor.idx)>5&&!s.units.some(u=>u.idx===i));
s.time.turn++;mor.attackedTurn=-1;mor.ammo.m81=40;
pv=Combat.previewAttack(s,mor.id,{hex:hex2});
ok(pv.zeroing.n===1,'switching target hex resets zeroing to n=1');
Combat.attack(s,mor.id,{hex:hex2});
// зміна позиції скидає пристрілку, навіть по тому самому гексу цілі
s.time.turn++;mor.attackedTurn=-1;mor.ammo.m81=40;
pv=Combat.previewAttack(s,mor.id,{hex:hex2});
ok(pv.ok&&pv.zeroing.n===2,'baseline: 2nd consecutive hour on hex2 before moving: n='+(pv.zeroing&&pv.zeroing.n));
Combat.attack(s,mor.id,{hex:hex2});
const savedIdx = mor.idx;
let moved = -1;
for (let d = 0; d < 6; d++) { const n = g.neighbor(mor.idx, d); if (n >= 0 && g.dist(n, hex2) <= z.rangeHex) { moved = n; break; } }
ok(moved >= 0, 'found an adjacent hex still in range of hex2');
mor.idx = moved >= 0 ? moved : savedIdx;
s.time.turn++;mor.attackedTurn=-1;mor.ammo.m81=40;Intel.update(s);
pv=Combat.previewAttack(s,mor.id,{hex:hex2});
ok(pv.ok&&pv.zeroing.n===1,'moving the shooter resets zeroing even on the same target hex: n='+(pv.zeroing&&pv.zeroing.n));
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
