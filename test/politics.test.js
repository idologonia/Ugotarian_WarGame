const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,SaveSystem,Logistics,Politics,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const hours=(s,n)=>{for(let i=0;i<n*3&&!s.campaign.over;i++)Engine.endPhase(s);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
// 1. населення
{const s=Engine.newGame(1999);const S=s.map.settlements;
 ok(S.every(x=>x.pop&&Politics.totalPop(x)>0),'all settlements populated: '+S.map(x=>x.name+' '+Politics.totalPop(x)).join(', '));
 ok(Politics.support(S[3],0)>Politics.support(S[3],2),'Russian-majority village favours socialists ('+Math.round(Politics.support(S[3],0))+' vs '+Math.round(Politics.support(S[3],2))+')');
 const inc0=Logistics.summary(s,0).income;ok(inc0>0,'income uses support multiplier ('+inc0+')');
}
// 2. цивільні втрати від мінометів у місті
{const s=Engine.newGame(1999);const g=Engine.grid(s);const city=s.map.settlements[0];
 const m=s.units.find(u=>u.faction===2&&u.type==='mortar');const obs=s.units.find(u=>u.faction===2&&u.type==='recon');
 const tgt=s.units.find(u=>u.faction===0&&u.type==='inf_platoon');
 obs.idx=g.neighbor(tgt.idx,3)>=0&&!s.units.some(u=>u.idx===g.neighbor(tgt.idx,3))?g.neighbor(tgt.idx,3):g.neighbor(tgt.idx,4);
 m.idx=g.idx(g.col(tgt.idx)-8,g.row(tgt.idx));Intel.update(s);toPhase(s,2);m.mp=16;m.movedThisPhase=false;obs.idx=obs.idx;Intel.update(s);
 const sup0=Politics.support(city,2);
 let civ=0;for(let h=0;h<3;h++){m.attackedTurn=0;m.movedThisPhase=false;m.ammo.m81=40;const r=Combat.attack(s,m.id,{hex:tgt.idx},'high');if(!r.ok){console.log(r.reason);break;}}
 ok(city.civKilled+city.civWounded>0,'mortar fire in city causes civilian casualties ('+city.civKilled+'/'+city.civWounded+')');
 ok(Politics.support(city,2)<sup0,'shooter loses support ('+sup0.toFixed(1)+' -> '+Politics.support(city,2).toFixed(1)+')');
 ok(city.damage.housing>0,'housing damaged '+city.damage.housing+'%');
 hours(s,1);ok(city.refugees>0,'refugees after fighting: '+city.refugees);
}
// 3. дипломатія: перемир'я, порушення
{const s=Engine.newGame(1999);
 const p=Politics.propose(s,0,1,'ceasefire');ok(p.ok,'soc proposes ceasefire to dem');
 const r0=Politics.respond(s,p.id,true);ok(!r0.ok,'cannot answer in wrong phase: '+r0.reason);
 Engine.endPhase(s);ok(Politics.incoming(s,1).length===1,'dem sees incoming proposal');
 ok(Politics.respond(s,p.id,true).ok&&Politics.statusText(s,0,1)==='Перемир’я','ceasefire accepted');
 // атака під час перемир'я
 const g=Engine.grid(s);toPhase(s,0);const a=s.units.find(u=>u.faction===0&&u.type==='inf_platoon');const b=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
 let t=-1;for(let d=0;d<6;d++){const n=g.neighbor(a.idx,d);if(n>=0&&!s.units.some(u=>u.idx===n)){t=n;break;}}b.idx=t;Intel.update(s);a.mp=16;
 const pv=Combat.previewAttack(s,a.id,{unitId:b.id});ok(pv.ok&&pv.notes[0].includes('УВАГА'),'preview warns about breaking ceasefire');
 const rep0=s.diplomacy.reputation[0];Combat.attack(s,a.id,{unitId:b.id});
 ok(Politics.statusText(s,0,1)==='Війна'&&s.diplomacy.reputation[0]<rep0,'attack breaks ceasefire, reputation '+rep0+' -> '+s.diplomacy.reputation[0]);
}
// 4. союз, обмін розвідданими, обмін полоненими, передача території
{const s=Engine.newGame(1999);toPhase(s,1);
 Politics.propose(s,1,2,'ceasefire');Engine.endPhase(s);Politics.respond(s,s.diplomacy.proposals[0].id,true);
 const al=Politics.propose(s,2,1,'alliance');ok(al.ok,'alliance proposed after ceasefire');
 hours(s,0);Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);Engine.endPhase(s);
 if(Engine.phaseFaction(s)!==1)toPhase(s,1);ok(Politics.respond(s,al.id,true).ok&&Politics.allied(s,1,2),'alliance concluded');
 // розвіддані союзника
 const n=s.units.find(u=>u.faction===2);const socU=s.units.find(u=>u.faction===0);const g=Engine.grid(s);
 socU.idx=g.neighbor(n.idx,0)>=0?g.neighbor(n.idx,0):g.neighbor(n.idx,1);Intel.update(s);
 ok(Intel.isVisible(s,1,socU.id),'dem sees what nat sees (shared intel)');
 hours(s,1);ok(s.events.find(e=>e.id==='front').fired,'conditional event fired: united front');
 // обмін полоненими
 s.prisoners.push({holder:1,origin:0,count:4},{holder:0,origin:1,count:3});toPhase(s,1);
 const ex=Politics.propose(s,1,0,'exchange');Engine.endPhase(s);Engine.endPhase(s);ok(Engine.phaseFaction(s)===0&&Politics.respond(s,ex.id,true).ok,'exchange accepted');
 ok(!s.prisoners.some(p=>(p.holder===1&&p.origin===0)||(p.holder===0&&p.origin===1)),'prisoners exchanged');
 // передача території
 const v=s.map.settlements[5];const giver=v.control;toPhase(s,giver);const recv=giver===1?2:1;
 const tr=Politics.propose(s,giver,recv,'territory',{settlement:5,giver});ok(tr.ok,'territory transfer proposed ('+v.name+')');
 toPhase(s,recv);ok(Politics.respond(s,tr.id,true).ok&&v.control===recv,'territory transferred');
}
// 5. гуманітарна допомога, ополчення
{const s=Engine.newGame(1999);const v=s.map.settlements[3];toPhase(s,0);
 const a0=Politics.support(v,0);const r=Politics.aid(s,0,3);ok(r.ok&&Politics.support(v,0)>a0,'aid raises support');
 for(const g of Politics.GROUPS)v.support[g][0]=80;const m=Politics.raiseMilitia(s,0,3);ok(m.ok&&Engine.unitById(s,m.unitId),'militia raised in loyal village');
}
// 6. саботаж і страйк
{const s=Engine.newGame(1999);const city=s.map.settlements[0];for(const g of Politics.GROUPS){city.support[g][0]=5;city.support[g][1]=70;}
 hours(s,8);ok(city.unrest==='strike'||city.unrest==='protest','unrest in hostile city: '+city.unrest);
 ok(s.log.some(e=>e.text.includes('саботаж')),'sabotage happened');}
