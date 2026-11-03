const L=require('./load.js')();
const {Engine,Combat,Intel,Logistics,Politics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Рішення автора (запит гравця): пропаганда — дешевший за гум. допомогу спосіб піднести
// підтримку в пункті; якщо ворог нещодавно зачепив там цивільних, ефект підсилюється.

// 1. базова пропаганда: коштує грошей, піднімає підтримку, ставить кулдаун на пункт
{
  const s=Engine.newGame(2001); toPhase(s,0);
  const sid=0, st=s.map.settlements[sid];
  st.control=0;
  const eco=Logistics.ensureEconomy(s)[0]; eco.money=10000;
  const before=Politics.support(st,0);
  const why=Politics.propagandaReason(s,0,st);
  ok(!why,'propaganda allowed under own control with enough money: '+why);
  const r=Politics.propaganda(s,0,sid);
  ok(r.ok && !r.outrage,'basic propaganda succeeds without outrage bonus: '+JSON.stringify(r));
  ok(Politics.support(st,0)>before,'support increased: '+before.toFixed(1)+' -> '+Politics.support(st,0).toFixed(1));
  ok(eco.money===10000-CONFIG.population.propaganda.money,'money spent: '+eco.money);
  const why2=Politics.propagandaReason(s,0,st);
  ok(!!why2 && /раз на/.test(why2),'cannot repeat propaganda in the same settlement before cooldown: '+why2);
}

// 2. без контролю й без коридору — заборонено
{
  const s=Engine.newGame(2001); toPhase(s,0);
  const sid=0, st=s.map.settlements[sid];
  st.control=1;
  Logistics.ensureEconomy(s)[0].money=10000;
  const why=Politics.propagandaReason(s,0,st);
  ok(!!why,'propaganda blocked without control or corridor: '+why);
}

// 3. «ворог убиває цивільних» — нещодавній обстріл ворогом підсилює ефект і б'є по його підтримці
{
  const s=Engine.newGame(2001); const g=Engine.grid(s);
  const city=s.map.settlements[0]; city.control=0;
  const m=s.units.find(u=>u.faction===2&&u.type==='mortar');
  const tgt=s.units.find(u=>u.faction===0&&u.type==='inf_platoon');
  m.idx=g.idx(g.col(tgt.idx)-8,g.row(tgt.idx)); Intel.update(s); toPhase(s,2); m.mp=16; m.movedThisPhase=false;
  let hit=false;
  for(let h=0;h<3 && !hit;h++){
    m.attackedTurn=0; m.movedThisPhase=false; m.ammo.m81=40;
    const r=Combat.attack(s,m.id,{hex:tgt.idx},'high');
    if(!r.ok) break;
    if(city.civKilled+city.civWounded>0) hit=true;
  }
  ok(hit,'mortar fire caused civilian casualties for the outrage scenario');
  ok(!!city.lastCivBy && city.lastCivBy.f===2,'settlement remembers who last hit civilians there: '+JSON.stringify(city.lastCivBy));
  toPhase(s,0);
  Logistics.ensureEconomy(s)[0].money=10000;
  const out=Politics.propagandaOutrage(s,0,city);
  ok(!!out && out.f===2,'propagandaOutrage detects the recent enemy atrocity: '+JSON.stringify(out));
  const enemySupBefore=Politics.support(city,2);
  const r=Politics.propaganda(s,0,0);
  ok(r.ok && r.outrage,'propaganda reports outrage-boosted effect: '+JSON.stringify(r));
  ok(Math.abs(r.gain-CONFIG.population.propaganda.support*CONFIG.population.propaganda.outrageMult)<0.05,'outrage multiplier applied to gain: '+r.gain);
  ok(Politics.support(city,2)<enemySupBefore,'accused faction loses some support in the same settlement: '+enemySupBefore.toFixed(1)+' -> '+Politics.support(city,2).toFixed(1));
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
