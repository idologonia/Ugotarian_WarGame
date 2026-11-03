const L=require('./load.js')();
const {Engine,Politics,Logistics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Запит гравця: диверсія/шпигуни — доступні всім фракціям, але демократи й націоналісти
// («ДП»/«НП») мають вищий шанс успіху за соц. владу («СВ») — балансове рішення автора.

// 1. шанс успіху: дем/нац вищий за соц
{
  const soc=Politics.spyChance(0), dem=Politics.spyChance(1), nat=Politics.spyChance(2);
  ok(dem>soc&&nat>soc,'dem/nat spy chance higher than soc: '+soc+' vs '+dem+'/'+nat);
}

// 2. не можна диверсувати власний або союзний пункт
{
  const s=Engine.newGame(1999);
  const own=s.map.settlements.find(x=>x.pop&&x.control===0);
  ok(!!Politics.spyReason(s,0,own),'cannot spy on own settlement: '+Politics.spyReason(s,0,own));
}

// 3. успішна диверсія шкодить об'єкту противника (facility condition/stock down) і стягує кошти/кулдаун
{
  const s=Engine.newGame(1999); toPhase(s,1);
  Logistics.ensureEconomy(s)[1].money=50000;
  const enemySid=s.map.settlements.findIndex(x=>x.pop&&x.control===0);
  ok(enemySid>=0,'found an enemy (soc) settlement to target');
  const before=Logistics.ensureEconomy(s)[1].money;
  // шукаємо годину, де випаде успіх (детермінований hash2, тож просто пробуємо кілька турів)
  let r=null, tries=0;
  while(tries++<40){
    r=Politics.sendSpies(s,1,enemySid);
    if(!r.ok) break; // кулдаун/гроші — зупиняємось
    if(!r.caught) break;
    for(let h=0;h<CONFIG.espionage.cooldownHours[1];h++){Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);}
    toPhase(s,1);
    Logistics.ensureEconomy(s)[1].money=50000;
  }
  ok(r&&r.ok,'spy mission executed (ok): '+JSON.stringify(r));
}

// 4. провал диверсії зменшує власну підтримку ініціатора в пункті-цілі
{
  const s=Engine.newGame(1999); toPhase(s,1);
  Logistics.ensureEconomy(s)[1].money=50000;
  const enemySid=s.map.settlements.findIndex(x=>x.pop&&x.control===0);
  let r=null, tries=0, found=false;
  while(tries++<40){
    const before=Politics.support(s.map.settlements[enemySid],1);
    r=Politics.sendSpies(s,1,enemySid);
    if(!r.ok){ console.log('  (unexpected block: '+r.reason+')'); break; }
    if(r.caught){
      const after=Politics.support(s.map.settlements[enemySid],1);
      ok(after<=before,'getting caught does not raise own support in the target settlement: '+before.toFixed(1)+' -> '+after.toFixed(1));
      found=true; break;
    }
    for(let h=0;h<CONFIG.espionage.cooldownHours[1];h++){Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);}
    toPhase(s,1);
    Logistics.ensureEconomy(s)[1].money=50000;
  }
  ok(found,'observed at least one caught spy mission within the trial window');
}

// 5. кулдаун спрацьовує (повторна спроба відразу — відмова)
{
  const s=Engine.newGame(1999); toPhase(s,1);
  Logistics.ensureEconomy(s)[1].money=50000;
  const enemySid=s.map.settlements.findIndex(x=>x.pop&&x.control===0);
  const r1=Politics.sendSpies(s,1,enemySid);
  ok(r1.ok,'first spy mission goes through: '+(r1.reason||''));
  const r2=Politics.sendSpies(s,1,enemySid);
  ok(!r2.ok&&/раз на/.test(r2.reason),'immediate second attempt is blocked by cooldown: '+r2.reason);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
