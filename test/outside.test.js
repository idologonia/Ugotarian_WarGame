// Об’єкти поза населеними пунктами (запит гравця): заводи боєприпасів і зброї, польові склади
// фракцій, покинуті об’єкти — на майданчиках біля доріг, за 2–7 гексів від межі пункту; з селом
// (смугою дороги) не переходять, їх беруть окремо, утримавши гекс.
const L=require('./load.js')();
const {Engine,Logistics,Scenario}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
for(const seed of [1999,7,42,2024]){
  const s=Engine.newGame(seed);const g=Engine.grid(s);
  const out=Logistics.facilities(s).filter(f=>['ammo_plant','arms_plant','fieldDepot'].includes(f.type)||f.owner===-1);
  const dToTown=i=>{let d=Infinity;for(let j=0;j<g.size;j++)if(s.map.settlement[j]>=0)d=Math.min(d,g.dist(i,j));return d;};
  ok(out.length>=9&&out.every(f=>s.map.settlement[f.idx]<0),`карта ${seed}: ${out.length} об’єктів поза пунктами`);
  ok(out.every(f=>{const d=dToTown(f.idx);return d>=2&&d<=7;}),`карта ${seed}: усі за 2–7 гексів від найближчого пункту`);
  ok([0,1,2].every(fc=>Logistics.facilities(s).some(f=>f.type==='fieldDepot'&&f.owner===fc)),`карта ${seed}: у кожної фракції є польовий склад на трасі`);
  ok(Logistics.facilities(s).some(f=>f.type==='depot'&&f.owner===0&&s.map.settlement[f.idx]>=0),`карта ${seed}: головний склад СВ лишився в місті`);
}
// об’єкт на трасі не переходить разом із селом
{
  const s=Engine.newGame(1999);
  const fd=Logistics.facilities(s).find(f=>f.type==='fieldDepot'&&f.owner===1);
  const vill=s.map.settlements[1];
  // СВ бере центр Села Б (порожнього), а склад на трасі не займає
  s.units=s.units.filter(u=>u.faction!==1);
  const sq=Scenario.createUnit(s,'inf_squad',0,vill.center,9);s.units.push(sq);
  for(let k=0;k<3;k++)Engine.endPhase(s);
  ok(vill.control===0,'СВ взяла Село Б');
  ok(s.map.control[fd.idx]!==0&&Logistics.byId(s,fd.id).owner===1,'польовий склад на трасі не перейшов разом із селом');
  // утримати гекс складу — і він переходить
  const sq2=Scenario.createUnit(s,'inf_squad',0,fd.idx,10);s.units.push(sq2);
  for(let k=0;k<3;k++)Engine.endPhase(s);
  ok(Logistics.byId(s,fd.id).owner===0,'утримали гекс складу — склад захоплено');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
