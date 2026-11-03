const L=require('./load.js')();
const {Engine,Scenario,Intel,Combat,Transport,Loot,Logistics,Field,Mines,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Користувач: інженери мають самі брати своє майно для роботи (без возня з підвозом/
// вивантаженням технікою), а нова логістична група має підносити БК з польового складу на
// передову пішки — без машини.

function blank(seed=7){
  const s=Engine.newGame(seed); s.campaign.disabled=true;
  const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.river[i]=0; s.map.terrain[i]=TERRAIN_ID.plain;}
  return {s,g};
}

// 1. інженер сам завантажує інженерне майно зі складу (без техніки) і несе його за собою
{
  const {s,g}=blank(); toPhase(s,0);
  const e=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  const dep=Logistics.makeFacility(s,'depot',e.idx,0,'Тест-склад');
  dep.stock.goods.eng=100;
  ok(Logistics.cargoCapKg(e)>0,'eng_squad can carry cargo on foot');
  const lr=Logistics.loadReason(s,e);
  ok(!lr,'engineer allowed to self-load at the depot: '+lr);
  const r=Logistics.loadFromStore(s,e.id,'eng');
  ok(r.ok && e.cargo.goods.eng>0,'engineer loaded engineering supplies into own cargo: '+(r.text||r.reason));
  // йде геть від складу й будує бліндаж на новому місці, використовуючи ВЛАСНИЙ вантаж
  const away=g.neighbor(e.idx,0);
  e.idx=away; e.movedThisPhase=false;
  const opts=Field.options(s,e);
  ok(opts.some(o=>o.type==='shelter'),'shelter project offered away from any depot, using own carried supplies');
  const sp=Field.startProject(s,e.id,'shelter',away);
  ok(sp.ok,'bunker project started purely from self-carried eng goods (no depot nearby): '+(sp.reason||''));
}

// 2. без власного вантажу, без складу поруч і без інженерного майна в мережі постачання —
// побудувати бліндаж не можна (підтверджує баг, про який писав гравець: причина —
// відсутність інженерного майна в зоні постачання/вантажі, а не щось зламане)
{
  const {s,g}=blank(); toPhase(s,0);
  s.facilities=[]; // жодного складу з запасами на всій карті
  const e=s.units.find(x=>x.faction===0 && x.type==='eng_squad');
  e.cargo.goods={};
  const opts=Field.options(s,e);
  ok(opts.some(o=>o.type==='shelter'),'bunker is listed as an option (menu shows it)');
  const sp=Field.startProject(s,e.id,'shelter',e.idx);
  ok(!sp.ok && /Потрібно/.test(sp.reason),'but it is rejected with a clear materials reason (this was the player-reported bug — "Інженерне майно" has no production, only black market/own cargo): '+sp.reason);
}

// 3. логістична група формується, носить БК від складу на передову й видає його підрозділу
{
  const {s,g}=blank(); toPhase(s,0);
  ok(CONFIG.unitTypes.supply_team,'supply_team unit type exists');
  ok(CONFIG.recruitment.types.includes('supply_team'),'supply_team is a recruitable type');
  const dep=Logistics.makeFacility(s,'depot',g.idx(10,10),0,'Тест-склад-2');
  dep.stock.ammo['545']=5000;
  const sup=Scenario.createUnit(s,'supply_team',0,dep.idx,1);
  s.units.push(sup);
  ok(Logistics.cargoCapKg(sup)>0,'supply_team can carry cargo on foot');
  const r=Logistics.loadFromStore(s,sup.id,'ammo');
  ok(r.ok && Object.values(sup.cargo.ammo).some(n=>n>0),'supply team loaded ammo on foot, no vehicle needed: '+(r.text||r.reason));
  // йде на передову й видає боєкомплект підрозділу, що там сидить без набоїв
  const front=s.units.find(x=>x.faction===0 && x.type==='inf_squad');
  front.idx=g.neighbor(dep.idx,0); front.ammo['545']=0;
  sup.idx=front.idx; sup.movedThisPhase=false;
  const ir=Logistics.issueReason(s,sup);
  ok(!ir,'supply team (foot, no vehicle) can issue cargo to units in its hex: '+ir);
  const res=Logistics.issueFromCargo(s,sup.id);
  ok(res.ok && front.ammo['545']>0,'front-line squad resupplied by the foot logistics team: '+front.ammo['545']);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
