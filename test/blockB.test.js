const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,SaveSystem,Logistics,Politics,Recruit,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
// 1. формування
{const s=Engine.newGame(1999);s.campaign.disabled=true;const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);
 const n0=s.units.length,man0=s.economy[0].manpower,w0=dep.stock.weapons['АК-74'];
 const r=Recruit.form(s,0,dep.id,'inf_squad');ok(r.ok,'squad formation started');
 ok(s.economy[0].manpower===man0-5&&dep.stock.weapons['АК-74']<w0,'manpower and rifles taken');
 hours(s,4);const u=s.units.find(x=>x.type==='inf_squad'&&x.faction===0&&x.experience===0&&x.idx===dep.idx);
 ok(s.units.length>n0&&u&&Object.values(u.ammo).some(n=>n>0),'squad formed after 4 h with ammo: '+(u&&u.name));
 const r2=Recruit.form(s,0,dep.id,'mortar');ok(!r2.ok,'mortar needs a mortar on the depot: '+r2.reason);
 const dd=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===1);toPhase(s,1);const r3=Recruit.form(s,1,dd.id,'inf_squad');ok(r3.ok||/бракує/.test(r3.reason),'rebel formation uses АКМ or reports shortage: '+(r3.reason||'ok'));}
// 2. національні ополчення
{const s=Engine.newGame(1999);s.campaign.disabled=true;const v=s.map.settlements[3];toPhase(s,0);
 for(const g of Politics.GROUPS)v.support[g][0]=40;v.support.rus[0]=70;
 ok(!!Politics.militiaReason(s,0,v,'yug'),'yugotar militia refused (support 40)');
 const yugSup0=v.support.yug[0];const r=Politics.raiseMilitia(s,0,3,'rus');const u=r.ok&&Engine.unitById(s,r.unitId);
 ok(u&&u.ethnic==='rus'&&u.personnel.fit===6,'Russian militia raised: '+(u&&u.name));
 ok(v.support.yug[0]<yugSup0,'other groups get tense');
 ok(Politics.homeFactor(s,u)<1,'home bonus near home');u.idx=Engine.grid(s).idx(5,55);ok(Politics.homeFactor(s,u)>1,'penalty far from home');}
// 3. підпільна майстерня
{const s=Engine.newGame(1999);s.campaign.disabled=true;const v=s.map.settlements[1];toPhase(s,1);
 for(const g of Politics.GROUPS)v.support[g][1]=60;
 const r=Recruit.foundWorkshop(s,1,1);ok(r.ok,'workshop founded in '+v.name);const ws=Logistics.byId(s,r.id);
 ok(!Logistics.known(s,0).includes(ws),'enemy does not see the workshop');
 const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===1);const a0=dep.stock.ammo['762s'];
 hours(s,3);ok(dep.stock.ammo['762s']>a0||ws.stock.ammo['762s']>0,'workshop produces 7.62×39 ('+a0+' → '+dep.stock.ammo['762s']+')');
 for(const g of Politics.GROUPS)v.support[g][1]=10;hours(s,1);ok(ws.destroyed,'workshop exposed when support collapses');}
// 4. чорний ринок
{const s=Engine.newGame(1999);s.campaign.disabled=true;toPhase(s,2);const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===2);
 s.economy[2].money=5000;const m0=s.economy[2].money,w0=dep.stock.weapons['ПКМ']||0;
 const r=Recruit.buy(s,2,'ПКМ',2,dep.id);ok(r.ok&&s.economy[2].money===m0-3000,'2 PKM ordered for 3000');
 hours(s,5);ok((dep.stock.weapons['ПКМ']||0)===w0,'not yet delivered');hours(s,1);ok(dep.stock.weapons['ПКМ']===w0+2,'delivered after 6 h');
 ok(!Recruit.buy(s,2,'ПКМ',2,Logistics.facilities(s).find(f=>f.owner===0&&f.type==='depot').id).ok,'cannot deliver to enemy depot');}
// 5. збереження
{const s=Engine.newGame(1999);const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);Recruit.form(s,0,dep.id,'inf_squad');
 // соц. влада (0) не має чорного ринку (запит гравця) — тест на збереження market бере дем. фракцію (1)
 toPhase(s,1);const dep1=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===1);s.economy[1].money=1000;Recruit.buy(s,1,'med',1,dep1.id);
 const t=SaveSystem.serialize(s);const b=SaveSystem.deserialize(t);ok(b.ok&&b.state.formations.length===1&&b.state.market.length===1,'v8 save keeps formations and orders');
 const v7=JSON.parse(t);v7.version=7;delete v7.formations;delete v7.market;ok(SaveSystem.deserialize(JSON.stringify(v7)).ok,'v7 migrated');}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
