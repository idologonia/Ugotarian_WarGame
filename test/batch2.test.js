const L=require('./load.js')();
const {Engine,Scenario,Combat,Intel,Logistics,Politics,Recruit,Foreign,Field,Mines,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};

// 1. соц. влада (0) не має підпілля (майстерня, чорний ринок), натомість — офіційні запити до РФ
{
  const s=Engine.newGame(2024);
  const v=s.map.settlements.find(x=>x.control===0&&x.pop);
  const sid=s.map.settlements.indexOf(v);
  for(const g of Politics.GROUPS) v.support[g][0]=90;
  const wr=Recruit.workshopReason(s,0,v);
  ok(!!wr && /держбезпек/.test(wr),'soc faction cannot found a workshop: '+wr);
  const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);
  Logistics.ensureEconomy(s)[0].money=100000;
  const br=Recruit.buyReason(s,0,'АКМ',1,dep);
  ok(!!br && /чорний ринок/.test(br),'soc faction cannot use the black market: '+br);
  // дем. фракція (1) і далі має обидва канали
  const v1=s.map.settlements.find(x=>x.control===1&&x.pop);
  for(const g of Politics.GROUPS) v1.support[g][1]=90;
  ok(!Recruit.workshopReason(s,1,v1),'dem faction can still found a workshop');
}

// 2. офіційний запит до РФ: кулдаун, ціна, детермінований шанс (hash2, не Math.random)
{
  const s=Engine.newGame(2024); toPhase(s,0);
  const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);
  const eco=Logistics.ensureEconomy(s)[0]; eco.money=100000;
  const why=Foreign.officialReason(s,0,'АКМ',1,dep);
  ok(!why,'official request is available to soc faction: '+why);
  const wrongFaction=Foreign.officialReason(s,1,'АКМ',1,dep);
  ok(!!wrongFaction,'official request refused for other factions: '+wrongFaction);
  const r=Foreign.officialRequest(s,0,'АКМ',1,dep.id);
  ok(r.ok,'official request resolves (approved or declined): '+(r.reason||''));
  ok(Foreign.officialCooldownLeft(s,0)>0,'cooldown started after a request');
  const r2=Foreign.officialRequest(s,0,'АКМ',1,dep.id);
  ok(!r2.ok,'immediate second request blocked by cooldown: '+r2.reason);
  if(r.approved){
    hours(s,CONFIG.officialSupply.deliveryHours+1);
    ok((dep.stock.weapons['АКМ']||0)>0,'approved official request actually delivers the goods');
  }
}

// 3. майстерня: рецепт можна змінити, покращення підвищує вихід
{
  const s=Engine.newGame(2024); toPhase(s,1);
  const v=s.map.settlements.find(x=>x.control===1&&x.pop);
  for(const g of Politics.GROUPS) v.support[g][1]=90;
  Logistics.ensureEconomy(s)[1].money=100000;
  const r=Recruit.foundWorkshop(s,1,s.map.settlements.indexOf(v));
  ok(r.ok,'workshop founded: '+(r.reason||''));
  const ws=Logistics.byId(s,r.id);
  const rr=Recruit.setWorkshopRecipe(s,1,ws.id,'parts');
  ok(rr.ok,'recipe switched to parts: '+(rr.reason||''));
  ok(ws.recipe==='parts','facility remembers chosen recipe');
  // виробництво йде в тилову мережу (на склад), а не лишається на самій майстерні —
  // та ж логіка, що й у test/blockB.test.js (перевіряємо або склад, або саму майстерню)
  const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===1);
  const before=(dep.stock.goods.parts||0)+(ws.stock.goods.parts||0);
  hours(s,2);
  const afterBase=(dep.stock.goods.parts||0)+(ws.stock.goods.parts||0);
  ok(afterBase>before,'workshop produces parts per the chosen recipe: '+before+' -> '+afterBase);
  const ur=Recruit.upgradeWorkshop(s,1,ws.id);
  ok(ur.ok,'workshop upgraded: '+(ur.reason||''));
  const beforeUp=(dep.stock.goods.parts||0)+(ws.stock.goods.parts||0);
  hours(s,1);
  const gainedAfterUpgrade=((dep.stock.goods.parts||0)+(ws.stock.goods.parts||0))-beforeUp;
  ok(gainedAfterUpgrade>0,'upgraded workshop still produces: '+gainedAfterUpgrade);
}

