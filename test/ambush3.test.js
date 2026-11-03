const L=require('./load.js')();
const {Engine,Intel,Scenario,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

function blank(seed=13){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}

// Користувач повідомив: засідка розстрілює піхоту, але не техніку. Причина була не в броні,
// а в тому, що техніка (швидша, mp великий) частіше потрапляє в ДАЛЬНІСТЬ ЗБРОЇ засідки, лишаючись
// поза ЗВИЧНОЮ побіжною дальністю виявлення (3 гекси) — Combat.attack мовчки відмовляв.
{
  const {s,g}=blank();
  const buIdx=g.idx(20,20), moverStart=g.idx(30,20); // дист. 10, УАЗ долетить швидко
  const bush=Scenario.createUnit(s,'hmg_team',1,buIdx,1); // «Утьос», 1000 м = 4 гекс
  s.units=[bush]; s.phase=1; Engine.setStance(s,bush.id,'ambush');
  const uaz=Scenario.createUnit(s,'veh_uaz',0,moverStart,1);
  s.units=[bush,uaz]; s.phase=0; Intel.update(s);
  const target=g.idx(21,20);
  const r=Engine.issueMoveOrder(s,uaz.id,target);
  ok(r.ok,'move order accepted');
  ok(g.dist(uaz.idx,bush.idx)===4,'ambush stopped the vehicle exactly at weapon range (4 hex), not waiting for passive detection range: '+g.dist(uaz.idx,bush.idx));
  ok(r.result.ambushed || (r.result.contact && r.result.contact.some(x=>x.id===bush.id)),'vehicle ambush fired: '+JSON.stringify({ambushed:r.result.ambushed,contact:(r.result.contact||[]).map(x=>x.id)}));
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
