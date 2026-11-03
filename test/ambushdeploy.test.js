const L=require('./load.js')();
const {Engine,Intel,Scenario,Combat,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

function blank(seed=17){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}

// Користувач повідомив: «Утьос не працює по бусу» — причина була в тому, що гравець ставив
// засідку, не розгорнувши важку зброю заздалегідь: засідка все одно «спрацьовувала», та стріляла
// лише особистою зброєю екіпажу (майже без ефекту по техніці). Тепер «Засідка» розгортає важку
// зброю автоматично.
{
  const {s,g}=blank();
  const bush=Scenario.createUnit(s,'hmg_team',1,g.idx(20,20),1);
  bush.deployed=false;
  s.units=[bush]; s.phase=1;
  ok(!bush.deployed,'Утьос спочатку не розгорнутий');
  const r=Engine.setStance(s,bush.id,'ambush');
  ok(r.ok,'ambush order accepted');
  ok(bush.deployed,'«Засідка» автоматично розгорнула Утьос');
  ok(bush.stance==='ambush','stance set to ambush');
}

// Те саме для «Оборони»
{
  const {s,g}=blank();
  const ags=Scenario.createUnit(s,'ags_team',0,g.idx(20,20),1);
  s.units=[ags]; s.phase=0;
  const r=Engine.setStance(s,ags.id,'defend');
  ok(r.ok&&ags.deployed,'«Оборона» також автоматично розгортає АГС-17');
}

// Реальний ефект: розгорнутий Утьос у засідці завдає техніці відчутної шкоди (не лише АКС-74У)
{
  const {s,g}=blank();
  const bush=Scenario.createUnit(s,'hmg_team',1,g.idx(20,20),1);
  s.units=[bush]; s.phase=1; Engine.setStance(s,bush.id,'ambush');
  const van=Scenario.createUnit(s,'civ_van',0,g.idx(22,20),1);
  s.units=[bush,van]; s.phase=0; Intel.update(s);
  const r=Engine.issueMoveOrder(s,van.id,g.idx(18,20));
  ok(r.ok,'move order accepted');
  ok(van.vehicle.condition<100,'deployed Утьос in ambush actually damages the bus: condition '+van.vehicle.condition);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
