const L=require('./load.js')();
const {Engine,Combat,Field,Mines,Logistics,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

function blank(seed=7){
  const s=Engine.newGame(seed); s.campaign.disabled=true;
  const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.river[i]=0; s.map.terrain[i]=TERRAIN_ID.plain;}
  return {s,g};
}

// 1. інженер закладає протипіхотне мінне поле, маючи міни в вантажі поруч
{
  const {s,g}=blank(); toPhase(s,0);
  const e=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  const dep=Logistics.makeFacility(s,'depot',e.idx,0,'тест-склад');
  dep.stock.goods.mineAp=50; dep.stock.goods.mineAt=50;
  const opts=Field.options(s,e);
  ok(opts.some(o=>o.type==='mineAp'),'AP minefield offered to engineer');
  ok(opts.some(o=>o.type==='mineAt'),'AT minefield offered to engineer');
  ok(Field.startProject(s,e.id,'mineAp',e.idx).ok,'AP mine project started');
  hours(s,Math.ceil(CONFIG.engineering.mineAp.hours));
  const f=Mines.fieldAt(s,e.idx);
  ok(!!f && f[0] && f[0].ap===CONFIG.engineering.mineAp.n,'AP minefield laid: '+JSON.stringify(f));
}

// 2. вороже піхотне мінне поле зачіпає чужу піхоту, що заходить у гекс; свої міни не чіпають
{
  const {s,g}=blank(); toPhase(s,0);
  Mines.lay(s,0,g.idx(10,10),'ap',12);
  const own=s.units.find(x=>x.faction===0 && !x.vehicle);
  own.idx=g.idx(10,10);
  const r1=Mines.checkTrigger(s,own);
  ok(r1===null,"own faction's mines don't trigger on its own units");
  const enemy=s.units.find(x=>x.faction===1 && !x.vehicle);
  const fitBefore=enemy.personnel.fit;
  enemy.idx=g.idx(10,10);
  const r2=Mines.checkTrigger(s,enemy);
  ok(!!r2,'enemy infantry triggers the AP minefield');
  ok(enemy.personnel.fit<=fitBefore,'enemy took casualties or at least got shaken by AP mines');
  const left=Mines.fieldAt(s,g.idx(10,10));
  ok(left[0].ap<12,'part of the minefield is consumed after triggering: '+left[0].ap);
}

// 3. протитанкове мінне поле пошкоджує/знищує техніку, не зачіпає піхоту
{
  const {s,g}=blank(); toPhase(s,0);
  Mines.lay(s,0,g.idx(20,20),'at',8);
  const inf=s.units.find(x=>x.faction===1 && !x.vehicle);
  const fitBefore=inf.personnel.fit;
  inf.idx=g.idx(20,20);
  Mines.checkTrigger(s,inf);
  ok(inf.personnel.fit===fitBefore,'AT mines do not hurt infantry');
  const veh=s.units.find(x=>x.faction===1 && x.vehicle);
  const condBefore=veh.vehicle.condition;
  veh.idx=g.idx(20,20);
  const r=Mines.checkTrigger(s,veh);
  ok(!!r,'vehicle triggers the AT minefield');
  ok(veh.vehicle.condition<condBefore || r.destroyed,'vehicle damaged (or destroyed) by AT mines');
}

// 4. розмінування знешкоджує чужі міни в гексі
{
  const {s,g}=blank(); toPhase(s,0);
  const e=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  Mines.lay(s,1,e.idx,'ap',6);
  const opts=Field.options(s,e);
  ok(opts.some(o=>o.type==='clearMines'),'clearing foreign mines is offered when present');
  ok(Field.startProject(s,e.id,'clearMines',e.idx).ok,'clear-mines project started');
  hours(s,CONFIG.engineering.clearMines.hours);
  ok(!Mines.fieldAt(s,e.idx),'minefield cleared');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
