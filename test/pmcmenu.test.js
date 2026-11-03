const L=require('./load.js')();
const {Engine,Logistics,Foreign,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};

function run(f){
  const s=Engine.newGame(2024); s.campaign.disabled=true; toPhase(s,f);
  const store=Logistics.facilities(s).find(x=>Logistics.isStore(x)&&x.owner===f&&!x.destroyed);
  Logistics.ensureEconomy(s)[f].money=100000;
  return {s,store};
}

// Користувач: замість фіксованого «взводу», заклик до ПВК тепер відкриває меню замовлення
// (піхотний взвод / кулеметний / гранатометний розрахунок, а в соц. влади («Вагнер») ще й
// МТ-ЛБ) — кожен тип зі своєю ціною.

// 1. соц. влада («Вагнер») має розширений каталог — 4 типи, решта — 3
{
  const {s}=run(0);
  const items0=Object.keys(Foreign.pmcItems(0));
  ok(items0.includes('platoon')&&items0.includes('mtlb')&&items0.includes('mg')&&items0.includes('ags'),'Wagner (soc) catalog has 4 item types: '+items0.join(','));
  for(const f of [1,2]){
    const items=Object.keys(Foreign.pmcItems(f));
    ok(items.includes('platoon')&&items.includes('mg')&&items.includes('ags')&&!items.includes('mtlb'),'faction '+f+' catalog has no MTLB: '+items.join(','));
  }
}

// 2. ціна різна за типом (взвод дорожчий за розрахунок) і правильний тип прибуває
{
  const {s,store}=run(0);
  const priceP=Foreign.pmcPrice(s,0,'platoon'), priceMg=Foreign.pmcPrice(s,0,'mg'), priceMtlb=Foreign.pmcPrice(s,0,'mtlb');
  ok(priceP>priceMg,'platoon costs more than a machine-gun team: '+priceP+' > '+priceMg);
  ok(priceP>priceMtlb,'platoon costs more than an MTLB crew: '+priceP+' > '+priceMtlb);
  const r=Foreign.hirePmc(s,0,store.id,'mg');
  ok(r.ok,'order mg team ok: '+(r.reason||''));
  hours(s,CONFIG.geopolitics.pmc.deliveryHours+1);
  const u=s.units.find(x=>x.faction===0&&x.foreignKind==='pmc');
  ok(!!u&&u.type==='mg_team','the unit that arrived is actually an mg_team: '+(u&&u.type));
  ok(/Кулеметний розрахунок/.test(u.name),'arrived unit name mentions the ordered item: '+u.name);
}

// 3. один заклик — один кулдаун незалежно від того, що замовили; повторне замовлення іншого типу під час кулдауну відмовляється
{
  const {s,store}=run(0);
  const r1=Foreign.hirePmc(s,0,store.id,'ags');
  ok(r1.ok,'first order (ags) ok: '+(r1.reason||''));
  const r2=Foreign.hirePmc(s,0,store.id,'platoon');
  ok(!r2.ok&&/раз на/.test(r2.reason),'second order of a different type is still blocked by the shared cooldown: '+r2.reason);
}

// 4. МТ-ЛБ замовлене у «Вагнера» прибуває як керована машина (не піхота)
{
  const {s,store}=run(0);
  Foreign.hirePmc(s,0,store.id,'mtlb');
  hours(s,CONFIG.geopolitics.pmc.deliveryHours+1);
  const u=s.units.find(x=>x.faction===0&&x.foreignKind==='pmc');
  ok(!!u&&!!u.vehicle,'ordered MTLB arrives as an actual vehicle unit: '+JSON.stringify(u&&u.vehicle));
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
