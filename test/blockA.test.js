const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,SaveSystem,Transport,Loot,Logistics,Politics,Field,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
function blank(seed=7){const s=Engine.newGame(seed);const g=Engine.grid(s);for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;}s.units=[];s.intel=[{},{},{}];s.facilities=[];s.campaign.disabled=true;s.phase=0;return {s,g};}
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
// 1. одноразові ПТГ лише по техніці
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_squad',0,g.idx(10,10),1),b=Scenario.createUnit(s,'inf_squad',1,g.idx(11,10),1);s.units=[a,b];Intel.update(s);
 Combat.attack(s,a.id,{unitId:b.id});ok(a.weapons['Одноразовий ПТГ']===1&&a.ammo.atd===1,'disposable not wasted on infantry');
 const v=Scenario.createUnit(s,'veh_uaz',1,g.idx(9,10),1);s.units.push(v);Intel.update(s);s.time.turn++;a.mp=16;
 Combat.attack(s,a.id,{unitId:v.id});ok(!a.weapons['Одноразовий ПТГ']&&!a.ammo.atd,'disposable fired at vehicle and spent tube removed');
 const dep=Logistics.makeFacility(s,'depot',a.idx,0,'Т');dep.stock.ammo.atd=5;a.ammo['545']=0;a.mp=16;a.attackedTurn=0;const r=Logistics.resupply(s,a.id);
 ok(r.ok&&a.weapons['Одноразовий ПТГ']===1,'resupply restores disposable launcher to quota');}
// 2. вантаж із родовища
{const s=Engine.newGame(1999);s.campaign.disabled=true;const of=Logistics.facilities(s).find(f=>f.type==='oil_field');of.stock.goods.crude=3000;const k=s.units.find(u=>u.type==='veh_kamaz'&&u.faction===0);k.idx=of.idx;
 const r=Logistics.loadFromStore(s,k.id,'crude');ok(r.ok&&k.cargo.goods.crude>0,'truck loads crude at the oil field: '+(r.text||r.reason));}
// 3. розгортання АГС і навісний вогонь з висоти
{const {s,g}=blank();const ags=Scenario.createUnit(s,'ags_team',0,g.idx(10,10),1),obs=Scenario.createUnit(s,'recon',0,g.idx(14,10),1),t=Scenario.createUnit(s,'inf_squad',1,g.idx(16,10),1);
 s.units=[ags,obs,t];Intel.update(s);
 Engine.issueMoveOrder(s,ags.id,g.idx(11,10));ok(!ags.deployed,'moving undeploys AGS');
 s.time.turn++;ags.mp=12;ags.movedThisPhase=false;let pv=Combat.previewAttack(s,ags.id,{unitId:t.id});ok(!pv.ok&&pv.reason.includes('розгорнути'),'must deploy first: '+pv.reason);
 ok(Engine.deploy(s,ags.id).ok&&ags.deployed,'deployed (25% hour)');
 pv=Combat.previewAttack(s,ags.id,{unitId:t.id});ok(pv.ok&&pv.indirect,'AGS indirect fire ok at '+pv.meters+' m');
 const far=g.idx(17,10);t.idx=far;obs.idx=g.idx(16,10);Intel.update(s);pv=Combat.previewAttack(s,ags.id,{unitId:t.id});ok(!pv.ok,'beyond 1250 m on flat: '+pv.reason);
 s.map.terrain[ags.idx]=TERRAIN_ID.mountains;pv=Combat.previewAttack(s,ags.id,{unitId:t.id});ok(pv.ok,'height bonus extends range ('+pv.meters+' m)');
 const r=Combat.attack(s,ags.id,{unitId:t.id});ok(r.ok&&t.suppression>0,'AGS suppresses target ('+Math.round(t.suppression)+')');}
