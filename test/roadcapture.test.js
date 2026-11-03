const L=require('./load.js')();
const {Engine,Scenario,Hex,TERRAIN_ID,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Користувач побоювався, що «підтягування» прилеглих гексів після взяття села може
// розтектись по всій карті аж до міста ворога. Захист: захват іде лише вздовж дороги,
// обмежений жорстким лімітом дальності, і зупиняється одразу біля чужого населеного пункту.
function blank(seed=17){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=1;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}
// прокладає пряму дорогу довжиною n гексів від центру в напрямку d
function layRoad(s,g,from,d,n,level=1){
  const hexes=[from];
  let cur=from;
  for(let i=0;i<n;i++){
    const nx=g.neighbor(cur,d);
    if(nx<0) break;
    s.map.roadDirs[cur]|=(1<<d); s.map.roadDirs[nx]|=(1<<Hex.opposite(d));
    s.map.road[cur]=Math.max(s.map.road[cur],level); s.map.road[nx]=Math.max(s.map.road[nx],level);
    cur=nx; hexes.push(cur);
  }
  return hexes;
}

// 1. Довга порожня дорога (довша за ліміт) до віддаленого чужого села — захват не має
//    доповзти до нього, зупиняється на межі ліміту.
{
  const {s,g}=blank();
  const center=g.idx(10,20);
  const far=g.idx(40,20); // дуже далеко, за лімітом
  const villA={id:0,name:'Село А',kind:'village',center,control:1};
  const villFar={id:1,name:'Чуже місто',kind:'city',center:far,control:0};
  s.map.settlements=[villA,villFar];
  s.map.settlement[center]=0; s.map.settlement[far]=1;
  const road=layRoad(s,g,center,0,25,2); // прокладено на 25 гексів — значно більше за ліміт 11
  s.units=[Scenario.createUnit(s,'inf_platoon',0,center,9)];
  s.map.control[center]=1; // стартово під фракцією 1, щоб зафіксувати перехід
  Engine.endOfHour(s);
  ok(villA.control===0,'центр села А перейшов під фракцію 0');
  ok(s.map.control[road[CONFIG.rules.roadCaptureMaxHexes]]===0,'дорога захоплена рівно до межі ліміту');
  ok(s.map.control[road[CONFIG.rules.roadCaptureMaxHexes+2]]!==0,'за лімітом дорога НЕ захоплена — не дотяглась до чужого міста');
  ok(s.map.control[far]!==0,'чуже місто лишається недоторканим');
}

// 2. Дорога впирається у чуже село раніше за ліміт — захват має зупинитись на межі
//    цього села, не заходячи в нього.
{
  const {s,g}=blank();
  const center=g.idx(10,20);
  const road0=layRoad(s,g,center,0,10,1);
  const nearIdx=road0[5]; // село Б стоїть прямо на дорозі, за 5 гексів — у межах ліміту
  const villA={id:0,name:'Село А',kind:'village',center,control:1};
  const villB={id:1,name:'Село Б',kind:'village',center:nearIdx,control:1};
  s.map.settlements=[villA,villB];
  s.map.settlement[center]=0; s.map.settlement[nearIdx]=1;
  s.units=[Scenario.createUnit(s,'inf_platoon',0,center,9)];
  s.map.control[center]=1;
  Engine.endOfHour(s);
  ok(s.map.control[nearIdx]===1,'сусіднє чуже село НЕ захоплене разом з дорогою (лишається за старим господарем)');
  ok(s.map.control[road0[4]]===0,'дорога захоплена аж до межі чужого села, але не далі');
}

// 3. Смуга обабіч дороги (buffer) теж переходить, а живий ворог на гексі дороги лишає його спірним.
{
  const {s,g}=blank();
  const center=g.idx(10,20);
  const villA={id:0,name:'Село А',kind:'village',center,control:1};
  s.map.settlements=[villA];
  s.map.settlement[center]=0;
  const road=layRoad(s,g,center,0,4,1);
  const defIdx=road[3];
  const defender=Scenario.createUnit(s,'inf_platoon',1,defIdx,9);
  const attacker=Scenario.createUnit(s,'inf_platoon',0,center,9);
  s.units=[attacker,defender];
  s.map.control[center]=1;
  Engine.endOfHour(s);
  ok(s.map.control[road[1]]===0,'перший дорожній гекс захоплено');
  ok(s.map.control[defIdx]===1,'гекс дороги з живим ворогом лишається спірним');
  const sideBuf=g.neighbor(road[1],2);
  if(sideBuf>=0) ok(s.map.control[sideBuf]===0,'буферний гекс обабіч дороги теж перейшов: '+sideBuf);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
