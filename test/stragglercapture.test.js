const L=require('./load.js')();
const {Engine,Scenario,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Користувач повідомив: відсталі боєздатні бійці («бг», розсіяні придушенням) біля живого
// ворога не мають просто «зникати безвісти» — логічніше, щоб їх брав у полон найближчий
// противник, як і покинутих поранених (ця поведінка вже була для поранених).
function blank(seed=17){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}

{
  const {s,g}=blank();
  const u=Scenario.createUnit(s,'inf_platoon',0,g.idx(20,20),9);
  u.personnel.straggling=10; u.personnel.fit-=10;
  const e=Scenario.createUnit(s,'inf_platoon',1,g.idx(21,20),9); // сусідній живий ворог
  s.units=[u,e];
  Engine.endOfHour(s);
  ok(u.personnel.captured>0,'частина відсталих позначена як захоплена: '+u.personnel.captured);
  ok(u.personnel.missing===0,'жодного не записано як «зниклого безвісти» — поруч ворог');
  ok(s.prisoners.length===1&&s.prisoners[0].holder===1&&s.prisoners[0].origin===0,'запис про полонених додано, власник — фракція-сусід');
  ok(s.prisoners[0].count===u.personnel.captured,'кількість полонених у записі збігається з captured');
}

// Без живого ворога поруч — стара поведінка (повернення чи «зникли безвісти») лишається
{
  const {s,g}=blank();
  const u=Scenario.createUnit(s,'inf_platoon',0,g.idx(20,20),9);
  u.personnel.straggling=10; u.personnel.fit-=10;
  s.units=[u];
  Engine.endOfHour(s);
  ok(u.personnel.captured===0,'без ворога поруч — полону немає');
  ok(s.prisoners.length===0,'без ворога поруч — записів про полонених немає');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