// 7. кінець кампанії й хроніка — тепер лише за територією (всі пункти) або військовою перемогою,
// без лімітів по дню чи очках (запит гравця: «перемога — захоплення всіх сіл або здача противника»)
{const s=Engine.newGame(1999);
 // перевіряємо саму функцію перевірки перемоги напряму (без повної симуляції) — інакше звичний
 // перерахунок контролю гекса за утриманням (controlByHolding) одразу «відкотив» би ручну
 // розстановку контролю пунктів назад, бо юніти інших фракцій фізично стоять в інших місцях.
 for(const st of s.map.settlements) if(st.pop) st.control=0;
 Politics.checkCampaign(s);
 ok(s.campaign.over,'territorial victory (all settlements) ends the campaign: '+s.campaign.reason);
 ok(s.campaign.winner===0,'winner is the faction holding every settlement');
 ok(s.campaign.chronicle&&s.campaign.chronicle.towns.length===6&&s.campaign.chronicle.factions.length===3,'chronicle built');
 ok(!Engine.endPhase(s).ok,'no more phases after the end');
 const sc=Politics.scores(s);ok(sc.every(x=>x.total>=0&&x.total<=x.max),'scores still computed for the info panel (no longer decide the winner): '+sc.map(x=>x.total+'/'+x.max).join(', '));}
// 7б. перевищення endDay саме по собі більше НЕ закінчує кампанію (нема кому «за очками»
// перемагати) — усі фракції живі й нічия територія не захоплена повністю
{const s=Engine.newGame(1999);s.campaign.endDay=0;s.time.day=10;
 Politics.checkCampaign(s);
 ok(!s.campaign.over,'exceeding endDay alone no longer ends the campaign: '+s.campaign.reason);}
// 8. збереження
{const s=Engine.newGame(1999);hours(s,2);const t=SaveSystem.serialize(s);const b=SaveSystem.deserialize(t);ok(b.ok,'v6 save ok');
 Engine.endPhase(s);Engine.endPhase(b.state);ok(SaveSystem.serialize(s).replace(/"savedAt":\d+/,'')===SaveSystem.serialize(b.state).replace(/"savedAt":\d+/,''),'loaded game continues identically');
 const v5=JSON.parse(t);v5.version=5;delete v5.diplomacy;delete v5.events;delete v5.campaign;delete v5.stats;for(const x of v5.map.settlements){delete x.pop;delete x.support;}
 const m=SaveSystem.deserialize(JSON.stringify(v5));ok(m.ok&&m.state.diplomacy&&m.state.map.settlements[0].pop,'v5 save migrated');}
// 9. довга гра — тепер без лімітів по дню переможець не гарантований за 72 год, тож просто
// перевіряємо стабільність довгого прогону (і хроніку, якщо раптом хтось таки переміг)
{const s=Engine.newGame(1999);let attacks=0;
 for(let h=0;h<72*3&&!s.campaign.over;h++){const f=Engine.phaseFaction(s);
  for(const u of s.units.filter(x=>x.faction===f)){const vis=[...Intel.visibleIds(s,f)].map(id=>Engine.unitById(s,id)).filter(Boolean);let done=false;
   for(const e of vis){const r=Combat.attack(s,u.id,{unitId:e.id});if(r.ok){attacks++;done=true;break;}}
   if(!done&&!u.order&&Engine.canAct(u)&&u.embarked==null&&u.type!=='medevac')Engine.issueMoveOrder(s,u.id,s.map.settlements[0].center);}
  Engine.endPhase(s);}
 const c=s.campaign;
 ok(attacks>0,'72h sim ran and fought: attacks '+attacks+(c.over?' | ended: '+c.reason:' | still ongoing (no day/score limit anymore)'));
 const ch=c.over?c.chronicle:Politics.chronicle(s,Politics.scores(s));
 ok(ch&&ch.towns.every(t=>t.pop>=0),'chronicle towns: '+ch.towns.map(t=>t.name+' '+t.pop0+'→'+t.pop+' civ '+t.civKilled).join('; '));
 ok(SaveSystem.deserialize(SaveSystem.serialize(s)).ok,'save after full campaign');}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
