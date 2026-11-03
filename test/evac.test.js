const L=require('./load.js')();
const {Engine,Scenario,Intel,Transport,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Користувач: збентежений (розсіяний) підрозділ все одно можна погрузити в машину — це
// власне евакуаційний випадок, а не щось, що має бути заблоковане.

function blank(seed=7){
  const s=Engine.newGame(seed); s.campaign.disabled=true;
  const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.river[i]=0; s.map.terrain[i]=TERRAIN_ID.plain;}
  return {s,g};
}

{
  const {s,g}=blank(); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && x.type==='inf_squad');
  const v=s.units.find(x=>x.faction===0 && x.type==='veh_kamaz');
  v.idx=u.idx; // та ж машина в тому самому гексі
  u.dispersal=3; u.personnel.straggling=Math.max(1,u.personnel.fit-1); // розсіяний
  const whyNormal=Engine.checkCommandable(s,u);
  ok(!!whyNormal,'dispersed unit cannot receive ordinary orders (e.g. move)');
  const r=Transport.board(s,u.id,v.id);
  ok(r.ok,'but a dispersed unit CAN still be loaded into a vehicle (evac case): '+(r.reason||''));
  ok(u.embarked===v.id,'unit is now embarked');
  // повністю знищений підрозділ (fit<=0) все ж не можна евакуювати — нема кого
  u.embarked=null; v.carrying=[];
  u.personnel.fit=0;
  const r2=Transport.board(s,u.id,v.id);
  ok(!r2.ok,'a unit with zero fit personnel still cannot board (nothing left to evacuate): '+r2.reason);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
