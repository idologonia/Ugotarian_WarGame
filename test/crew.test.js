const L=require('./load.js')();
const {Engine,Combat,Transport,Field,Loot,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Користувач: можна витягнути екіпаж із цілої техніки (не чекаючи, поки її знищать) —
// техніка лишається трофеєм; будь-хто (свій чи противник) може сформувати для неї новий
// екіпаж (Field.takeVehicle вже існував для цього).

// 1. покинути цілу машину — екіпаж стає піхотою, машина лишається цілим трофеєм (не уламком)
{
  const s=Engine.newGame(11); s.campaign.disabled=true; toPhase(s,0);
  const v=s.units.find(x=>x.faction===0 && x.vehicle && !x.vehicle.model.includes('Пікап'));
  const crewN=v.personnel.fit, idx=v.idx, vType=v.type;
  const r=Transport.abandonVehicle(s,v.id);
  ok(r.ok,'abandon vehicle ok: '+(r.reason||''));
  ok(!s.units.includes(v),'vehicle unit removed from play');
  const crew=Engine.unitById(s,r.unitId);
  ok(!!crew && crew.type==='crew' && crew.idx===idx,'crew unit created on foot at the same hex');
  ok(crew.personnel.fit===crewN,'crew keeps its personnel count: '+crew.personnel.fit);
  const c=Loot.cacheAt(s,idx,false);
  ok(!!c && c.vehicles && c.vehicles.length===1 && !c.vehicles[0].wreck,'the vehicle itself is left as an intact (non-wreck) trophy');
  ok(c.vehicles[0].type===vType,'trophy record matches the abandoned vehicle type');
}

// 2. хтось інший (своя піхота або противник) формує новий екіпаж для покинутої машини
{
  const s=Engine.newGame(11); s.campaign.disabled=true; toPhase(s,0);
  const v=s.units.find(x=>x.faction===0 && x.vehicle && !x.vehicle.model.includes('Пікап'));
  const idx=v.idx, vType=v.type;
  Transport.abandonVehicle(s,v.id);
  // ворог захоплює гекс і підводить піхоту з достатньою чисельністю
  s.units=s.units.filter(u=>!(u.faction===0 && u.idx===idx)); // прибираємо свій екіпаж, що пішов звідти
  s.map.control[idx]=1;
  const enemyInf=s.units.find(x=>x.faction===1 && !x.vehicle && CONFIG.unitTypes[x.type].move==='foot');
  enemyInf.idx=idx;
  const crewNeed=CONFIG.unitTypes[vType].vehicle.crew;
  enemyInf.personnel.fit=Math.max(enemyInf.personnel.fit,crewNeed+2);
  const c=Loot.cacheAt(s,idx,false);
  const why=Field.takeReason(s,enemyInf,c.vehicles[0]);
  ok(!why,'enemy can form a crew for the abandoned vehicle: '+why);
  toPhase(s,1);
  const before=enemyInf.personnel.fit;
  const r=Field.takeVehicle(s,enemyInf.id,0);
  ok(r.ok,'enemy forms a new crew and takes the vehicle: '+(r.reason||''));
  const newV=Engine.unitById(s,r.unitId);
  ok(!!newV && newV.faction===1 && newV.type===vType,'captured vehicle now belongs to the enemy with a fresh crew');
  ok(enemyInf.personnel.fit===before-crewNeed,'crew was drawn from the capturing infantry');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
