const L=require('./load.js')();
const {Engine,Logistics,Foreign,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Користувач: стосунки з патроном мають впливати на ціну/кулдаун ПВК і добровольців —
// кращі стосунки = дешевше й швидше.

// 1. межі: стосунки не виходять за [min,max]
{
  const s=Engine.newGame(1); toPhase(s,0);
  s.geo=[0,50,100];
  Foreign.adjustGeo(s,0,-10,'тест'); Foreign.adjustGeo(s,2,10,'тест');
  ok(Foreign.geo(s,0)===CONFIG.geopolitics.min,'relation clamps at min: '+Foreign.geo(s,0));
  ok(Foreign.geo(s,2)===CONFIG.geopolitics.max,'relation clamps at max: '+Foreign.geo(s,2));
}

// 2. гірші стосунки -> дорожче ПВК і довший/дорожчий заклик добровольців
{
  const s=Engine.newGame(1); toPhase(s,0);
  s.geo=[0,50,50];
  const priceBad=Foreign.pmcPrice(s,0,'platoon');
  s.geo[0]=100;
  const priceGood=Foreign.pmcPrice(s,0,'platoon');
  ok(priceGood<priceBad,'better relation -> cheaper PMC: '+priceBad+' -> '+priceGood);
  s.geo[0]=0;
  const cdBad=Foreign.volCooldownHours(s,0), costBad=Foreign.volCost(s,0);
  s.geo[0]=100;
  const cdGood=Foreign.volCooldownHours(s,0), costGood=Foreign.volCost(s,0);
  ok(cdGood<cdBad,'better relation -> shorter volunteer-call cooldown: '+cdBad+' -> '+cdGood);
  ok(costGood<=costBad,'better relation -> cheaper (or free) volunteer call: '+costBad+' -> '+costGood);
}

// 3. найм ПВК покращує стосунки (патрон задоволений, що в нього є клієнт)
{
  const s=Engine.newGame(1); toPhase(s,0);
  const store=Logistics.facilities(s).find(x=>Logistics.isStore(x)&&x.owner===0&&!x.destroyed);
  Logistics.ensureEconomy(s)[0].money=100000;
  const g0=Foreign.geo(s,0);
  Foreign.hirePmc(s,0,store.id,'platoon');
  ok(Foreign.geo(s,0)===g0+CONFIG.geopolitics.events.pmcUsed,'PMC hire bumps relation by events.pmcUsed');
}

// 4. звільнення пункту покращує стосунки з власним патроном
{
  const s=Engine.newGame(1); toPhase(s,0);
  const st=s.map.settlements.find(x=>x.pop);
  const g0=Foreign.geo(s,0);
  Foreign.onLiberate(s,0,st);
  ok(Foreign.geo(s,0)===g0+CONFIG.geopolitics.events.liberate,'liberation bumps relation by events.liberate');
}

// 5. при старті гри всі фракції мають стартові (однакові) стосунки
{
  const s=Engine.newGame(42);
  ok(JSON.stringify(s.geo)===JSON.stringify(CONFIG.geopolitics.startRelation),'fresh game starts at configured relation levels: '+s.geo);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
