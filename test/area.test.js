const L=require('./load.js')();
const {Engine,Intel,Politics,Combat,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const s=Engine.newGame(1999);s.campaign.disabled=true;toPhase(s,0);
const g=Engine.grid(s);
// --- міський міст
const city=s.map.settlements[0];
const cityBridge=g.within(city.center,4).some(i=>s.map.river[i]&&s.map.bridge[i]&&s.map.settlement[i]===0);
ok(cityBridge,'city has a bridge over the river');
// --- досяжність
const inf=s.units.find(u=>u.faction===0&&u.type==='inf_squad'&&u.embarked==null);
const R=Engine.reachable(s,inf);
ok(R.now.size>0,'reach: '+R.now.size+' hexes this hour');
let mism=0;for(const [i] of R.now){const p=Engine.previewMove(s,inf.id,i);if(!p.ok||p.hours!==1)mism++;}
ok(mism===0,'every reachable hex is reachable within this hour by planner (mismatches '+mism+')');
const far=[...R.next.keys()].slice(0,20);let bad=0;for(const i of far){const p=Engine.previewMove(s,inf.id,i);if(p.ok&&p.hours===1)bad++;}
ok(bad===0,'next-hour ring hexes need more than this hour');
// --- зона ураження
const fz=Combat.fireZone(s,inf);ok(!fz.indirect&&fz.rangeHex>=1&&fz.hexes.size>0,'direct fire zone: range '+fz.rangeM+' m, '+fz.hexes.size+' hexes, no LOS '+fz.noLos.size);
// --- вогонь по площі
const mor=s.units.find(u=>u.faction===0&&u.type==='mortar');
ok(!!mor,'mortar found');
let pv;
if(!mor.deployed){pv=Combat.previewAttack(s,mor.id,{hex:g.neighbor(g.neighbor(mor.idx,0),0)});
ok(!pv.ok&&/розгорн/i.test(pv.reason),'undeployed mortar refuses area fire: '+pv.reason);
Engine.deploy(s,mor.id);}else ok(true,'mortar starts deployed');
const mz=Combat.fireZone(s,mor);ok(mz.indirect&&mz.rangeHex>=8,'mortar zone range '+mz.rangeHex+' hex');
// порожній гекс без спостереження
let empty=-1;for(const i of mz.hexes){if(g.dist(i,mor.idx)<5)continue;if(s.units.some(u=>u.idx===i))continue;if(Intel.hexObserved(s,0,i))continue;if(Intel.markerAt(s,0,i).length)continue;empty=i;break;}
ok(empty>=0,'found unobserved empty hex in range');
pv=Combat.previewAttack(s,mor.id,{hex:empty});
ok(pv.ok&&pv.area&&!pv.areaObserved&&Math.abs(pv.freshness-CONFIG.combat.areaFire.blind*CONFIG.combat.zeroing.first)<1e-9,'blind area fire preview ok, accuracy '+pv.freshness);
// ховаємо ворожий підрозділ у цільовий гекс (невидимий для СВ)
const enemy=s.units.find(u=>u.faction===2&&u.type==='inf_squad'&&u.embarked==null);
enemy.idx=empty;Intel.update(s);
ok(!Intel.isVisible(s,0,enemy.id),'hidden enemy placed into target hex');
const pv2=Combat.previewAttack(s,mor.id,{hex:empty});
ok(pv2.ok&&pv2.area&&pv2.notes.every(n=>!/НП|Нац/.test(n)),'preview does not leak who is in the hex');
const ammo0=JSON.stringify(mor.ammo);const fit0=enemy.personnel.fit, sup0=enemy.suppression, mor0=enemy.morale;
const r=Combat.attack(s,mor.id,{hex:empty});
ok(r.ok,'area fire executed');
ok(JSON.stringify(mor.ammo)!==ammo0,'ammo spent');
ok(enemy.personnel.fit<fit0||enemy.suppression>sup0||enemy.morale<mor0,'hidden enemy hit: fit '+fit0+'→'+enemy.personnel.fit+', supp '+Math.round(sup0)+'→'+Math.round(enemy.suppression));
ok(r.report.visibleTo.length===1&&r.report.steps.some(st=>/не спостерігався/.test(st.lines.join(' '))),'blind result not revealed to shooter');
// не можна по своїх
const own=s.units.find(u=>u.faction===0&&u.id!==mor.id&&g.dist(u.idx,mor.idx)>=1&&g.dist(u.idx,mor.idx)<=mz.rangeHex&&u.idx!==mor.idx);
if(own){s.time.turn++;mor.attackedTurn=-1;const p3=Combat.previewAttack(s,mor.id,{hex:own.idx});ok(!p3.ok&&/ваші/.test(p3.reason),'area fire on own hex refused');}
// пряма зброя по порожньому гексу — ні
const p4=Combat.previewAttack(s,inf.id,{hex:[...fz.hexes].find(i=>!s.units.some(u=>u.idx===i))});
ok(!p4.ok&&/навісною/.test(p4.reason),'direct-fire unit cannot area-fire');
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
