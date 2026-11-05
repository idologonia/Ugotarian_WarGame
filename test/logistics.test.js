const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,SaveSystem,Transport,Loot,Logistics,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
// 1. розміщення
{const s=Engine.newGame(1999);const F=Logistics.facilities(s);
 ok(F.length===20,'20 facilities placed (incl. 3 field depots on roads, the DP airport and neutral unclaimed ones) ('+F.map(f=>f.type+':'+f.owner).join(', ')+')');
 ok(F.every(f=>f.idx>=0&&s.map.terrain[f.idx]!==TERRAIN_ID.sea),'all on land');
 ok(F.filter(f=>f.type==='depot'&&f.owner>=0).length===3,'one owned depot per faction (plus neutral unclaimed depots elsewhere)');
 ok(Logistics.known(s,1).every(f=>f.owner!==0),'rebels do not know socialist facilities at start');
 const e=Logistics.summary(s,0);ok(e.income>0&&e.forecast.length===6,'economy summary with 6h forecast (income '+e.income+'/h, expense '+e.expense+'/h)');
}
// 2. виробництво й мережа
{const s=Engine.newGame(1999);const F=Logistics.facilities(s);const dep=F.find(f=>f.type==='depot'&&f.owner===0);
 const a0=dep.stock.ammo['545'];const fuel0=dep.stock.goods.fuel;const money0=s.economy[0].money;
 hours(s,3);
 ok(dep.stock.ammo['545']>a0-5000,'ammo plant output reaches depot (5.45: '+a0+' -> '+dep.stock.ammo['545']+')');
 ok(dep.stock.goods.fuel>fuel0-2000,'refinery fuel reaches depot ('+fuel0+' -> '+dep.stock.goods.fuel+')');
 ok(s.economy[0].money!==money0,'money changes ('+money0+' -> '+s.economy[0].money+')');
 const ref=F.find(f=>f.type==='refinery');ok(s.log.some(e=>e.text.includes('л нафти →')),'refinery processes crude');
}
// 3. автопостачання й поповнення людьми
{const s=Engine.newGame(1999);const u=s.units.find(x=>x.faction===0&&x.type==='inf_squad');
 u.ammo['545']=0;u.personnel.fit=3;u.personnel.killed=2;u.weapons['АК-74']=2;
 const man0=s.economy[0].manpower;hours(s,1);
 ok(u.inSupply,'unit near depot is in supply');ok(u.ammo['545']>0,'ammo topped up ('+u.ammo['545']+')');
 ok(u.personnel.fit===5&&s.economy[0].manpower<man0,'replacements arrived (fit '+u.personnel.fit+')');
 ok(Loot.holders(u)>=u.personnel.fit,'replacements got weapons from depot');
}
// 4. вантаж КамАЗа, видача, польовий склад
{const s=Engine.newGame(1999);const g=Engine.grid(s);const k=s.units.find(x=>x.type==='veh_kamaz'&&x.faction===0);const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);
 k.idx=dep.idx;
 const r=Logistics.loadFromStore(s,k.id,'mix');ok(r.ok,'truck loaded: '+(r.text||r.reason));
 ok(Logistics.cargoKg(k)<=Logistics.cargoCapKg(k)+1e-6&&Logistics.cargoKg(k)>1000,'cargo within capacity ('+Math.round(Logistics.cargoKg(k))+' kg)');
 const sq=s.units.find(x=>x.faction===0&&x.type==='inf_squad');sq.ammo['545']=10;sq.idx=g.idx(5,5);k.idx=sq.idx;k.mp=70;
 const r2=Logistics.issueFromCargo(s,k.id);ok(r2.ok&&sq.ammo['545']>10,'issued ammo from cargo: '+r2.text);
 k.mp=70;const n0=Logistics.facilities(s).length;const r3=Logistics.unloadToStore(s,k.id);ok(r3.ok&&r3.created&&Logistics.facilities(s).length===n0+1,'field depot created');
}
// 5. захоплення та знищення складу
{const s=Engine.newGame(1999);const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===1);
 for(const u of s.units)if(u.idx===dep.idx)u.idx=0;
 const n=s.units.find(x=>x.faction===2&&x.type==='inf_squad');n.idx=dep.idx;Intel.update(s);
 hours(s,1);ok(dep.owner===2&&s.map.control[dep.idx]===2,'depot captured with contents by holding the hex');
 const s2=Engine.newGame(1999);const d2=Logistics.facilities(s2).find(f=>f.type==='depot'&&f.owner===0);const u=s2.units.find(x=>x.faction===0&&x.type==='inf_squad');u.idx=d2.idx;
 const r=Logistics.destroyFacility(s2,u.id,d2.id);ok(r.ok&&d2.destroyed,'own depot destroyed');
}
// 6. медицина
{const s=Engine.newGame(1999);const g=Engine.grid(s);
 const u=s.units.find(x=>x.faction===1&&x.type==='inf_platoon');u.idx=g.idx(40,40);s.map.control[u.idx]=-1;u.personnel.wounded=10;u.personnel.fit=10;
 for(const x of s.units)if(x!==u&&x.faction===1&&x.type==='medevac')x.idx=g.idx(5,5);
 hours(s,6);ok(u.personnel.wounded<10&&u.personnel.killed>0,'untreated wounded die over time (wounded '+u.personnel.wounded+', killed '+u.personnel.killed+')');
 const mv=s.units.find(x=>x.faction===1&&x.type==='medevac');mv.idx=u.idx;s.phase=1;mv.mp=16;
 const r=Logistics.pickupWounded(s,mv.id);ok(r.ok&&mv.carriedWounded>0,'medevac picks up wounded ('+mv.carriedWounded+')');
 const h=Logistics.facilities(s).find(f=>f.type==='hospital'&&f.owner===0);h.patients=20;const rec0=s.economy[0].recovered;hours(s,6);ok(s.economy[0].recovered>rec0,'hospital patients recover to reserve');
}
// 7. збереження
{const s=Engine.newGame(1999);hours(s,2);const t=SaveSystem.serialize(s);const b=SaveSystem.deserialize(t);ok(b.ok,'v5 save ok');
 Engine.endPhase(s);Engine.endPhase(b.state);ok(SaveSystem.serialize(s).replace(/"savedAt":\d+/,'')===SaveSystem.serialize(b.state).replace(/"savedAt":\d+/,''),'loaded game continues identically');
 const v4=JSON.parse(t);v4.version=4;delete v4.facilities;delete v4.economy;const m=SaveSystem.deserialize(JSON.stringify(v4));const nNew=Engine.newGame(1999).facilities.length;ok(m.ok&&m.state.facilities.length===nNew,'v4 save migrated with facilities ('+m.state.facilities.length+'/'+nNew+')');}
