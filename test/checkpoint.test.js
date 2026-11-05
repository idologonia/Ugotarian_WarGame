// Блокпост: будує інженер на дорозі; ворожа колона на ньому зупиняється; свій пост бачить далі
// й має укриття; захоплюється утриманням гекса.
const L=require('./load.js')();
const {Engine,Field,Logistics,Scenario,Intel,Combat,TERRAIN_ID,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
function blank(){
  const s=Engine.newGame(13);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=-1;s.map.settlement[i]=-1;}
  s.units=[];s.intel=[{},{},{}];s.facilities=[];
  // пряма асфальтова дорога по рядку 30
  for(let c=10;c<50;c++){const i=g.idx(c,30);s.map.road[i]=2;}
  for(let c=10;c<49;c++){const a=g.idx(c,30),b=g.idx(c+1,30);const d=g.dirTo(a,b);if(d>=0){s.map.roadDirs[a]|=1<<d;s.map.roadDirs[b]|=1<<((d+3)%6);}}
  return {s,g};
}
{
  const {s,g}=blank();
  const at=g.idx(30,30);
  const eng=Scenario.createUnit(s,'eng_squad',0,at,1);eng.cargo={weapons:{},ammo:{},goods:{eng:20}};s.units=[eng];
  s.phase=0;s.phaseOrder=[0,1,2];eng.mp=16;
  const opt=Field.options(s,eng).find(o=>o.type==='checkpoint');
  ok(!!opt,'інженер на дорозі може поставити блокпост');
  const off=Scenario.createUnit(s,'eng_squad',0,g.idx(30,35),2);
  ok(!Field.options(s,off).some(o=>o.type==='checkpoint'),'поза дорогою блокпост недоступний');
  const r=Field.startProject(s,eng.id,'checkpoint',at);ok(r.ok,'будівництво розпочато: '+(r.reason||''));
  for(let h=0;h<CONFIG.engineering.checkpoint.hours+1;h++){Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);}
  const cp=Logistics.facilities(s).find(f=>f.type==='checkpoint');
  ok(cp&&cp.owner===0&&cp.idx===at,'блокпост СВ збудовано');
  // свій пост бачить далі
  const r0=Intel.observeRange(s,off),r1=Intel.observeRange(s,eng);
  ok(r1>r0,`пост на блокпосту бачить далі (${r0} → ${r1})`);
  ok(Combat.coverOf(s,eng,{})>Combat.coverOf(s,off,{}),'пост на блокпосту має більше укриття');
  // ворожа колона по дорозі зупиняється на блокпосту (засідник ховається вбік, щоб не заважав)
  eng.idx=g.idx(30,25);
  const uaz=Scenario.createUnit(s,'veh_uaz',1,g.idx(20,30),1);s.units.push(uaz);
  while(Engine.phaseFaction(s)!==1)Engine.endPhase(s);
  uaz.mp=Engine.mpMax(uaz);
  const mv=Engine.issueMoveOrder(s,uaz.id,g.idx(45,30));
  ok(mv.ok&&uaz.idx===at,`колона зупинилась на блокпосту (${g.label(uaz.idx)})`);
  ok(s.log.some(e=>/ПЕРЕШКОДА:.*блокпост/.test(e.text)),'у журналі — перешкода «блокпост»');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
