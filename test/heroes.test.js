const L=require('./load.js')();
const {Engine,Combat,Intel,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Запит гравця («За іменних ветеранів +»): підрозділ, що завдав ворогу відчутних утрат і
// вижив, має шанс отримати іменного героя — постійний бонус моралі й бойової ефективності,
// який лишається з підрозділом, доки той сам не вибуде з кампанії остаточно.

function mkRes(cas) { return { cas, killed: cas, wounded: 0, supp: 0, fitBefore: 10, cond: 0 }; }

// 1. нижче порогу uraженнь (minCas) — геройства не буде, скільки не намагайся
{
  const s=Engine.newGame(1999);
  const u=s.units.find(x=>x.faction===0&&x.type==='inf_squad');
  for (let t=0;t<300;t++){ s.time.turn=t; Combat.heroCheck(s,u,mkRes(CONFIG.combat.heroes.minCas-1)); }
  ok(!u.hero,'no hero below the minCas threshold even after many tries');
}

// 2. вище порогу — за багато спроб (різні turn -> різний детермінований hash2) герой зрештою зʼявляється
{
  const s=Engine.newGame(1999);
  const u=s.units.find(x=>x.faction===1&&x.type==='inf_squad');
  let got=false;
  for (let t=0;t<300 && !got;t++){ s.time.turn=t; Combat.heroCheck(s,u,mkRes(CONFIG.combat.heroes.minCas+2)); if(u.hero) got=true; }
  ok(got,'a hero eventually appears above the threshold over many turns (deterministic hash, not luck-of-the-draw every time)');
  ok(CONFIG.combat.heroes.names[1].includes(u.hero.name),'hero name comes from the faction'+'\'s own name list');
}

// 3. герой підвищує базову й поточну мораль та лишається навіть якщо мораль потім впаде
{
  const s=Engine.newGame(1999);
  const u=s.units.find(x=>x.faction===2&&x.type==='inf_squad');
  const baseBefore=u.baseMorale, moraleBefore=u.morale;
  let got=false;
  for (let t=0;t<300 && !got;t++){ s.time.turn=t; Combat.heroCheck(s,u,mkRes(CONFIG.combat.heroes.minCas+2)); if(u.hero) got=true; }
  ok(got,'hero assigned for test unit');
  ok(u.baseMorale===baseBefore+CONFIG.combat.heroes.moraleBonus,'baseMorale permanently raised by the hero bonus: '+baseBefore+' -> '+u.baseMorale);
  ok(u.morale===moraleBefore+CONFIG.combat.heroes.moraleBonus,'current morale raised too: '+moraleBefore+' -> '+u.morale);
  u.morale=1; // «відступ/розсіювання» — мораль падає, але герой нікуди не зникає
  ok(!!u.hero,'hero survives a severe morale drop (retreat/disperse scenario), not destruction');
}

// 4. бойова ефективність героя (fireMult) реально впливає на розрахунок вогню
{
  const s=Engine.newGame(1999);
  const u=s.units.find(x=>x.faction===0&&x.type==='inf_platoon');
  const before=Combat.computeFire(s,u,1,'normal',{});
  u.hero={name:'Тест Тестович',since:0};
  const after=Combat.computeFire(s,u,1,'normal',{});
  ok(after.soft>before.soft,'hero unit fires more effectively than before getting the hero bonus: '+before.soft.toFixed(2)+' -> '+after.soft.toFixed(2));
}

// 5. підрозділ не отримує другого героя, маючи вже одного
{
  const s=Engine.newGame(1999);
  const u=s.units.find(x=>x.faction===0&&x.type==='mg_team');
  u.hero={name:'Вже Герой',since:0};
  for (let t=0;t<300;t++){ s.time.turn=t; Combat.heroCheck(s,u,mkRes(CONFIG.combat.heroes.minCas+2)); }
  ok(u.hero.name==='Вже Герой','unit that already has a hero keeps the same one (no overwrite)');
}

// 6. знищений підрозділ не отримує героя
{
  const s=Engine.newGame(1999);
  const u=s.units.find(x=>x.faction===0&&x.type==='inf_squad');
  u.destroyed=true;
  for (let t=0;t<300;t++){ s.time.turn=t; Combat.heroCheck(s,u,mkRes(CONFIG.combat.heroes.minCas+2)); }
  ok(!u.hero,'a destroyed unit cannot gain a hero');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
