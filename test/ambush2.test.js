const L=require('./load.js')();
const {Engine,Intel,Scenario,Combat,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

function blank(seed=11){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}

// Засідка з дальньою зброєю («Утьос», 1500 м = 6 гекс) мусить спрацювати за 5 гекс у чистому полі —
// хоча звичайна (побіжна) дальність виявлення піхоти лише 3 гекси. Дальність зброї + відсутність
// перекритої лінії вогню важливіші за звичне побіжне виявлення — засідка цілеспрямовано стежить.
{
  const {s,g}=blank();
  const buIdx=g.idx(20,20), moverStart=g.idx(30,20);
  const bush=Scenario.createUnit(s,'hmg_team',1,buIdx,1);
  s.units=[bush]; s.phase=1; const sr=Engine.setStance(s,bush.id,'ambush'); if(!sr.ok)console.log('setStance err',sr.reason);
  const mover=Scenario.createUnit(s,'inf_squad',0,moverStart,1);
  s.units=[bush,mover]; s.phase=0; Intel.update(s);
  ok(g.dist(buIdx,moverStart)>=5,'mover starts beyond passive detection range (3 hex) but within weapon range (6 hex)');
  const target=g.idx(21,20); // пройде повз засідку на 5-6 гексах
  const r=Engine.issueMoveOrder(s,mover.id,target);
  ok(r.ok,'move order accepted');
  ok(r.result.ambushed || (r.result.contact && r.result.contact.some(x=>x.id===bush.id)),
    'ambush with long-range weapon fires beyond normal detection range: '+JSON.stringify({ambushed:r.result.ambushed,contact:(r.result.contact||[]).map(x=>x.id)}));
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
