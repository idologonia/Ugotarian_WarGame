const L=require('./load.js')();
const {Engine,Intel,Scenario,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

function blank(seed=5){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}

// Умова користувача: «можна пройти 10 гексів, пройшов 5, подумав і пройшов ще 5» — у межах
// очок руху тієї самої години, без очікування наступної.
{
  const {s,g}=blank();
  const u=Scenario.createUnit(s,'inf_squad',0,g.idx(10,10),1);
  s.units=[u]; s.phase=0; Intel.update(s);
  const mpStart=u.mp;
  ok(mpStart>=10,'unit has at least 10 MP this hour (foot mp='+mpStart+')');

  const t1=g.idx(15,10); // 5 гекс
  const r1=Engine.issueMoveOrder(s,u.id,t1);
  ok(r1.ok && !r1.pending,'first 5-hex move order executes immediately (not pending)');
  ok(u.idx===t1,'unit arrived at the first waypoint: '+g.label(u.idx));
  ok(u.mp>0,'unit still has leftover MP this hour: '+u.mp);
  ok(!u.order,'first order fully completed, no order left pending on the unit');

  const t2=g.idx(20,10); // ще 5 гекс
  const pv=Engine.previewMove(s,u.id,t2);
  ok(pv.ok && !pv.pending,'second move preview says it executes THIS hour, not deferred: pending='+pv.pending);
  const r2=Engine.issueMoveOrder(s,u.id,t2);
  ok(r2.ok && !r2.pending,'second 5-hex move order ALSO executes immediately in the same hour');
  ok(u.idx===t2,'unit reached the second waypoint in the same hour: '+g.label(u.idx));
}

// Якщо очки руху цієї години вже витрачено повністю — новий наказ руху таки відкладається.
{
  const {s,g}=blank();
  const u=Scenario.createUnit(s,'inf_squad',0,g.idx(10,10),1);
  s.units=[u]; s.phase=0; Intel.update(s);
  u.mp=0; u.movedThisPhase=true;
  const pv=Engine.previewMove(s,u.id,g.idx(12,10));
  ok(pv.ok && pv.pending,'with 0 MP left this hour, a new move order is still deferred to next hour');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
