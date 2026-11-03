const L=require('./load.js')();
const {Engine,Field,Logistics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};

// Запит гравця: «Після вириття бліндажа — там можна розгорнути командний пункт! Ми це так
// і не реалізували». КП доступний лише там, де вже є бліндаж, і дає бонус відновлення моралі
// своїм підрозділам у радіусі.

// 1. без бліндажа КП не пропонується
{
  const s=Engine.newGame(1999); const eng=s.units.find(u=>u.faction===0&&u.type==='eng_squad');
  const opts=Field.options(s,eng);
  ok(!opts.some(o=>o.type==='cp'),'no CP option without a shelter yet');
}

// 2. з бліндажем — можна розпочати й завершити проєкт КП, що створює об'єкт
{
  const s=Engine.newGame(1999); toPhase(s,0);
  const eng=s.units.find(u=>u.faction===0&&u.type==='eng_squad');
  s.map.shelter[eng.idx]=1;
  Logistics.ensureEconomy(s)[0]; // no-op, ensure economy exists
  // забезпечимо інженерне майно поруч
  const store=Logistics.facilities(s).find(x=>Logistics.isStore(x)&&x.owner===0&&!x.destroyed);
  store.stock.goods.eng=100;
  const opts=Field.options(s,eng);
  const cpOpt=opts.find(o=>o.type==='cp');
  ok(!!cpOpt,'CP option appears once a shelter exists: '+JSON.stringify(opts.map(o=>o.type)));
  const r=Field.startProject(s,eng.id,'cp',cpOpt.target);
  ok(r.ok,'CP project started: '+(r.reason||''));
  hours(s,CONFIG.engineering.cp.hours+1);
  const cp=Logistics.facilities(s).find(x=>x.type==='cp'&&x.owner===0);
  ok(!!cp,'CP facility actually created after the project finishes');
  ok(cp.idx===eng.idx,'CP located at the engineer hex');
}

// 3. лише один свій КП на гекс
{
  const s=Engine.newGame(1999); toPhase(s,0);
  const eng=s.units.find(u=>u.faction===0&&u.type==='eng_squad');
  s.map.shelter[eng.idx]=1;
  Logistics.makeFacility(s,'cp',eng.idx,0,'Існуючий КП');
  const opts=Field.options(s,eng);
  ok(!opts.some(o=>o.type==='cp'),'cannot build a second own CP in the same hex');
}

// 4. бонус відновлення моралі біля свого КП
{
  const s=Engine.newGame(1999); const g=Engine.grid(s);
  const u=s.units.find(x=>x.faction===0&&x.type==='inf_squad');
  u.morale=50; u.baseMorale=70; u.suppression=0; u.dispersal=0;
  // прибираємо все інше з гекса/контактів, щоб не заважало відновленню (переносимо далеко)
  for(const other of s.units) if(other!==u&&other.faction!==0) other.idx=0;
  const cpIdx=g.neighbor(u.idx,0)>=0?g.neighbor(u.idx,0):u.idx;
  Logistics.makeFacility(s,'cp',cpIdx,0,'КП');
  Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);
  const withCP=u.morale;
  // тепер без КП (видалимо об'єкт) -> порівняємо прирост
  const s2=Engine.newGame(1999);
  const u2=s2.units.find(x=>x.faction===0&&x.type==='inf_squad');
  u2.morale=50; u2.baseMorale=70; u2.suppression=0; u2.dispersal=0;
  for(const other of s2.units) if(other!==u2&&other.faction!==0) other.idx=0;
  Engine.endPhase(s2);Engine.endPhase(s2);Engine.endPhase(s2);
  const withoutCP=u2.morale;
  ok(withCP>withoutCP,'morale recovers faster near a friendly CP: '+withoutCP+' vs '+withCP);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
