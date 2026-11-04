// Торгівля СВ з РФ: продаж нафти/пального/продукції через перехід «Росія» (оплата після
// доставки, пропадає при втраті переходу) і купівля (офіційні запити).
const L=require('./load.js')();
const {Engine,Foreign,Logistics}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{while(Engine.phaseFaction(s)!==f)Engine.endPhase(s);};
const money=(s,f)=>Logistics.ensureEconomy(s)[f].money;

{
  const s=Engine.newGame(1999);toPhase(s,0);
  const e=Foreign.entryIdx(s,0);
  ok(e>=0&&!Foreign.borderReason(s,0,null),'у СВ є відкритий перехід «Росія»');
  ok(Foreign.saleReason(s,1,'fuel',1)!=null,'повстанцям продаж у РФ недоступний');
  // покласти пальне на склад, пов’язаний із переходом
  const src=Foreign.saleSources(s,0).find(x=>Logistics.isStore(x));
  ok(!!src,'є склад СВ, пов’язаний територією з переходом: '+(src&&src.name));
  src.stock.goods.fuel=(src.stock.goods.fuel||0)+2000;
  const have=Foreign.saleAvailable(s,0,'fuel');
  const m0=money(s,0);
  const r=Foreign.sellRF(s,0,'fuel',2);
  ok(r.ok,'продаж 2 партій пального: '+(r.reason||r.price+' грн'));
  ok(Foreign.saleAvailable(s,0,'fuel')===have-1000,'товар знято з об’єктів одразу');
  ok(money(s,0)===m0,'гроші ще не надійшли (партія в дорозі)');
  ok(!Foreign.sellRF(s,0,'fuel',1).ok,'кулдаун між партіями');
  for(let h=0;h<CONFIG_HOURS(L)+1;h++){Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);}
  ok(s.log.some(e=>/Експорт у РФ: партію .* прийнято, отримано/.test(e.text)),'оплата надійшла після доставки (запис у журналі)');
}
{
  const s=Engine.newGame(1999);toPhase(s,0);
  const src=Foreign.saleSources(s,0).find(x=>Logistics.isStore(x));src.stock.goods.fuel=(src.stock.goods.fuel||0)+2000;
  const r=Foreign.sellRF(s,0,'fuel',1);ok(r.ok,'друга гра: партія відправлена');
  // втратити перехід
  s.map.control[Foreign.entryIdx(s,0)]=1;
  const m0=money(s,0);
  for(let h=0;h<CONFIG_HOURS(L)+1;h++){Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);s.map.control[Foreign.entryIdx(s,0)]=1;}
  ok(s.log.some(e=>/Експортна партія .* пропала/.test(e.text)),'перехід втрачено — партія пропала');
  ok(!(s.rfSales||[]).length,'черга експорту порожня');
  void m0;
}
{
  const s=Engine.newGame(1999);toPhase(s,0);
  const dep=Logistics.facilities(s).find(x=>Logistics.isStore(x)&&x.owner===0);
  const r=Foreign.officialRequest(s,0,'АКМ',1,dep.id);
  ok(r.ok,'купівля в РФ (офіційний запит) працює: '+(r.approved?'схвалено':'відхилено'));
}
function CONFIG_HOURS(L){return L.CONFIG.russiaTrade.deliveryHours;}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
