const L=require('./load.js')();
const {Engine,Logistics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

ok(CONFIG.facilities.ammo_plant.out.ammo.g30>0,'ammo plant now produces ВОГ-17 (g30) for the АГС-17');
ok(CONFIG.facilities.ammo_plant.out.ammo['127']>0,'ammo plant now produces 12.7мм (127) for НСВ «Утьос»');

// Раніше: склад порожніє (бойове витрачання), а завод боєприпасів не виробляв ні g30, ні 127 —
// АГС і «Утьос» назавжди лишались без поповнення, щойно стартовий запас скінчився.
const s=Engine.newGame(3); s.campaign.disabled=true;
const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);
ok(!!dep,'found soc depot');
dep.stock.ammo.g30=0;
const ags=s.units.find(u=>u.faction===0&&u.type==='ags_team');
ags.idx=dep.idx; ags.ammo.g30=0; s.phase=0;
let r=Logistics.resupply(s,ags.id);
ok(r.ok,'resupply action executes');
ok(ags.ammo.g30===0,'with an empty depot, AGS correctly gets nothing yet (depot has to be restocked first)');

for (let i=0;i<10;i++) { s.time.turn++; Logistics.endOfHour(s); }
ok(dep.stock.ammo.g30>0,'ammo plant replenished the depot with g30 after a few hours of production: '+dep.stock.ammo.g30);
s.phase=0;
r=Logistics.resupply(s,ags.id);
ok(ags.ammo.g30>0,'AGS can now resupply g30 from the restocked depot: '+ags.ammo.g30);

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