// 8. довга гра
{const s=Engine.newGame(1999);let attacks=0;
 for(let h=0;h<48*3;h++){const f=Engine.phaseFaction(s);
  for(const u of s.units.filter(x=>x.faction===f)){const vis=[...Intel.visibleIds(s,f)].map(id=>Engine.unitById(s,id)).filter(Boolean);let done=false;
   for(const e of vis){const r=Combat.attack(s,u.id,{unitId:e.id});if(r.ok){attacks++;done=true;break;}}
   if(!done&&!u.order&&Engine.canAct(u)&&u.embarked==null&&u.type!=='medevac')Engine.issueMoveOrder(s,u.id,s.map.settlements[0].center);}
  Engine.endPhase(s);}
 const eco=s.economy.map(e=>Math.round(e.money)+'₴/'+e.manpower+'чол/помер '+e.deadOfWounds);
 ok(true,'48h sim: attacks '+attacks+'; economy '+eco.join(' | '));
 ok(s.units.every(u=>Object.values(u.ammo).every(n=>n>=0&&Number.isFinite(n))),'no negative ammo');
 ok(Logistics.facilities(s).every(f=>Object.values(f.stock.ammo).every(n=>n>=0)&&Object.values(f.stock.goods).every(n=>n>=0)),'no negative stocks');
 ok(SaveSystem.deserialize(SaveSystem.serialize(s)).ok,'save after long game');}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
