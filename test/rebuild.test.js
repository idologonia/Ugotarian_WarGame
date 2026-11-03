const L=require('./load.js')();
const {Engine,Intel,Scenario,Field,Logistics,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

const s=Engine.newGame(9); s.campaign.disabled=true; s.phase=0;
const g=Engine.grid(s);
const sid=1; const st=s.map.settlements[sid]; // Село Б, під соц. контролем за сценарієм
st.control=0;
st.damage={housing:40,hospital:20,water:30,transport:25,industry:10};
let vidx=-1; for(let i=0;i<s.map.settlement.length;i++){ if(s.map.settlement[i]===sid){vidx=i;break;} }

const eng=Scenario.createUnit(s,'eng_squad',0,vidx,9);
s.units.push(eng);
// забезпечимо інженерне майно у вантажі (без складу поруч, щоб тест не залежав від логістики)
eng.cargo=eng.cargo||{weapons:{},ammo:{},goods:{}};
eng.cargo.goods.eng=200;

const opts=Field.options(s,eng);
const opt=opts.find(o=>o.type==='rebuild');
ok(!!opt,'rebuild option offered in a damaged, controlled settlement');

const r=Field.startProject(s,eng.id,'rebuild',sid);
ok(r.ok,'rebuild project started: '+(r.reason||''));
ok(eng.cargo.goods.eng===197,'initial eng kit consumed (200→197): '+eng.cargo.goods.eng);

for (let i=0;i<5;i++) { s.time.turn++; Field.endOfHour(s); }
const totalAfter=Object.values(st.damage).reduce((a,b)=>a+b,0);
ok(totalAfter<150,'damage meaningfully reduced after 5 hours of rebuilding: '+JSON.stringify(st.damage));
ok(eng.cargo.goods.eng<197,'eng kits kept being consumed hour after hour: '+eng.cargo.goods.eng);

// довести до нуля
for (let i=0;i<40 && Object.values(st.damage).reduce((a,b)=>a+b,0)>0;i++) { s.time.turn++; Field.endOfHour(s); }
ok(Object.values(st.damage).every(v=>v===0),'rebuild eventually clears all damage: '+JSON.stringify(st.damage));
ok(eng.project==null,'project auto-closes once damage reaches zero');

// контроль утрачено — робота перерветься
st.control=0; st.damage.housing=20;
Field.startProject(s,eng.id,'rebuild',sid);
st.control=1;
s.time.turn++; Field.endOfHour(s);
ok(eng.project==null,'losing control of the settlement cancels the rebuild project');

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
