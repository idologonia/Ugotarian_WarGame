const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,SaveSystem,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
function blank(seed=7){const s=Engine.newGame(seed);const g=Engine.grid(s);for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;}s.units=[];s.intel=[{},{},{}];s.campaign.disabled=true;s.facilities=[];s.phase=0;return {s,g};}
// 1. туман війни: далекий ворог невидимий
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_squad',0,g.idx(10,10),1),b=Scenario.createUnit(s,'inf_squad',1,g.idx(30,10),1);s.units=[a,b];Intel.update(s);
 ok(!Intel.isVisible(s,0,b.id),'distant enemy hidden');
 b.idx=g.idx(12,10);Intel.update(s);ok(Intel.isVisible(s,0,b.id),'enemy at 2 hexes in open visible (range 3)');
 s.map.terrain[b.idx]=TERRAIN_ID.denseForest;Intel.update(s);ok(!Intel.isVisible(s,0,b.id),'enemy in dense forest at 2 hexes hidden');
 const m=s.intel[0][b.id];ok(m&&m.idx===b.idx,'stale marker kept at last position');
 b.idx=g.idx(11,10);Intel.update(s);ok(Intel.isVisible(s,0,b.id),'adjacent always detected');
 // ніч
 b.idx=g.idx(13,10);s.map.terrain[b.idx]=TERRAIN_ID.plain;s.time.hour=23;Intel.update(s);ok(!Intel.isVisible(s,0,b.id),'night reduces detection');s.time.hour=12;
 // LOS через ліс
 s.map.terrain[g.idx(11,10)]=TERRAIN_ID.forest;s.map.terrain[g.idx(12,10)]=TERRAIN_ID.forest;s.map.terrain[g.idx(12,11)]=TERRAIN_ID.forest;s.map.terrain[g.idx(11,11)]=TERRAIN_ID.forest;
 Intel.update(s);ok(!Intel.isVisible(s,0,b.id),'forest blocks line of sight');
 // позначка знімається, коли гекс оглянуто
 for(const k of [g.idx(11,10),g.idx(12,10),g.idx(12,11),g.idx(11,11)])s.map.terrain[k]=TERRAIN_ID.plain;
 const old=b.idx;b.idx=g.idx(40,40);Intel.update(s);ok(!s.intel[0][b.id],'marker removed when hex observed empty');
}
// 2. рух зупиняється при контакті
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_squad',0,g.idx(10,20),1),b=Scenario.createUnit(s,'inf_squad',1,g.idx(20,20),1);s.units=[a,b];
 Intel.update(s);
 const r=Engine.issueMoveOrder(s,a.id,g.idx(26,20));ok(r.ok,'move order issued through unknown enemy area');
 ok(a.order&&a.order.status==='contact','movement halted on contact ('+(a.order&&a.order.status)+') at '+g.label(a.idx));
 ok(Intel.isVisible(s,0,b.id),'enemy now visible');
 ok(Intel.isVisible(s,1,a.id)||Engine.Intel===undefined,'enemy also sees mover');
}
// 3. атака, витрата набоїв, журнал видно лише учасникам
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_platoon',0,g.idx(10,20),1),b=Scenario.createUnit(s,'inf_squad',1,g.idx(11,20),1),c=Scenario.createUnit(s,'inf_squad',2,g.idx(40,40),1);s.units=[a,b,c];Intel.update(s);
 const ammo0=JSON.stringify(a.ammo);
 const r=Combat.attack(s,a.id,{unitId:b.id},'normal');ok(r.ok,'attack ok');
 ok(JSON.stringify(a.ammo)!==ammo0,'ammo consumed');
 ok(a.mp===0&&a.attackedTurn===s.time.turn,'attacker spent its hour');
 const r2=Combat.attack(s,a.id,{unitId:b.id});ok(!r2.ok,'cannot attack twice per hour: '+r2.reason);
 const last=s.log.filter(e=>e.kind==='combat').pop();ok(last&&last.vis.includes(0)&&last.vis.includes(1)&&!last.vis.includes(2),'combat log visible only to participants');
 ok(r.report.steps.length===6,'report has 6 steps');
 // детермінованість
 const {s:s2,g:g2}=blank();const a2=Scenario.createUnit(s2,'inf_platoon',0,g2.idx(10,20),1),b2=Scenario.createUnit(s2,'inf_squad',1,g2.idx(11,20),1),c2=Scenario.createUnit(s2,'inf_squad',2,g2.idx(40,40),1);s2.units=[a2,b2,c2];Intel.update(s2);
 const rr=Combat.attack(s2,a2.id,{unitId:b2.id},'normal');ok(JSON.stringify(rr.report.steps)===JSON.stringify(r.report.steps),'same conditions -> same result');
}
// 4. не можна стріляти без боєприпасів / поза дальністю / без LOS
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_squad',0,g.idx(10,20),1),b=Scenario.createUnit(s,'inf_squad',1,g.idx(12,20),1);s.units=[a,b];Intel.update(s);
 const r0=Combat.previewAttack(s,a.id,{unitId:b.id});ok(r0.ok,'squad can fire at 500m (AK-74 500м, РПК)');
 b.idx=g.idx(14,20);Intel.update(s);const r1=Combat.previewAttack(s,a.id,{unitId:b.id});ok(!r1.ok,'out of range/not visible: '+r1.reason);
 b.idx=g.idx(11,20);Intel.update(s);for(const k in a.ammo)a.ammo[k]=0;const r2=Combat.previewAttack(s,a.id,{unitId:b.id});ok(!r2.ok,'no ammo: '+r2.reason);
}
// 5. капітуляція в оточенні, трофеї
{const {s,g}=blank();const mid=g.idx(20,20);const v=Scenario.createUnit(s,'inf_squad',1,mid,1);const att=[];
 for(let d=0;d<6;d++){att.push(Scenario.createUnit(s,'inf_platoon',0,g.neighbor(mid,d),d+1));}
 s.units=[v,...att];Intel.update(s);v.morale=15;v.personnel.fit=3;v.personnel.wounded=1;
 const r=Combat.attack(s,att[0].id,{unitId:v.id},'low');
 const surrendered=!s.units.includes(v)&&s.prisoners.length>0;
 ok(surrendered,'surrounded weak unit surrenders: '+JSON.stringify(r.report&&r.report.result));
 ok(att.some(x=>x.cargo&&Object.keys(x.cargo.weapons).length>0)||Object.values(s.caches).some(c=>Object.keys(c.weapons).length),'captured weapons go to captor cargo or stay in hex');
 ok(s.lost.length===1&&['Капітулював','Знищено'].includes(s.lost[0].fate),'loss recorded: '+(s.lost[0]&&s.lost[0].fate));
}
// 6. контроль за утриманням
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_squad',0,g.idx(5,5),1);s.units=[a];s.map.control[g.idx(6,5)]=1;Intel.update(s);
 Engine.issueMoveOrder(s,a.id,g.idx(6,5));ok(s.map.control[g.idx(6,5)]===1,'entering does not change control immediately');
 Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);ok(s.map.control[g.idx(6,5)]===0,'held until end of hour -> control changes');
}
// 7. оборона: рівень позицій росте
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_squad',0,g.idx(5,5),1);s.units=[a];Intel.update(s);
 Engine.setStance(s,a.id,'defend');for(let i=0;i<6;i++)Engine.endPhase(s);ok(a.fort===2,'fort grows 1 per hour (fort '+a.fort+')');
 Engine.advanceToFaction(s,0); // ротація порядку фаз могла зсунути чергу фракції 0
 const p=Engine.previewMove(s,a.id,g.idx(8,5));ok(p.risks.some(x=>x.includes('обладнані')),'moving warns about leaving positions');
}
// 8. міномет по застарілій позначці
{const {s,g}=blank();const m=Scenario.createUnit(s,'mortar',0,g.idx(10,20),1),o=Scenario.createUnit(s,'recon',0,g.idx(14,20),1),b=Scenario.createUnit(s,'inf_squad',1,g.idx(16,20),1);s.units=[m,o,b];Intel.update(s);
 ok(Intel.isVisible(s,0,b.id),'observer sees target');
 o.idx=g.idx(5,5);Intel.update(s);ok(!Intel.isVisible(s,0,b.id)&&s.intel[0][b.id],'target now a stale marker');
 s.time.turn+=2;const pv=Combat.previewAttack(s,m.id,{hex:b.idx});ok(pv.ok&&Math.abs(pv.freshness-0.5*CONFIG.combat.zeroing.first)<1e-9,'freshness 50% × zeroing after 2h ('+pv.freshness+')');
 const r=Combat.attack(s,m.id,{hex:b.idx});ok(r.ok&&r.report.steps.some(x=>x.lines.some(l=>l.includes('не спостерігався'))),'result not observed without spotter');
}
// 9. збереження v2 і міграція v1
{const s=Engine.newGame(1999);const t=SaveSystem.serialize(s);const b=SaveSystem.deserialize(t);ok(b.ok,'v2 save ok');
 const v1=JSON.parse(t);v1.version=1;delete v1.intel;delete v1.prisoners;delete v1.lost;delete v1.lastCombat;for(const u of v1.units){delete u.acc;delete u.suppression;delete u.baseMorale;delete u.xp;delete u.fort;delete u.stance;delete u.dispersal;}
 const m=SaveSystem.deserialize(JSON.stringify(v1));ok(m.ok&&m.notes.length>=1,'v1 save migrated: '+(m.errors||m.notes));
 if(m.ok){Engine.endPhase(m.state);ok(true,'migrated game continues');}
}
// 10. повна гра: 48 годин із рухом і атаками без помилок
{const s=Engine.newGame(1999);const g=Engine.grid(s);let attacks=0;
 for(let h=0;h<48*3;h++){const f=Engine.phaseFaction(s);
   for(const u of s.units.filter(x=>x.faction===f)){
     const vis=[...Intel.visibleIds(s,f)].map(id=>Engine.unitById(s,id)).filter(Boolean);
     let done=false;
     for(const e of vis){const r=Combat.attack(s,u.id,{unitId:e.id},'normal');if(r.ok){attacks++;done=true;break;}}
     if(!done&&!u.order&&Engine.canAct(u)){const c=s.map.settlements[0].center;Engine.issueMoveOrder(s,u.id,c);}
   }
   Engine.endPhase(s);}
 ok(true,'48h hot-seat simulation ran: attacks '+attacks+', units left '+s.units.length+', prisoners '+s.prisoners.reduce((a,p)=>a+p.count,0)+', lost '+s.lost.length);
 const t=SaveSystem.serialize(s);ok(SaveSystem.deserialize(t).ok,'save after long game ok ('+Math.round(t.length/1024)+' KB)');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
