// Цивільні колони: вихід із пункту під боями, рух до краю карти, евакуація під коридором
// (захищені), обстріл — втрати цивільних, підтримка, репутація, порушення коридору.
const L=require('./load.js')();
const {Engine,Civil,Politics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
{
  const s=Engine.newGame(1999);s.campaign.disabled=true;
  const town=s.map.settlements[1];
  const c=Civil.spawn(s,town,200,false);
  ok(c&&c.people===200&&c.path.length>0,'колона біженців сформована, маршрут до краю карти: '+c.path.length+' гекс.');
  ok(!Civil.spawn(s,s.map.settlements[2],10,false),'менше '+CONFIG.civil.minColumn+' осіб — колони не видно');
  const d0=c.path.length;hours(s,1);
  ok(c.path.length<d0,'колона рухається ('+d0+' → '+c.path.length+')');
  hours(s,30);
  ok(!Civil.columns(s).some(x=>x.id===c.id),'колона покинула зону конфлікту');
}
{
  const s=Engine.newGame(1999);s.campaign.disabled=true;
  const town=s.map.settlements[1];
  const c=Civil.spawn(s,town,200,false);
  const sup0=Politics.support(town,0),rep0=s.diplomacy.reputation[0];
  Civil.onFire(s,c.idx,0,40,true);
  ok(c.killed>0&&c.people<200,'обстріл: загинули цивільні ('+c.killed+')');
  ok(Politics.support(town,0)<sup0&&s.diplomacy.reputation[0]<rep0,'стрілець втрачає підтримку й репутацію');
}
{
  // зелений коридор: евакуація й захищена колона
  const s=Engine.newGame(1999);s.campaign.disabled=true;
  const town=s.map.settlements[1];
  Politics.rel(s,0,1).agreements.push({type:'corridor',from:0,to:1,terms:{settlement:1},since:s.time.turn,until:s.time.turn+6});
  const pop0=Politics.totalPop(town);
  hours(s,1);
  const ev=Civil.columns(s).find(x=>x.corridor&&x.from===1);
  ok(ev&&Politics.totalPop(town)<pop0,'коридор: евакуаційна колона ('+(ev&&ev.people)+' осіб)');
  const rep0=s.diplomacy.reputation[0];
  Civil.onFire(s,ev.idx,0,20,false);
  ok(s.diplomacy.reputation[0]<rep0-CONFIG.civil.repHitCorridor+1,'обстріл захищеної колони — сильніший удар по репутації');
  ok(!Politics.active(s,0,1,'corridor'),'обстріл захищеної колони порушив коридор');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
