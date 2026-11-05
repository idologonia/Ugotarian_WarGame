// Аеропорт ДП і БПЛА RQ-1 Predator (07j_air.js); порт СВ ближче до середини узбережжя.
const L=require('./load.js')();
const {Engine,Air,Intel,Foreign,Logistics,Scenario,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{while(Engine.phaseFaction(s)!==f)Engine.endPhase(s);};
for(const seed of [1999,7,42]){
  const s=Engine.newGame(seed);const g=Engine.grid(s);
  const p=s.map.borderEntry[0],row=g.row(p);
  ok(row>=8&&row<=s.map.h-9&&g.dist(p,s.map.settlements[0].center)>=12,`карта ${seed}: порт СВ не на краю й не біля міста (рядок ${row}, до міста ${g.dist(p,s.map.settlements[0].center)})`);
  const ap=Air.airport(s,1);
  ok(ap&&ap.runway.length===3&&ap.idx===s.map.borderEntry[1],`карта ${seed}: аеропорт ДП зі смугою на 3 гекси на місці аеродрому`);
}
{
  const s=Engine.newGame(1999);toPhase(s,1);
  ok(Air.deliveryMult(s,1)===CONFIG.air.airportDeliveryMult,'аеропорт працює — доставка швидша');
  ok(!!Air.uavReason(s,1,null),'без рішення БПЛА недоступний');
  Air.unlock(s,1);
  // день — перевіримо, що не ніч
  ok(!Engine.isNight(s.time.hour),'зараз день');
  const city=s.map.settlements[0].center;
  const r=Air.launch(s,1,city);
  ok(r.ok&&r.seen>0,'виліт над містом виявив противника: '+r.seen);
  ok(Intel.knownList(s,1).some(m=>m.type),'дрон впізнає тип підрозділів');
  ok(!Air.launch(s,1,city).ok,'кулдаун між вильотами');
  Engine.endPhase(s);
  ok(Intel.visibleIds(s,1).size>0,'спостереження триває у фазі іншої фракції тієї ж години');
  for(let k=0;k<3;k++)Engine.endPhase(s);
  ok(Intel.visibleIds(s,1).size===0||!Air.activeSorties(s,1).length,'наступної години район уже не під наглядом');
  // захоплений аеропорт
  const ap=Air.airport(s,1);ap.owner=0;
  ok(Air.deliveryMult(s,1)===1&&/захоплено/.test(Air.uavReason(s,1,null)),'захоплений аеропорт: ні рейсів, ні вильотів');
}
{
  const s=Engine.newGame(1999);toPhase(s,1);Air.unlock(s,1);
  // ніч
  while(!Engine.isNight(s.time.hour)){for(let k=0;k<3;k++)Engine.endPhase(s);}
  toPhase(s,1);
  ok(/Вночі/.test(Air.uavReason(s,1,null)||''),'вночі не літає');
}
{
  // ризик втрати зростає біля «Утьоса»
  const s=Engine.newGame(1999);const g=Engine.grid(s);
  const t=g.idx(40,40);const base=Air.lossChance(s,1,t);
  const h=Scenario.createUnit(s,'hmg_team',0,g.idx(41,40),9);s.units.push(h);
  ok(Air.lossChance(s,1,t)>base,`ризик втрати біля «Утьоса» більший (${base}% → ${Air.lossChance(s,1,t)}%)`);
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
