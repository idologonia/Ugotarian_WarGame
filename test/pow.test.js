const L=require('./load.js')();
const {Engine,Scenario,Combat,Intel,Logistics,Politics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Запит гравця: «Полонені - допрацьовуємо» -> утримання/табори, примусова праця, допит.

// 1. утримання полонених коштує грошей щогодини (upkeep), якщо не на праці
{
  const s=Engine.newGame(2024);
  s.prisoners.push({holder:0,origin:1,count:10,unit:'Тест'});
  const eco=Logistics.ensureEconomy(s)[0];
  eco.money=1000;
  const before=eco.money;
  Politics.hourPrisoners(s);
  const expected=before-10*CONFIG.pow.upkeepPerHour;
  ok(Math.abs(eco.money-expected)<1e-6,'upkeep deducted for non-labor prisoners: '+eco.money+' vs '+expected);
}

// 2. праця полонених: чистий прибуток (> upkeep), і має «етичну ціну» — падіння підтримки
{
  const s=Engine.newGame(2024);
  s.prisoners.push({holder:0,origin:1,count:20,unit:'Тест'});
  const r=Politics.setLabor(s,0,0,true);
  ok(r.ok,'setLabor ok: '+(r.reason||''));
  ok(s.prisoners[0].labor===true,'batch marked as labor');
  const eco=Logistics.ensureEconomy(s)[0];
  eco.money=1000;
  const before=eco.money;
  const ownTown=s.map.settlements.find(x=>x.control===0&&x.pop);
  const supBefore=Politics.support(ownTown,0);
  Politics.hourPrisoners(s);
  const net=20*(CONFIG.pow.laborIncomePerHour-CONFIG.pow.upkeepPerHour);
  ok(Math.abs(eco.money-(before+net))<1e-6,'labor yields net income above upkeep: '+eco.money);
  const supAfter=Politics.support(ownTown,0);
  ok(supAfter<supBefore,'forced labor costs some political support: '+supBefore+' -> '+supAfter);
}

// 3. неоплачене утримання (борг) -> детермінований ризик втечі, повертає manpower фракції походження
{
  const s=Engine.newGame(2024);
  s.prisoners.push({holder:0,origin:1,count:50,unit:'Тест'});
  const eco=Logistics.ensureEconomy(s)[0];
  eco.money=-5000; // гарантовано в боргу щогодини
  const originEco=Logistics.ensureEconomy(s)[1];
  const manBefore=originEco.manpower;
  let escaped=false,countBefore=s.prisoners[0].count;
  for(let i=0;i<60 && !escaped;i++){
    s.time.turn++; // кожен виклик hourPrisoners відповідає окремій годині — й окремому кидку
    Politics.hourPrisoners(s);
    if(!s.prisoners.length || s.prisoners[0].count<countBefore){ escaped=true; }
  }
  ok(escaped,'unpaid upkeep eventually causes an escape (deterministic over enough hours)');
  ok(originEco.manpower>manBefore,'escaped prisoners return manpower to their origin faction');
}

// 4. допит: разова платна дія за партію, дає дані про стан фракції-походження
{
  const s=Engine.newGame(2024);
  s.prisoners.push({holder:0,origin:1,count:5,unit:'Тест'});
  Logistics.ensureEconomy(s)[0].money=50; // недостатньо
  let why=Politics.interrogateReason(s,0,0);
  ok(!!why,'cannot interrogate without enough money: '+why);
  Logistics.ensureEconomy(s)[0].money=1000;
  Logistics.ensureEconomy(s)[1].money=777; Logistics.ensureEconomy(s)[1].manpower=42;
  const r=Politics.interrogate(s,0,0);
  ok(r.ok,'interrogation succeeds: '+(r.reason||''));
  ok(s.prisoners[0].interrogated===true,'batch marked interrogated');
  const r2=Politics.interrogate(s,0,0);
  ok(!r2.ok,'cannot interrogate the same batch twice: '+r2.reason);
  const intel=Politics.powIntel(s,0,1);
  ok(!!intel && intel.money===777 && intel.manpower===42,'interrogation reveals origin faction economy state: '+JSON.stringify(intel));
}

// 5. дані з допиту «застарівають» після interrogateIntelHours
{
  const s=Engine.newGame(2024);
  s.prisoners.push({holder:0,origin:1,count:5,unit:'Тест'});
  Logistics.ensureEconomy(s)[0].money=1000;
  Politics.interrogate(s,0,0);
  ok(!!Politics.powIntel(s,0,1),'intel is fresh right after interrogation');
  s.time.turn+=CONFIG.pow.interrogateIntelHours+1;
  ok(!Politics.powIntel(s,0,1),'intel expires after interrogateIntelHours');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
