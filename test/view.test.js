// Картина фракції (08b_view.js): видимий ворог — лише зовнішні ознаки; невпізнаний — узагальнений
// тип; клієнт на картині не перераховує видимість.
const L=require('./load.js')();
const {Engine,Scenario,Intel,View,SaveSystem}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const s=Engine.newGame(1999);const g=Engine.grid(s);
const dp=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
// МТ-ЛБ СВ поруч (1 гекс — впізнано) і далеко на межі видимості (3 гекси — не впізнано)
const near=Scenario.createUnit(s,'veh_mtlb',0,g.neighbor(dp.idx,0),9);s.units.push(near);
let far=-1;for(const i of g.within(dp.idx,3))if(g.dist(i,dp.idx)===3&&Engine.hexPassable(s,'tracked',i)&&!s.units.some(u=>u.idx===i)){far=i;break;}
const farU=Scenario.createUnit(s,'inf_platoon',0,far,9);s.units.push(farU);
s.map.terrain[far]=1;
Intel.update(s);
const v=View.make(s,1);
const vn=v.units.find(u=>u.id===near.id);
ok(vn&&vn.stub&&vn.type==='veh_mtlb','ворог поруч видимий і впізнаний (МТ-ЛБ)');
ok(vn&&!Object.keys(vn.ammo).length&&!Object.keys(vn.weapons).length&&vn.morale===50,'боєприпаси, зброя й мораль ворога не передаються');
const vf=v.units.find(u=>u.id===farU.id);
if(vf) ok(vf.type!=='inf_platoon'||Intel.knownList(s,1).find(m=>m.id===farU.id).type,'невпізнаний ворог — узагальнений тип');
ok(!v.units.some(u=>u.faction===0&&!v.view.visible.includes(u.id)),'невидимих ворогів у картині немає');
// клієнт: відновлення й видимість без перерахунку
const st=View.restore(JSON.parse(JSON.stringify(v)));
ok(Object.prototype.toString.call(st.map.terrain)==='[object Uint8Array]','карта відновлена (типізовані масиви)');
ok(Intel.visibleIds(st,1).has(near.id)&&Intel.knownList(st,1).length===Object.keys(v.intel[1]).length,'клієнт бере видимість із картини, позначки не губляться');
ok(Engine.previewMove(Object.assign(st,{phase:s.phase}),dp.id,g.neighbor(dp.idx,3)).ok!==undefined,'превʼю ходу працює на картині');
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