// 4. добровольці: асиметрична хвиля при захопленні села (переможець менше/повільніше, переможений більше/швидше)
{
  const s=Engine.newGame(2024); s.campaign.disabled=true;
  const sid=s.map.settlements.findIndex(x=>x.control===1&&x.pop);
  const st=s.map.settlements[sid];
  for(const u of s.units.filter(x=>x.idx===st.center&&x.faction!==0)) u.idx=-1;
  s.units=s.units.filter(u=>u.idx>=0);
  const soc=s.units.find(x=>x.faction===0);
  soc.idx=st.center;
  hours(s,1);
  ok(s.map.settlements[sid].control===0,'settlement captured by faction 0');
  const winOrders=Foreign.queue(s).filter(o=>o.faction===0&&o.kind==='volunteers');
  const loseOrders=Foreign.queue(s).filter(o=>o.faction===1&&o.kind==='volunteers');
  ok(winOrders.length>=CONFIG.geopolitics.volunteers.captureWave.winMin,'winner gets at least winMin volunteer orders: '+winOrders.length);
  ok(loseOrders.length>=CONFIG.geopolitics.volunteers.captureWave.loseMin,'loser gets at least loseMin volunteer orders: '+loseOrders.length);
  ok(loseOrders.length>=winOrders.length,'loser wave is not smaller than winner wave (configured to usually be bigger): '+loseOrders.length+' vs '+winOrders.length);
  ok(loseOrders.every(o=>o.arrive<=winOrders[0].arrive),'loser volunteers are queued to arrive at least as fast as winner volunteers');
}

// 5. Єгоза: ставить і піхота (не лише інженери), дає cover, і забирає ОР у чужого, хто заходить (своїм — безкоштовно)
{
  const s=Engine.newGame(2024); toPhase(s,0);
  const sq=s.units.find(u=>u.faction===0&&u.type==='inf_squad');
  sq.mp=Engine.mpMax(sq);
  const dep=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);
  sq.idx=dep.idx; // біля свого складу — є інженерне майно в зоні постачання
  const why=Field.wireReason(s,sq);
  ok(!why,'an ordinary infantry squad (not just engineers) can place wire: '+why);
  const r=Field.layWireField(s,sq.id);
  ok(r.ok,'wire placed: '+(r.reason||''));
  ok(Mines.wireAt(s,sq.idx)[0]===1,'wire level recorded for faction 0 at this hex');
  ok((s.map.wireLevel[sq.idx]||0)===1,'flat wireLevel (used for cover) updated too');
  // свій підрозділ заходить безкоштовно
  const own2=s.units.find(u=>u.faction===0&&u.type==='inf_platoon');
  own2.idx=dep.idx; own2.mp=Engine.mpMax(own2);
  const mpBefore=own2.mp;
  const res1=Mines.checkTrigger(s,own2);
  ok(own2.mp===mpBefore,'own faction pays nothing crossing its own wire');
  // чужий підрозділ втрачає ОР
  const enemy=s.units.find(u=>u.faction===1);
  enemy.idx=dep.idx; enemy.mp=Engine.mpMax(enemy);
  const mpBefore2=enemy.mp;
  const res2=Mines.checkTrigger(s,enemy);
  ok(enemy.mp<mpBefore2,'enemy unit loses MP crossing someone else\'s wire: '+mpBefore2+' -> '+enemy.mp);
  ok(!enemy.destroyed && !(enemy.vehicle&&enemy.vehicle.condition<=0),'wire never damages the unit, only costs time');
}

// 6. швидші КП й диверсії (конфіг)
{
  ok(CONFIG.engineering.cp.hours<3,'CP build time was sped up: '+CONFIG.engineering.cp.hours);
  ok(CONFIG.espionage.cooldownHours.every((h,i)=>h<=[60,36,36][i]),'espionage cooldowns reduced: '+CONFIG.espionage.cooldownHours);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
