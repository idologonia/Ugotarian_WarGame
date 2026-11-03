const L=require('./load.js')();
const {Engine,SaveSystem,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
// 1 детермінованість карти
const s1=Engine.newGame(1999), s2=Engine.newGame(1999);
ok(SaveSystem.serialize(s1).replace(/"created":\d+|"savedAt":\d+/g,'')===SaveSystem.serialize(s2).replace(/"created":\d+|"savedAt":\d+/g,''),'same seed -> identical state');
ok(s1.units.length===46,'46 units placed ('+s1.units.length+')');
ok(s1.units.every(u=>u.faction===s1.map.control[u.idx]),'units start in own territory');
const g=Engine.grid(s1);
// 2 рух: пішки не більше 16 ОР
const st=Engine.newGame(1999);
const u=st.units.find(x=>x.faction===0&&x.type==='inf_squad');
// ціль далеко
let target=-1;
for(let i=0;i<g.size;i++){ if(g.dist(i,u.idx)>=30 && Engine.hexPassable(st,'foot',i) && st.map.control[i]===0){target=i;break;} }
const pv=Engine.previewMove(st,u.id,target);
ok(pv.ok,'preview ok: '+(pv.reason||pv.path.length+' hexes, '+pv.total+' MP, '+pv.hours+'h'));
const start=u.idx;
const r=Engine.issueMoveOrder(st,u.id,target);
ok(r.ok && !r.pending,'order issued and executed');
ok(r.result.spent<=16+1e-9,'spent <= 16 MP ('+r.result.spent+')');
ok(u.idx!==start,'unit moved');
ok(u.order && u.order.path.length>0,'order continues');
// 3 зміна наказу після руху -> відкладений
const r2=Engine.issueMoveOrder(st,u.id,start);
ok(r2.ok&&r2.pending&&u.pendingOrder,'second order becomes pending');
const posAfter=u.idx;
// 4 не можна наказувати чужій фракції
const enemy=st.units.find(x=>x.faction===1);
ok(!Engine.previewMove(st,enemy.id,enemy.idx+1).ok,'cannot order other faction in its non-phase');
// 5 цикл фаз
Engine.endPhase(st); ok(st.phase===1,'phase -> 2nd slot');
Engine.endPhase(st); ok(st.phase===2,'phase -> 3rd slot');
const h0=st.time.hour;
const order0=st.phaseOrder.slice();
Engine.endPhase(st); ok(st.phase===0 && st.time.hour===h0+1,'hour advanced, phase counter -> 0');
ok(st.phaseOrder.length===3 && [0,1,2].every(f=>st.phaseOrder.includes(f)) && JSON.stringify(st.phaseOrder)!==JSON.stringify(order0),'phase order rotated to avoid first-mover advantage ('+order0+' -> '+st.phaseOrder+')');
// дорогу до фази фракції 0 (нова ротація могла поставити її не першою)
Engine.advanceToFaction(st,0);
ok(!u.pendingOrder && (u.idx===start || (u.order&&u.order.target===start)),'pending order activated next hour');
ok(u.idx!==posAfter,'unit executed pending order at phase start');
// 6 доба
for(let i=0;i<3*30;i++) Engine.endPhase(st);
ok(st.time.day===2,'day rolls over (day '+st.time.day+', hour '+st.time.hour+')');
// 7 річка непрохідна без мосту
const m=st.map;let riverHex=-1;for(let i=0;i<g.size;i++)if(m.river[i]&&!m.bridge[i]){riverHex=i;break;}
ok(!Engine.hexPassable(st,'foot',riverHex),'river without bridge impassable');
// путь з однієї сторони річки на іншу обов'язково через міст
const s3=Engine.newGame(1999);
const uu=s3.units.find(x=>x.faction===0&&x.type==='inf_platoon');
// знайдемо гекс на іншому березі: прохідний гекс, шлях якого містить міст
let crossed=false;
for(let i=0;i<g.size && !crossed;i+=37){ if(!Engine.hexPassable(s3,'foot',i))continue; const p=Engine.findPath(s3,uu,uu.idx,i); if(p&&p.path.some(x=>s3.map.bridge[x])){crossed=true; ok(p.path.every(x=>!s3.map.river[x]||s3.map.bridge[x]),'river crossed only via bridge');}}
ok(crossed,'found route crossing a bridge');
// 8 чужий гекс заблокований
const s4=Engine.newGame(1999);const a=s4.units.find(x=>x.faction===0);const b=s4.units.find(x=>x.faction===1);
const pvb=Engine.previewMove(s4,a.id,b.idx); ok(L.Intel.isVisible(s4,0,b.id)?!pvb.ok:pvb.ok,'move into enemy hex: rejected only if enemy is known ('+(pvb.reason||'unknown enemy, allowed')+')');
// 9 збереження/завантаження
const txt=SaveSystem.serialize(st);
const back=SaveSystem.deserialize(txt);
ok(back.ok,'deserialize ok '+(back.errors||''));
ok(SaveSystem.serialize(back.state).replace(/"savedAt":\d+/,'')===txt.replace(/"savedAt":\d+/,''),'round trip identical');
// продовження після завантаження так само як оригінал
const c1=JSON.parse(txt);const st2=back.state;
Engine.endPhase(st); Engine.endPhase(st2);
ok(SaveSystem.serialize(st).replace(/"savedAt":\d+/,'')===SaveSystem.serialize(st2).replace(/"savedAt":\d+/,''),'loaded game continues identically');
// 10 некоректні файли
ok(!SaveSystem.deserialize('{oops').ok,'bad json rejected');
ok(!SaveSystem.deserialize('{"format":"x"}').ok,'wrong format rejected');
const bad=JSON.parse(txt);bad.units[0].idx=999999;const rb=SaveSystem.deserialize(JSON.stringify(bad));ok(!rb.ok,'bad unit position rejected: '+rb.errors[0]);
const bad2=JSON.parse(txt);bad2.version=99;ok(!SaveSystem.deserialize(JSON.stringify(bad2)).ok,'future version rejected');
const bad3=JSON.parse(txt);bad3.map.terrain.pop();ok(!SaveSystem.deserialize(JSON.stringify(bad3)).ok,'bad map layer rejected');
// 11 техніка: ліс густий непрохідний для коліс
const s5=Engine.newGame(1999);const uaz=s5.units.find(x=>x.type==='veh_uaz');
let dense=-1;for(let i=0;i<g.size;i++)if(s5.map.terrain[i]===TERRAIN_ID.denseForest&&!s5.map.road[i]){dense=i;break;}
ok(!Engine.previewMove(s5,uaz.id,dense).ok||uaz.faction!==0,'wheeled cannot enter dense forest (checked in own phase only)');
// 12 швидкість продуктивності A*
let t=Date.now();for(let k=0;k<50;k++)Engine.findPath(s5,s5.units[0],s5.units[0].idx,g.size-81);console.log('50 A* runs',Date.now()-t,'ms');
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
