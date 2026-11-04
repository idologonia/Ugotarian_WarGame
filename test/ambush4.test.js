// Підготовлена засідка (наказ «Засідка»): підпускає ціль до найближчої точки маршруту,
// б'є всіма засідниками, що дістають, і помітно сильніша за випадкову атаку невидимим.
const L=require('./load.js')();
const {Engine,Intel,Scenario,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
function blank(){
  const s=Engine.newGame(13);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[];s.intel=[{},{},{}];return {s,g};
}
// Колона йде прямим маршрутом; засідники стоять поруч із його серединою.
function scenario(nAmb){
  const {s,g}=blank();
  const M=Scenario.createUnit(s,'inf_platoon',1,g.idx(20,30),1);s.units=[M];s.phase=1;s.phaseOrder=[0,1,2];
  const tgt=g.idx(40,30);const pv=Engine.previewMove(s,M.id,tgt);const mid=pv.path[8];
  const spots=g.within(mid,1).filter(i=>g.dist(i,mid)===1&&!pv.path.includes(i)).sort((a,b)=>a-b).slice(0,nAmb);
  const amb=spots.map((i,k)=>{s.map.terrain[i]=TERRAIN_ID.forest;const A=Scenario.createUnit(s,'inf_squad',0,i,k+1);A.stance='ambush';s.units.push(A);return A;});
  Intel.update(s);
  const r=Engine.issueMoveOrder(s,M.id,tgt);
  return {s,g,M,amb,r,closest:Math.min(...amb.map(a=>Math.min(...pv.path.map(i=>g.dist(i,a.idx)))))};
}
{
  const {s,g,M,amb,r}=scenario(1);
  ok(r.ok&&(r.result.ambushed||(r.result.contact||[]).length),'засідка спрацювала');
  ok(g.dist(M.idx,amb[0].idx)===1,'вогонь відкрито в найближчій точці маршруту (1 гекс), а не на межі дальності: '+g.dist(M.idx,amb[0].idx));
  ok(M.personnel.fit<=17,'засідка завдала відчутних втрат взводу: '+(20-M.personnel.fit));
}
{
  const {s,M,amb}=scenario(2);
  const fired=amb.filter(a=>a.firedTurn===s.time.turn).length;
  ok(fired===2||M.personnel.fit<=0,'обидва засідники стріляють разом (вогневий мішок): '+fired);
  const one=scenario(1).M.personnel.fit;
  ok(M.personnel.fit<one,'двоє засідників завдають більше втрат, ніж один: '+(20-M.personnel.fit)+' > '+(20-one));
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
