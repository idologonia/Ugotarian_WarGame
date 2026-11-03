const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,SaveSystem,Transport,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
function blank(seed=7){const s=Engine.newGame(seed);const g=Engine.grid(s);for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;}s.units=[];s.intel=[{},{},{}];s.campaign.disabled=true;s.facilities=[];s.phase=0;return {s,g};}
// посадка, місткість, рух, пальне
{const {s,g}=blank();const at=g.idx(10,10);
 const truck=Scenario.createUnit(s,'veh_kamaz',0,at,1),pl=Scenario.createUnit(s,'inf_platoon',0,at,1),sq=Scenario.createUnit(s,'inf_squad',0,at,1),uaz=Scenario.createUnit(s,'veh_uaz',0,at,1),sq2=Scenario.createUnit(s,'inf_squad',0,at,2);
 s.units=[truck,pl,sq,uaz,sq2];Intel.update(s);
 ok(Transport.board(s,pl.id,truck.id).ok,'platoon (20) boards KamAZ (20)');
 const r=Transport.board(s,sq.id,truck.id);ok(!r.ok,'no room for squad: '+r.reason);
 const r2=Transport.board(s,sq2.id,uaz.id);ok(!r2.ok,'squad of 5 does not fit UAZ (4): '+r2.reason);
 ok(Math.abs(truck.mp-Engine.mpMax(truck)*0.75)<1e-9,'boarding costs 25% of vehicle hour');
 ok(Math.abs(pl.mp-Engine.mpMax(pl)*0.75)<1e-9,'passenger time mirrors vehicle');
 const pm=Engine.previewMove(s,pl.id,g.idx(20,10));ok(!pm.ok,'passenger cannot move on its own');
 const fuel0=truck.vehicle.fuel;
 const mv=Engine.issueMoveOrder(s,truck.id,g.idx(40,10));ok(mv.ok,'truck moves');
 ok(pl.idx===truck.idx&&truck.idx!==at,'passenger moved with vehicle to '+g.label(truck.idx));
 const used=fuel0-truck.vehicle.fuel;ok(used>0&&used<=25*0.75+0.2,'fuel burned '+used+' l (≤ 25 l/h × 0.75)');
 ok(!Intel.isVisible(s,1,pl.id),'passengers not visible from outside');
 // висадка
 const d=Transport.disembark(s,pl.id);ok(d.ok&&pl.embarked==null&&truck.carrying.length===0,'disembark ok');
 ok(pl.mp<=Engine.mpMax(pl)*0.25+1e-9,'disembark leaves little time ('+pl.mp+')');
 // пальне закінчується
 truck.vehicle.fuel=0.5;Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);
 Engine.advanceToFaction(s,0); // ротація порядку фаз могла зсунути чергу фракції 0
 const mv2=Engine.issueMoveOrder(s,truck.id,g.idx(70,10));ok(mv2.ok&&truck.order&&truck.order.status==='blocked','vehicle stops when fuel runs out');
}
// знищення машини з пасажирами: 200/300
{const {s,g}=blank();const at=g.idx(10,10);const v=Scenario.createUnit(s,'veh_uaz',0,at,1),r=Scenario.createUnit(s,'recon',0,at,1);
 const atk=Scenario.createUnit(s,'at_team',1,g.idx(11,10),1);s.units=[v,r,atk];Intel.update(s);
 ok(Transport.board(s,r.id,v.id).ok,'recon (4) boards UAZ');
 s.phase=1;atk.mp=Engine.mpMax(atk);
 let res=null;for(let h=0;h<4&&s.units.includes(v);h++){atk.attackedTurn=0;atk.mp=Engine.mpMax(atk);atk.ammo.pg7=4;atk.ammo.atd=2;atk.weapons['Одноразовий ПТГ']=2;res=Combat.attack(s,atk.id,{unitId:v.id},'high');}
 ok(!s.units.includes(v),'UAZ destroyed');
 const lostR=s.lost.find(x=>x.name===r.name);ok(lostR&&lostR.personnel.fit===0&&lostR.personnel.killed+lostR.personnel.wounded+lostR.personnel.captured+lostR.personnel.missing>=4,'all passengers became 200/300: '+JSON.stringify(lostR&&lostR.personnel));
}
// МТ-ЛБ: броня захищає пасажирів від стрілецької зброї, пасажири стріляють з машини
{const {s,g}=blank();const at=g.idx(10,10);const v=Scenario.createUnit(s,'veh_mtlb',0,at,1),sq=Scenario.createUnit(s,'inf_squad',0,at,1);
 const en=Scenario.createUnit(s,'inf_squad',1,g.idx(11,10),1);en.weapons={'АКМ':4,'РПК':1};en.ammo={'762s':2000};s.units=[v,sq,en];Intel.update(s);
 Transport.board(s,sq.id,v.id);
 s.phase=1;for(let h=0;h<3;h++){en.attackedTurn=0;en.mp=16;Combat.attack(s,en.id,{unitId:v.id},'normal');}
 ok(sq.personnel.fit>=4,'armor protects passengers from small arms (fit '+sq.personnel.fit+')');
 s.phase=0;s.time.turn++;v.mp=Engine.mpMax(v);en.idx=g.idx(11,10);en.personnel.fit=Math.max(en.personnel.fit,3);Intel.update(s);
 const pv=Combat.previewAttack(s,v.id,{unitId:en.id});ok(pv.ok&&pv.weapons.length>0,'vehicle can attack '+(pv.reason||''));
 const ar=Combat.attack(s,v.id,{unitId:en.id});ok(ar.ok&&ar.report.steps[3].lines.some(l=>l.includes('з машини')),'passengers fire from the vehicle (×0.5)');
}
// розділення та об'єднання
{const {s,g}=blank();const at=g.idx(10,10);const pl=Scenario.createUnit(s,'inf_platoon',0,at,1);s.units=[pl];Intel.update(s);
 const w0=JSON.stringify(pl.weapons);const a0=JSON.stringify(pl.ammo);
 const r=Transport.splitSquad(s,pl.id);ok(r.ok,'split squad from platoon');
 const sq=Engine.unitById(s,r.newId);
 ok(sq.personnel.fit===5&&pl.personnel.fit===15&&pl.personnel.assigned===15,'personnel 15 + 5');
 const tot={};for(const u of [pl,sq])for(const[m,n] of Object.entries(u.weapons))tot[m]=(tot[m]||0)+n;ok(JSON.stringify(Object.keys(tot).sort().map(k=>[k,tot[k]]))===JSON.stringify(Object.entries(JSON.parse(w0)).sort()),'weapons conserved');
 const ta={};for(const u of [pl,sq])for(const[m,n] of Object.entries(u.ammo))ta[m]=(ta[m]||0)+n;const a0o=JSON.parse(a0);ok(Object.keys(a0o).every(k=>ta[k]===a0o[k]),'ammo conserved');
 ok(sq.weapons['РПК']===1,'squad gets an RPK: '+JSON.stringify(sq.weapons));
 const r2=Transport.splitSquad(s,pl.id);ok(r2.ok,'second split');const r3=Transport.splitSquad(s,pl.id);ok(r3.ok,'third split leaves 5');const r4=Transport.splitSquad(s,pl.id);ok(!r4.ok,'cannot split a 5-man unit: '+r4.reason);
 // наступна година: об'єднати назад
 Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);
 Engine.advanceToFaction(s,0); // ротація порядку фаз могла зсунути чергу фракції 0
 const sq2=Engine.unitById(s,r2.newId),sq3=Engine.unitById(s,r3.newId);const n0=s.units.length;
 const m=Transport.merge(s,sq.id,sq2.id);ok(m.ok&&s.units.length===n0-1&&sq.personnel.assigned===10&&sq.type==='inf_squad','two squads -> 10 men (squad type)');
 const m2=Transport.merge(s,sq.id,sq3.id);ok(m2.ok&&sq.type==='inf_platoon'&&sq.personnel.assigned===15,'+5 -> 15 men becomes platoon: '+sq.name);
 const m3=Transport.merge(s,sq.id,pl.id);ok(m3.ok&&sq.personnel.assigned===20&&s.units.length===1,'all back to one platoon of 20 (each step −25% of hour, mp '+sq.mp+')');
 const pl2=Scenario.createUnit(s,'inf_squad',0,at,9);s.units.push(pl2);sq.mp=2;const m5=Transport.merge(s,sq.id,pl2.id);ok(!m5.ok,'no time left -> merge refused: '+m5.reason);
}
// збереження з пасажирами
{const {s,g}=blank();const at=g.idx(10,10);const v=Scenario.createUnit(s,'veh_mtlb',0,at,1),sq=Scenario.createUnit(s,'inf_squad',0,at,1);s.units=[v,sq];Intel.update(s);Transport.board(s,sq.id,v.id);
 const t=SaveSystem.serialize(s);const b=SaveSystem.deserialize(t);ok(b.ok&&b.state.units.find(u=>u.id===sq.id).embarked===v.id,'save keeps embarked passengers');
 const v2=JSON.parse(t);v2.version=2;for(const u of v2.units){delete u.embarked;delete u.carrying;}const mm=SaveSystem.deserialize(JSON.stringify(v2));ok(mm.ok,'v2 save migrates to v3');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