// 4. Утьос проти УАЗа
{const {s,g}=blank();const h=Scenario.createUnit(s,'hmg_team',0,g.idx(10,10),1),v=Scenario.createUnit(s,'veh_uaz',1,g.idx(13,10),1);s.units=[h,v];Intel.update(s);
 const pv=Combat.previewAttack(s,h.id,{unitId:v.id});ok(pv.ok,'Utes hits UAZ at '+pv.meters+' m');const c0=v.vehicle.condition;Combat.attack(s,h.id,{unitId:v.id},'high');ok(v.vehicle.condition<c0,'UAZ damaged '+c0+'→'+v.vehicle.condition);}
// 5. інженери: понтон, укриття, підрив
{const {s,g}=blank();const row=10;for(let r=0;r<60;r++)s.map.river[g.idx(20,r)]=1;
 const e=Scenario.createUnit(s,'eng_squad',0,g.idx(19,row),1),k=Scenario.createUnit(s,'veh_kamaz',0,g.idx(19,row),1);s.units=[e,k];k.cargo.goods.eng=50;Intel.update(s);
 const opts=Field.options(s,e);ok(opts.some(o=>o.type==='bridge'),'bridge option next to river');
 const tgt=opts.find(o=>o.type==='bridge').target;
 ok(Field.startProject(s,e.id,'bridge',tgt).ok&&k.cargo.goods.eng===30,'bridge project started, engineering kit taken from truck');
 ok(!Engine.findPath(s,e,e.idx,g.idx(21,row)),'river not crossable yet');
 hours(s,3);ok(s.map.bridge[tgt]===1,'pontoon bridge built after 3 hours');ok(!!Engine.findPath(s,e,e.idx,g.idx(21,row)),'now crossable');
 const c0=Combat.coverOf(s,e);ok(Field.startProject(s,e.id,'shelter',e.idx).ok,'shelter started');hours(s,CONFIG.engineering.shelter.hours);ok(s.map.shelter[e.idx]===1&&Combat.coverOf(s,e)>c0,'shelter adds cover '+c0+'→'+Combat.coverOf(s,e));
 Engine.advanceToFaction(s,0); // ротація порядку фаз могла зсунути чергу фракції 0
 ok(Field.startProject(s,e.id,'demolish',tgt).ok,'demolition started');hours(s,1);ok(s.map.bridge[tgt]===0,'bridge demolished');
 const p2=Field.startProject(s,e.id,'shelter',e.idx);Engine.issueMoveOrder(s,e.id,g.idx(15,row));ok(!e.project,'moving cancels engineering work');}
// 6. покинута техніка — трофей; уламки — відновлення
{const {s,g}=blank();const at=g.idx(10,10);const v=Scenario.createUnit(s,'veh_mtlb',1,at,1),inf=Scenario.createUnit(s,'inf_platoon',0,g.idx(11,10),1);s.units=[v,inf];Intel.update(s);
 v.personnel.fit=0;v.personnel.killed=2;Combat.cleanup(s);const c=Loot.cacheAt(s,at);ok(c&&c.vehicles.length===1&&!c.vehicles[0].wreck&&c.vehicles[0].weapons['ПКТ']===1,'crewless MT-LB left in the hex with its ПКТ');
 inf.idx=at;const r=Field.takeVehicle(s,inf.id,0);const t=r.ok&&Engine.unitById(s,r.unitId);
 ok(t&&t.faction===0&&t.weapons['ПКТ']===1&&inf.personnel.fit===18,'captured MT-LB with crew from the platoon: '+(t?t.name:r.reason));
 t.destroyed=true;t.personnel.fit=0;Combat.cleanup(s);ok(c.vehicles.some(x=>x.wreck),'destroyed vehicle leaves a wreck');
 const e=Scenario.createUnit(s,'eng_squad',0,at,1);s.units.push(e);const dep=Logistics.makeFacility(s,'depot',at,0,'Т');dep.stock.goods.parts=20;
 const wi=c.vehicles.findIndex(x=>x.wreck);ok(Field.startProject(s,e.id,'restore',wi).ok,'restoration started');hours(s,4);ok(!c.vehicles[wi].wreck&&c.vehicles[wi].condition===30,'wreck restored to 30%');}
