const L=require('./load.js')();
const {Engine,Scenario,Intel,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Користувач: уникнути постійної переваги першого ходу — порядок фаз у межах години
// (хто ходить першим/другим/третім) має обертатись щогодини, а не бути завжди 0,1,2.

// 1. базовий стан: новий сценарій починається з порядку [0,1,2]
{
  const s=Engine.newGame(1999);
  ok(Array.isArray(s.phaseOrder)&&JSON.stringify(s.phaseOrder)===JSON.stringify([0,1,2]),'new game starts with order [0,1,2]: '+s.phaseOrder);
  ok(Engine.phaseFaction(s)===0,'phase 0 -> faction 0 initially');
}

// 2. ротація: щогодини (3 endPhase) порядок зсувається циклічно, і за 3 години кожна
// фракція рівно по разу побувала першою, другою й третьою
{
  const s=Engine.newGame(2024);
  const seenFirst=new Set(), seenLast=new Set();
  const orders=[JSON.stringify(s.phaseOrder)];
  for(let hour=0;hour<6;hour++){
    seenFirst.add(Engine.phaseFaction(s));
    for(let k=0;k<3;k++)Engine.endPhase(s);
    orders.push(JSON.stringify(s.phaseOrder));
  }
  ok(orders.length===7&&new Set(orders.slice(0,3)).size===3,'3 distinct phase orders appear within first 3 hours: '+orders.slice(0,4));
  ok(orders[0]===orders[3]&&orders[3]===orders[6],'order returns to identity every 3 hours (cycle): '+orders.join(' | '));
  ok(seenFirst.size===3,'each faction got to go first within a 3-hour window: '+[...seenFirst]);
}

// 3. жодна фракція не завжди йде першою — одна рука (сесія 1 година) вже змінює, хто перший
{
  const s=Engine.newGame(7);
  const firstBefore=Engine.phaseFaction(s);
  for(let k=0;k<3;k++)Engine.endPhase(s);
  const firstAfter=Engine.phaseFaction(s);
  ok(firstBefore!==firstAfter,'who goes first changes after an hour ('+firstBefore+' -> '+firstAfter+')');
}

// 4. обертання — циклічний зсув (хто був першим, стає останнім)
{
  const s=Engine.newGame(55);
  const before=s.phaseOrder.slice();
  for(let k=0;k<3;k++)Engine.endPhase(s);
  const after=s.phaseOrder;
  ok(JSON.stringify(after)===JSON.stringify([before[1],before[2],before[0]]),'rotation is a left shift: '+before+' -> '+after);
}

// 5. гравець бачить анонс нового порядку фаз у журналі
{
  const s=Engine.newGame(99);
  const logBefore=s.nextLogId;
  for(let k=0;k<3;k++)Engine.endPhase(s);
  const announce=s.log.filter(x=>x.id>=logBefore&&/Новий порядок фаз/.test(x.text));
  ok(announce.length===1,'new phase order announced in the log once per hour');
}

// 6. сумісність зі старими збереженнями: немає phaseOrder -> вважається [0,1,2]
{
  const s=Engine.newGame(1999);
  const txt=L.SaveSystem.serialize(s);
  const raw=JSON.parse(txt);
  delete raw.phaseOrder;
  const back=L.SaveSystem.deserialize(JSON.stringify(raw));
  ok(back.ok&&JSON.stringify(back.state.phaseOrder)===JSON.stringify([0,1,2]),'old save without phaseOrder defaults to [0,1,2]');
}

// 7. Engine.advanceToFaction доводить до фази потрібної фракції незалежно від поточної ротації
{
  const s=Engine.newGame(321);
  for(let k=0;k<4;k++)Engine.endPhase(s); // довільна кількість фаз, не кратна 3
  for(const f of [0,1,2]){ Engine.advanceToFaction(s,f); ok(Engine.phaseFaction(s)===f,'advanceToFaction lands on faction '+f); }
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
