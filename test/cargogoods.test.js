const L=require('./load.js')();
const {Engine,Scenario,Intel,Combat,Transport,Loot,Logistics,Field,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Знайдений ревʼю баг: вантаж goods (інженерне майно/БК, які тепер самі носять інженери й
// логістична група) ніде не враховувався в old код — зникав безслідно при знищенні
// підрозділу, при «Залишити вантаж», при залишенні машини екіпажем і при об’єднанні
// підрозділів. Перевіряємо, що тепер він коректно лишається трофеєм/переходить далі.

function blank(seed=7){
  const s=Engine.newGame(seed); s.campaign.disabled=true;
  const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.river[i]=0; s.map.terrain[i]=TERRAIN_ID.plain;}
  return {s,g};
}

// 1. знищений підрозділ (dropAll) лишає carried goods у гексі як трофеї
{
  const {s,g}=blank(); toPhase(s,0);
  const e=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  e.cargo.goods={eng:12};
  const idx=e.idx;
  Loot.dropAll(s,e);
  const c=Loot.cacheAt(s,idx,false);
  ok(!!c && c.goods && c.goods.eng===12,'destroyed engineer\'s carried eng goods become hex loot, not lost: '+JSON.stringify(c&&c.goods));
  ok(!Loot.isEmpty(c),'cache with only goods is NOT reported empty');
}

// 2. «Залишити вантаж у гексі» теперь охоплює goods
{
  const {s,g}=blank(); toPhase(s,0);
  const sup=s.units.find(x=>x.faction===0 && x.type==='inf_squad');
  sup.cargo.goods={parts:7};
  const r=Loot.dropCargo(s,sup.id);
  ok(r.ok,'dropCargo succeeds when only goods are carried (used to report "empty"): '+(r.reason||''));
  const c=Loot.cacheAt(s,sup.idx,false);
  ok(c.goods.parts===7,'dropped goods land in the hex cache: '+JSON.stringify(c.goods));
  ok(Object.keys(sup.cargo.goods).length===0,'unit cargo.goods cleared after dropping');
}

// 3. екіпаж залишає машину (abandonVehicle) — вантаж машини лишається в гексі, не зникає
{
  const {s,g}=blank(); toPhase(s,0);
  const v=s.units.find(x=>x.faction===0 && x.vehicle && !x.vehicle.model.includes('Пікап'));
  v.cargo.goods={fuel:40}; v.cargo.ammo={'545':300};
  const idx=v.idx;
  const r=Transport.abandonVehicle(s,v.id);
  ok(r.ok,'abandon vehicle ok: '+(r.reason||''));
  const c=Loot.cacheAt(s,idx,false);
  ok(!!c && c.goods.fuel===40,'truck cargo goods survive crew abandoning the vehicle: '+JSON.stringify(c&&c.goods));
  ok(!!c && c.ammo['545']===300,'truck cargo ammo survives too: '+JSON.stringify(c&&c.ammo));
}

// 4. об’єднання підрозділів переносить goods поглинутого, а не губить їх
{
  const {s,g}=blank(); toPhase(s,0);
  const a=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  const b=Scenario.createUnit(s,'eng_squad',0,a.idx,99);
  b.cargo.goods={eng:9};
  s.units.push(b);
  a.mp=Engine.mpMax(a); b.mp=Engine.mpMax(b);
  const r=Transport.merge(s,a.id,b.id);
  ok(r.ok,'merge ok: '+(r.reason||''));
  ok(a.cargo.goods.eng===9,'merged-in goods end up on the surviving unit: '+JSON.stringify(a.cargo.goods));
}

// 5. трофеї goods із гекса можна забрати («Забрати трофеї»)
{
  const {s,g}=blank(); toPhase(s,0);
  const e=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  const c=Loot.cacheAt(s,e.idx,true);
  c.goods.eng=15;
  e.mp=Engine.mpMax(e);
  const why=Loot.lootReason(s,e);
  ok(!why,'loot allowed when the cache has only goods: '+why);
  const r=Loot.loot(s,e.id);
  ok(r.ok,'loot ok: '+(r.reason||''));
  ok((e.cargo.goods.eng||0)===15,'picked-up goods land in the looting unit\'s cargo: '+JSON.stringify(e.cargo.goods));
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
