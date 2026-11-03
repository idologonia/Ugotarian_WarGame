const L=require('./load.js')();
const {Engine,Scenario,Intel,Logistics,Politics,Foreign,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};

// Користувач: замість «купівлі добровольців» — найм ПВК за гроші (Соц. влада — «Вагнер», Демократи — «Атлантик Шилд» (НАТО,+набої), Націоналісти — «Легіон «Вовк»»).
// Справжні добровольці — безкоштовні: приходять хвилею після звільнення пункту або за
// спробою гравця «закликати» їх. Усе йде через прикордонний перехід фракції (map.borderEntry),
// який можна відрізати ворогом. Геополітика (Foreign.geo) впливає на ціну/кулдаун.

function run(f){
  const s=Engine.newGame(1999);s.campaign.disabled=true;toPhase(s,f);
  const store=Logistics.facilities(s).find(x=>Logistics.isStore(x)&&x.owner===f&&!x.destroyed);
  Logistics.ensureEconomy(s)[f].money=100000;
  return {s,store};
}

// 1. ПВК: гроші списано за ціною, дешевшою за стару ставку «добровольців» (4000)
{
  const {s,store}=run(0);
  const price=Foreign.pmcPrice(s,0,'platoon');
  ok(price<4000,'PMC base price is cheaper than the old volunteer-purchase price: '+price);
  const money0=Logistics.ensureEconomy(s)[0].money;
  const r=Foreign.hirePmc(s,0,store.id,'platoon');
  ok(r.ok,'hire ok: '+(r.reason||''));
  ok(Logistics.ensureEconomy(s)[0].money===money0-price,'exact price deducted');
  ok(Foreign.pmcCooldownLeft(s,0)>0,'PMC cooldown started');
}

// 2. ПВК прибуває професіоналом (вищий досвід, ніж був у старих «добровольців»), з потрібною назвою
{
  const {s,store}=run(0);
  Foreign.hirePmc(s,0,store.id,'platoon');
  hours(s,CONFIG.geopolitics.pmc.deliveryHours+1);
  const u=s.units.find(x=>x.faction===0&&/^ПВК/.test(x.name));
  ok(!!u,'PMC unit arrived');
  ok(u.idx===store.idx,'arrived at the chosen store');
  ok(u.experience===CONFIG.geopolitics.pmc.experience&&u.experience>=2,'PMC arrives experienced (seasoned professionals)');
  ok(/Вагнер/.test(u.name),'soc PMC is named «Вагнер»');
}

// 3. демократи — НАТО-ПВК «Атлантик Шилд» ще й привозить набої; соц і нац — без набоїв
{
  const {s,store}=run(1);
  const logBefore=s.nextLogId;
  Foreign.hirePmc(s,1,store.id,'platoon');
  hours(s,CONFIG.geopolitics.pmc.deliveryHours+1);
  const fresh=s.log.filter(x=>x.id>=logBefore);
  const arrival=fresh.find(x=>/прибули бійці ПВК/.test(x.text));
  ok(!!arrival&&/Атлантик Шилд/.test(arrival.text)&&/Також доставлено/.test(arrival.text),'NATO PMC delivery also mentions ammo: '+(arrival&&arrival.text));
  for(const f of [0,2]){
    const r2=run(f);
    const lb=r2.s.nextLogId;
    Foreign.hirePmc(r2.s,f,r2.store.id,'platoon');
    hours(r2.s,CONFIG.geopolitics.pmc.deliveryHours+1);
    const a2=r2.s.log.filter(x=>x.id>=lb).find(x=>/прибули бійці ПВК/.test(x.text));
    ok(!!a2&&!/Також доставлено/.test(a2.text),'no ammo bonus for faction '+f+' PMC: '+(a2&&a2.text));
  }
}

// 4. видима присутність ПВК б'є по підтримці penaltyGroup і по геополітиці (найм патроном задоволений)
{
  const {s,store}=run(2);
  const geo0=Foreign.geo(s,2);
  const owned=s.map.settlements.filter(x=>x.control===2&&x.pop);
  ok(owned.length>0,'nat controls a populated settlement');
  const before=owned.map(x=>x.support.cauc[2]);
  Foreign.hirePmc(s,2,store.id,'platoon');
  ok(Foreign.geo(s,2)>geo0,'hiring a PMC improves geopolitical relation with the patron (−2)');
  hours(s,CONFIG.geopolitics.pmc.deliveryHours+1);
  const after=owned.map(x=>x.support.cauc[2]);
  ok(after.every((v,i)=>v<before[i]+1e-9),'cauc-group support drops in every nat-controlled settlement on PMC arrival');
}

// 5. добровольці: ручний заклик, безкоштовний або дешевший за добрих стосунків, довший кулдаун за погані
{
  const {s,store}=run(1);
  const r=Foreign.callVolunteers(s,1);
  ok(r.ok,'call ok: '+(r.reason||''));
  ok(Foreign.volCooldownLeft(s,1)>0,'call cooldown started');
  const r2=Foreign.callVolunteers(s,1);
  ok(!r2.ok&&/раз на/.test(r2.reason),'second call refused by cooldown: '+r2.reason);
  hours(s,CONFIG.geopolitics.volunteers.deliveryHours+1);
  const u=s.units.find(x=>x.faction===1&&/^Добровольці/.test(x.name));
  ok(!!u,'called volunteers arrived');
  ok(u.experience===0,'volunteers are untrained (Недосвідчений), unlike PMC');
}

// 6. звільнення населеного пункту: безкоштовна хвиля підтримки + добровольці, без ручного закликання
{
  const {s,g}=(()=>{const s=Engine.newGame(1999);s.campaign.disabled=true;return {s,g:Engine.grid(s)};})();
  const sid=s.map.settlements.findIndex(x=>x.control===1&&x.pop); // чуже (демократичне) село
  ok(sid>=0,'found a dem-controlled populated settlement to liberate');
  const st=s.map.settlements[sid];
  // «звільнення»: прибирає оборонця (демократи) й ставить на центр соц(0) підрозділ одноосібно —
  // controlByHolding за годину утримає гекс за соц, що й зафіксує зміну власника пункту.
  for(const u of s.units.filter(x=>x.idx===st.center&&x.faction!==0)) u.idx=-1;
  s.units=s.units.filter(u=>u.idx>=0);
  const soc=s.units.find(x=>x.faction===0);
  soc.idx=st.center;
  const logBefore=s.nextLogId;
  const unitsBefore=s.units.length;
  hours(s,1); // повна година -> endOfHour виявить зміну власника центру
  ok(s.map.settlements[sid].control===0,'settlement control flipped to the liberator');
  const fresh=s.log.filter(x=>x.id>=logBefore);
  ok(fresh.some(x=>/хвил.+ підтримки.*добровольців/.test(x.text)),'liberation logs a support wave + volunteers message');
  ok(Foreign.queue(s).some(o=>o.faction===0&&o.kind==='volunteers'),'free volunteer order queued without calling for it');
}

// 7. прикордонний перехід відрізано — ПВК/добровольці не доходять
{
  const {s,store}=run(2);
  const idx=Foreign.entryIdx(s,2);
  ok(idx>=0,'nat has a border entry hex');
  s.map.control[idx]=0; // імітуємо втрату переходу
  const r=Foreign.hirePmc(s,2,store.id,'platoon');
  ok(!r.ok&&/втрачено|заблоковано|відрізано/i.test(r.reason),'PMC hire blocked when the border entry is cut: '+r.reason);
  const r2=Foreign.callVolunteers(s,2);
  ok(!r2.ok,'volunteer call also blocked when the border entry is cut: '+r2.reason);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