// 7. реквізиція, автопарк, технічка
{const s=Engine.newGame(1999);s.campaign.disabled=true;const v=s.map.settlements[3];
 const r=Politics?Field.requisition(s,0,3,'civ_van'):null;ok(r.ok&&Engine.unitById(s,r.unitId).type==='civ_van','van requisitioned in '+v.name);
 const mp=Logistics.facilities(s).find(f=>f.type==='motorpool');ok(mp&&mp.vehicles.veh_uaz===4,'motorpool with 4 military UAZ');
 const r2=Field.issueVehicle(s,0,mp.id,'veh_uaz');ok(r2.ok&&mp.vehicles.veh_uaz===3,'UAZ issued from motorpool');
 const u=Engine.unitById(s,r2.unitId);const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);u.idx=dep.idx;u.mp=80;
 const m=Field.mount(s,u.id,'НСВ «Утьос»');ok(m.ok&&u.mount==='НСВ «Утьос»'&&u.ammo['127']>0,'Utes mounted on UAZ (technical)');
 const pk=s.units.find(x=>x.type==='civ_pickup'&&x.faction===1);ok(pk&&pk.mount==='НСВ «Утьос»','dem technical pickup in scenario');}
// 8. цивільний легковик погано в полі
{const s=Engine.newGame(1999);const c=CONFIG.moveCost.car;ok(c.roadAsphalt<CONFIG.moveCost.wheeled.roadAsphalt&&c.plain>CONFIG.moveCost.wheeled.plain&&c.denseForest==null,'car: faster on asphalt, slower off-road');}
// 9. збереження v7 та міграція з v6
{const s=Engine.newGame(1999);hours(s,2);const t=SaveSystem.serialize(s);const b=SaveSystem.deserialize(t);ok(b.ok,'v7 save ok');
 Engine.endPhase(s);Engine.endPhase(b.state);ok(SaveSystem.serialize(s).replace(/"savedAt":\d+/,'')===SaveSystem.serialize(b.state).replace(/"savedAt":\d+/,''),'continues identically');
 const v6=JSON.parse(t);v6.version=6;delete v6.map.shelter;delete v6.projects;v6.facilities=v6.facilities.filter(f=>f.type!=='motorpool');const m=SaveSystem.deserialize(JSON.stringify(v6));ok(m.ok&&m.state.map.shelter&&m.state.facilities.some(f=>f.type==='motorpool'),'v6 save migrated');}
// 10. довга гра
{const s=Engine.newGame(1999);let attacks=0;
 for(let h=0;h<48*3&&!s.campaign.over;h++){const f=Engine.phaseFaction(s);
  for(const u of s.units.filter(x=>x.faction===f)){if(Combat.needsDeploy(u)&&!u.deployed)Engine.deploy(s,u.id);const vis=[...Intel.visibleIds(s,f)].map(id=>Engine.unitById(s,id)).filter(Boolean);let done=false;
   for(const e of vis){const r=Combat.attack(s,u.id,{unitId:e.id});if(r.ok){attacks++;done=true;break;}}
   if(!done&&!u.order&&Engine.canAct(u)&&u.embarked==null&&u.type!=='medevac'&&!Combat.needsDeploy(u))Engine.issueMoveOrder(s,u.id,s.map.settlements[0].center);}
  Engine.endPhase(s);}
 ok(true,'48h sim: attacks '+attacks+', units '+s.units.length+', vehicles left on map '+Object.values(s.caches).reduce((a,c)=>a+(c.vehicles||[]).length,0));
 ok(s.units.every(u=>Object.values(u.weapons).every(n=>n>0)&&Object.values(u.ammo).every(n=>n>=0)),'no zero/negative weapons or ammo');
 ok(SaveSystem.deserialize(SaveSystem.serialize(s)).ok,'save after sim');}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
