const L=require('./load.js')();
const {Engine,Scenario,Combat,Intel,Logistics,Foreign,Transport,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};

// Запит гравця: гармата Д-30 (122 мм) — одна штатна у соц. влади, іншим фракціям лише через ПВК.

// 1. соц. влада має Д-30 у стартовому складі
{
  const s=Engine.newGame(2024);
  const guns=s.units.filter(u=>u.faction===0&&u.type==='arty_team');
  ok(guns.length===1,'soc faction starts with exactly one Д-30 team: '+guns.length);
  ok(guns[0]&&guns[0].weapons&&guns[0].weapons['Д-30']===1,'the unit is actually armed with Д-30: '+JSON.stringify(guns[0]&&guns[0].weapons));
  ok(s.units.every(u=>!(u.faction!==0&&u.type==='arty_team')),'factions 1/2 do not start with a Д-30');
}

// 2. Д-30 не формується через звичайний набір (підпілля)
{
  ok(!CONFIG.recruitment.types.includes('arty_team'),'arty_team is not a normal recruitment type');
}

// 3. демократи/націоналісти можуть замовити Д-30 лише через меню ПВК
{
  for(const f of [1,2]){
    const items=Object.keys(Foreign.pmcItems(f));
    ok(items.includes('arty'),'faction '+f+' PMC menu offers Д-30 ("arty"): '+items.join(','));
  }
  const s=Engine.newGame(1999); toPhase(s,1);
  const store=Logistics.facilities(s).find(x=>Logistics.isStore(x)&&x.owner===1&&!x.destroyed);
  Logistics.ensureEconomy(s)[1].money=100000;
  const r=Foreign.hirePmc(s,1,store.id,'arty');
  ok(r.ok,'dem faction can order a Д-30 via PMC: '+(r.reason||''));
  hours(s,CONFIG.geopolitics.pmc.deliveryHours+1);
  const u=s.units.find(x=>x.faction===1&&x.foreignKind==='pmc'&&x.type==='arty_team');
  ok(!!u,'ordered Д-30 team actually arrives');
  ok(/Д-30/.test(u.name),'arrived unit name mentions Д-30: '+u.name);
}

// 4. Д-30 реально стріляє (навісний вогонь, без прямої видимості) і сильніший за міномет
{
  const s=Engine.newGame(2024); const g=Engine.grid(s);
  const gun=s.units.find(u=>u.faction===0&&u.type==='arty_team');
  const mortar=s.units.find(u=>u.faction===0&&u.type==='mortar');
  const tgt=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
  const obs=s.units.find(u=>u.faction===0&&u.type==='recon');
  obs.idx=g.neighbor(tgt.idx,3)>=0&&!s.units.some(u=>u.idx===g.neighbor(tgt.idx,3))?g.neighbor(tgt.idx,3):g.neighbor(tgt.idx,4);
  gun.idx=g.idx(g.col(tgt.idx)-10,g.row(tgt.idx));
  toPhase(s,0); gun.mp=Engine.mpMax(gun); gun.movedThisPhase=false; gun.ammo['122']=40; Intel.update(s);
  const r=Combat.attack(s,gun.id,{hex:tgt.idx},'high');
  ok(r.ok,'Д-30 can fire indirectly at a hex without direct LOS: '+(r.reason||''));
  ok(CONFIG.weapons['Д-30'].fp>CONFIG.weapons['Міномет 81 мм'].fp,'Д-30 fp is higher than the 81mm mortar');
  ok(CONFIG.weapons['Д-30'].range>CONFIG.weapons['Міномет 81 мм'].range,'Д-30 range is longer than the 81mm mortar');
}

// 5. запит гравця: «її возити треба» — сама гармата рухається ледь-ледь (mp мізерний),
//    серйозне перевезення лише посадкою в тягач «Урал-4320» (звичайний генеричний Transport.board)
{
  const s=Engine.newGame(2024);
  const gun=s.units.find(u=>u.faction===0&&u.type==='arty_team');
  ok(Engine.mpMax(gun)<=4,'unassisted (foot) arty_team movement is crippled (mp<=4): '+Engine.mpMax(gun));

  const ural=s.units.find(u=>u.faction===0&&u.type==='veh_ural');
  ok(!!ural,'soc faction starts with a dedicated Урал-4320 tow truck');
  ural.idx=gun.idx; // ставимо тягач у той самий гекс, де гармата
  gun.mp=Engine.mpMax(gun);
  const why=Transport.boardReason(s,gun,ural);
  ok(!why,'the arty_team crew can board the tow truck like any foot unit: '+why);
  const r=Transport.board(s,gun.id,ural.id);
  ok(r.ok,'boarding the tow truck succeeds: '+(r.reason||''));
  ok(gun.embarked===ural.id,'the gun is now embarked in (towed by) the Урал');
  ural.mp=Engine.mpMax(ural); ural.idx=s.map.settlements[0].center;
  Transport.syncPassengers(s,ural);
  ok(gun.idx===ural.idx,'the gun travels together with the tow truck, at the truck\'s pace, not its own crawl speed');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
