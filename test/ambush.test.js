const L=require('./load.js')();
const {Engine,Intel,Scenario,Combat,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

function blank(seed=7){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}

// 1. Засідка перериває рух і атакує першою (ambush bonus)
{
  const {s,g}=blank();
  const buIdx=g.idx(20,20), moverStart=g.idx(26,20);
  const bush=Scenario.createUnit(s,'mg_team',1,buIdx,1);
  s.units=[bush]; s.phase=1; const sr=Engine.setStance(s,bush.id,'ambush'); if(!sr.ok)console.log('setStance err',sr.reason);
  const mover=Scenario.createUnit(s,'inf_squad',0,moverStart,1);
  s.units=[bush,mover]; s.phase=0; Intel.update(s);
  ok(!Intel.isVisible(s,0,bush.id),'mover does not see the hidden ambusher before moving');
  const target=g.idx(21,20); // walk toward the ambush, straight past it
  const r=Engine.issueMoveOrder(s,mover.id,target);
  ok(r.ok,'move order accepted');
  ok(r.result.ambushed || (r.result.contact && r.result.contact.some(x=>x.id===bush.id)),'movement interrupted by the ambusher: '+JSON.stringify({ambushed:r.result.ambushed,contact:(r.result.contact||[]).map(x=>x.id)}));
  ok(bush.attackedTurn===s.time.turn,'ambusher has fired this hour (consumed)');
  ok(mover.idx!==moverStart,'mover did move at least one step before being stopped');
}

// 2. Засідка спрацьовує лише раз на годину — другий мандрівник проходить без перешкод
{
  const {s,g}=blank();
  const buIdx=g.idx(20,20);
  const bush=Scenario.createUnit(s,'mg_team',1,buIdx,1);
  s.units=[bush]; s.phase=1; Engine.setStance(s,bush.id,'ambush');
  const m1=Scenario.createUnit(s,'inf_squad',0,g.idx(26,20),1);
  const m2=Scenario.createUnit(s,'inf_squad',0,g.idx(26,21),2);
  s.units=[bush,m1,m2]; s.phase=0; Intel.update(s);
  Engine.issueMoveOrder(s,m1.id,g.idx(21,20));
  ok(bush.attackedTurn===s.time.turn,'ambusher fired once');
  const idx2before=m2.idx;
  const r2=Engine.issueMoveOrder(s,m2.id,g.idx(21,21));
  ok(r2.ok&&!r2.result.ambushed,'second mover this hour is not ambushed again (weapon already fired)');
}

// 3. Будь-який рух чи наказ скасовує засідку
{
  const {s,g}=blank();
  const bush=Scenario.createUnit(s,'inf_squad',0,g.idx(20,20),1);
  s.units=[bush]; s.phase=0;
  const sr=Engine.setStance(s,bush.id,'ambush'); if(!sr.ok)console.log('setStance err3',sr.reason);
  ok(bush.stance==='ambush','ambush stance set');
  const r=Engine.setStance(s,bush.id,'defend');
  ok(r.ok&&bush.stance==='defend','switching to another stance clears ambush');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
