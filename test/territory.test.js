const L=require('./load.js')();
const {Engine,Scenario,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Користувач повідомив: доводиться вручну обходити КОЖЕН гекс села, навіть коли центр
// (і отже політичний контроль села) уже взято. Тепер: щойно центр переходить — решта
// гексів цього населеного пункту без живого ворога переходить разом з ним автоматично;
// гекс, де ще сидить противник, лишається спірним.
function blank(seed=17){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=1;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}

{
  const {s,g}=blank();
  const center=g.idx(20,20);
  const ring=[0,1,2,3,4,5].map(d=>g.neighbor(center,d)).filter(i=>i>=0);
  ok(ring.length>=4,'has at least 4 neighbor hexes to test with: '+ring.length);
  const vill={id:0,name:'Тестове',kind:'village',center,control:1};
  s.map.settlements=[vill];
  for(const idx of [center,...ring]) s.map.settlement[idx]=0;
  // стартовий стан: усе під фракцією 1 (і центр, і кільце)
  for(const idx of [center,...ring]) s.map.control[idx]=1;

  // фракція 0 займає й утримує лише центр; одна з кільцевих клітин лишається з живим
  // підрозділом фракції 1 (має залишитись спірною), решта кільця — порожня.
  const attacker=Scenario.createUnit(s,'inf_platoon',0,center,9);
  const defender=Scenario.createUnit(s,'inf_platoon',1,ring[0],9);
  s.units=[attacker,defender];

  Engine.endOfHour(s);

  ok(s.map.control[center]===0,'центр перейшов під фракцію 0');
  ok(vill.control===0,'політичний контроль села теж перейшов на фракцію 0');
  ok(s.map.control[ring[0]]===1,'гекс з живим ворогом (фракція 1) лишився спірним — не перейшов');
  for(let i=1;i<ring.length;i++){
    ok(s.map.control[ring[i]]===0,'порожній гекс кільця '+i+' автоматично перейшов під фракцію 0');
  }
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
