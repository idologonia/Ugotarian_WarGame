const L=require('./load.js')();
const {Engine,Combat,Logistics,Field,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Користувач: забудова захищає в місті (вже є через CONFIG.combat.cover), окопи — лише
// піхота/інженери, лише в полі/лісі (не в горах), бліндаж — інженерний проєкт, стійкіший і
// захищає польовий склад під ним (довше захоплюється, запаси не розграбовуються при захопленні).

function blank(seed=7){
  const s=Engine.newGame(seed); s.campaign.disabled=true;
  const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.river[i]=0;}
  return {s,g};
}

// 1. піхота в обороні на рівнині отримує окопи (u.fort росте, cover росте)
{
  const {s,g}=blank(); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && CONFIG.unitTypes[x.type].move==='foot');
  s.map.terrain[u.idx]=TERRAIN_ID.plain;
  Engine.setStance(s,u.id,'defend');
  const c0=Combat.coverOf(s,u);
  hours(s,1);
  ok(u.fort===1,'infantry digs in on plain (fort=1): '+u.fort);
  ok(Combat.coverOf(s,u)>c0,'cover increased after digging trenches');
}

// 2. у горах окопи не копають (піхота) — fort лишається 0
{
  const {s}=blank(); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && CONFIG.unitTypes[x.type].move==='foot');
  s.map.terrain[u.idx]=TERRAIN_ID.mountains;
  Engine.setStance(s,u.id,'defend');
  hours(s,2);
  ok(u.fort===0,'no trenches in mountains: fort='+u.fort);
}

// 3. у забудові (місто) окопи теж не копають — захист там дає сама забудова
{
  const {s}=blank(); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && CONFIG.unitTypes[x.type].move==='foot');
  s.map.terrain[u.idx]=TERRAIN_ID.city;
  Engine.setStance(s,u.id,'defend');
  hours(s,2);
  ok(u.fort===0,'no trenches dug inside a city (buildings already cover): fort='+u.fort);
  ok(CONFIG.combat.cover.city>0,'city terrain itself has intrinsic cover');
}

// 4. техніка не копає окопів, навіть у полі, в обороні
{
  const {s}=blank(); toPhase(s,0);
  const v=s.units.find(x=>x.faction===0 && x.vehicle);
  s.map.terrain[v.idx]=TERRAIN_ID.plain;
  Engine.setStance(s,v.id,'defend');
  hours(s,2);
  ok(v.fort===0,'vehicles do not dig trenches: fort='+v.fort);
}

// 5. бліндаж (інженерний проєкт) захищає польовий склад — довше захоплюється
{
  const {s,g}=blank(); toPhase(s,0);
  const e=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  s.map.terrain[e.idx]=TERRAIN_ID.plain;
  Logistics.ensureEconomy(s)[0].money=0;
  const st=Logistics.makeFacility(s,'fieldDepot',e.idx,0,'Польовий склад тест');
  st.stock.goods.parts=100;
  ok(Field.startProject(s,e.id,'shelter',e.idx).ok,'bunker project started');
  hours(s,CONFIG.engineering.shelter.hours);
  ok(s.map.shelter[e.idx]===1,'bunker level 1 built');
  // імітуємо захоплення: прибираємо всіх своїх із гекса (інакше controlByHolding поверне
  // контроль назад щогодини, доки там стоїть власний підрозділ) і ставимо контроль ворога.
  e.idx=-1; s.units=s.units.filter(u=>u.idx>=0);
  s.map.control[st.idx]=1;
  hours(s,1);
  ok(st.owner===0,'bunkered store NOT captured after just 1 hour of enemy control: '+st.owner);
  hours(s,CONFIG.engineering.shelter.captureHours-1);
  ok(st.owner===1,'bunkered store captured after captureHours of sustained enemy control');
  ok(st.stock.goods.parts===100,'bunkered store supplies intact on capture (no exposed loss)');
}

// 6. польовий склад БЕЗ бліндажу — захоплюється миттєво, але частину запасів втрачено
{
  const {s}=blank(); toPhase(s,0);
  const idx=s.units.find(x=>x.faction===0).idx;
  const st=Logistics.makeFacility(s,'fieldDepot',idx,0,'Відкритий склад');
  st.stock.goods.parts=100;
  s.units=s.units.filter(u=>u.idx!==idx);
  s.map.control[idx]=1;
  hours(s,1);
  ok(st.owner===1,'unbunkered store captured instantly');
  ok(st.stock.goods.parts<100 && st.stock.goods.parts>0,'unbunkered store loses a share of supplies on capture: '+st.stock.goods.parts);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
