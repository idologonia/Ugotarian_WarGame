const L=require('./load.js')();
const {Engine,Scenario,Intel,Combat,Transport,Loot,Logistics,Politics,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};

function blank(seed=11){
  const s=Engine.newGame(seed); s.campaign.disabled=true;
  const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.river[i]=0; s.map.terrain[i]=TERRAIN_ID.plain;}
  return {s,g};
}

// 1. Виправлений баг: капітуляція більше не губить cargo.goods — вони переходять переможцю
{
  const {s,g}=blank(); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && x.type==='inf_squad');
  const captor=s.units.find(x=>x.faction===1 && x.type==='inf_squad');
  u.cargo.goods={eng:5};
  const lines=[];
  Combat.surrender(s,u,captor,lines);
  ok((captor.cargo.goods.eng||0)===5,'cargo.goods carried by a surrendering unit now reaches the captor: '+JSON.stringify(captor.cargo.goods));
  ok(Object.keys(u.cargo.goods).length===0,'surrendered unit\'s own cargo.goods cleared');
}

// 2. Непоховані тіла в гексі тиснуть на мораль щогодини, поки їх не забрано
{
  const {s,g}=blank(); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && x.type==='inf_squad');
  u.morale=u.baseMorale=50;
  // немає сусіднього ворога й бою — за звичайних умов мораль мала б відновлюватись, не падати
  const c=Loot.cacheAt(s,u.idx,true); c.dead[0]=2;
  const before=u.morale;
  hours(s,1);
  ok(u.morale===before-CONFIG.combat.deadMoraleLoss,'morale drops by deadMoraleLoss while own dead remain in the hex: '+before+' -> '+u.morale);
}

// 3. «Забрати загиблих» прибирає тіла, знімає дебаф і веде рахунок
{
  const {s,g}=blank(); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && x.type==='inf_squad');
  u.morale=u.baseMorale=50; u.mp=Engine.mpMax(u);
  const c=Loot.cacheAt(s,u.idx,true); c.dead[0]=3;
  const why=Loot.recoverDeadReason(s,u);
  ok(!why,'recoverDead allowed when own dead are present: '+why);
  const r=Loot.recoverDead(s,u.id);
  ok(r.ok && r.n===3,'recoverDead reports the correct count: '+JSON.stringify(r));
  ok(c.dead[0]===0,'hex dead count cleared after recovery');
  ok(s.stats.recovered[0]===3,'state.stats.recovered tracks recovered bodies: '+s.stats.recovered[0]);
  const before=u.morale;
  hours(s,1);
  ok(u.morale>=before,'no more morale loss once the dead are recovered: '+before+' -> '+u.morale);
}

// 4. recordCasualties веде розбивку хто кого вбив/ранив (killedOf/woundedOf), не лише сумарно
{
  const {s,g}=blank(); toPhase(s,0);
  Politics.recordCasualties(s,0,1,{cas:5,killed:2,wounded:3});
  ok(s.stats.inflicted[0]===5,'aggregate inflicted still updates: '+s.stats.inflicted[0]);
  ok(s.stats.killedOf[0][1]===2,'killedOf[attacker][victim] breakdown recorded: '+s.stats.killedOf[0][1]);
  ok(s.stats.woundedOf[0][1]===3,'woundedOf[attacker][victim] breakdown recorded: '+s.stats.woundedOf[0][1]);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
