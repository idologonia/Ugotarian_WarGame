// Рішення (фокуси): ланцюжок об’єднання повстанців, амністія СВ і «зрада», ескалація РФ → відповідь НАТО,
// Predator через рішення, мобілізація діаспори.
const L=require('./load.js')();
const {Engine,Decisions,Politics,Foreign,Air,Logistics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{while(Engine.phaseFaction(s)!==f)Engine.endPhase(s);};
const hours=(s,n)=>{for(let i=0;i<n*3;i++)Engine.endPhase(s);};
const st=(s,f,id)=>Decisions.list(s,f).find(d=>d.id===id).status;
const respond=(s,to,type,acc)=>{toPhase(s,to);const p=s.diplomacy.proposals.find(x=>x.status==='open'&&x.to===to&&x.type===type);if(p)Politics.respond(s,p.id,acc);return p;};

// 1. Об’єднання повстанців
{
  const s=Engine.newGame(1999);s.campaign.disabled=true;
  toPhase(s,1);
  ok(st(s,1,'jointHQ')==='locked','«Спільний штаб» закрито до «Каналу зв’язку»');
  ok(Decisions.start(s,1,'contact').ok,'ДП розпочала «Канал зв’язку»');
  ok(!Decisions.start(s,1,'natoAir').ok,'одночасно лише одне рішення');
  hours(s,CONFIG.decisions.contact.hours+1);
  ok(st(s,1,'contact')==='done','«Канал зв’язку» виконано');
  const p=respond(s,2,'ceasefire',true);
  ok(p&&Politics.active(s,1,2,'ceasefire'),'НП прийняла перемир’я — угода діє');
  toPhase(s,1);
  ok(st(s,1,'jointHQ')==='available','«Спільний штаб» відкрито (перемир’я, СВ тримає понад половину)');
  const geo0=Foreign.geo(s,1);
  ok(Decisions.start(s,1,'jointHQ').ok,'ДП розпочала «Спільний штаб»');
  hours(s,CONFIG.decisions.jointHQ.hours+1);
  ok(Foreign.geo(s,1)<geo0,'НАТО не схвалює союзу з націоналістами (стосунки '+geo0+' → '+Foreign.geo(s,1)+')');
  respond(s,2,'alliance',true);
  ok(Politics.allied(s,1,2),'союз ДП і НП укладено');
  // бонус вогню
  const g=Engine.grid(s);const soc=s.units.find(u=>u.faction===0);const dp=s.units.find(u=>u.faction===1);const np=s.units.find(u=>u.faction===2);
  const np0=np.idx;np.idx=soc.idx;
  ok(Decisions.fireMult(s,dp,soc)>1,'союзник поруч із ціллю СВ — бонус вогню '+Decisions.fireMult(s,dp,soc));
  np.idx=g.idx(1,1);ok(Decisions.fireMult(s,dp,soc)===1,'союзника поруч немає — без бонусу');np.idx=np0;
  toPhase(s,1);
  ok(st(s,1,'unitedFront')==='locked','«Єдиний фронт» чекає 24 год союзу');
  hours(s,CONFIG.decisions.unitedFront.allianceHours);toPhase(s,1);
  ok(Decisions.start(s,1,'unitedFront').ok,'«Єдиний фронт» розпочато після 24 год союзу');
  const q0=Foreign.queue(s).filter(o=>o.kind==='volunteers').length;
  hours(s,CONFIG.decisions.unitedFront.hours+1);
  ok(Foreign.queue(s).filter(o=>o.kind==='volunteers').length+s.units.filter(u=>u.foreignKind==='volunteers').length>q0,'«Єдиний фронт»: добровольці обом сторонам');
}
// 2. Амністія СВ і зрада
{
  const s=Engine.newGame(1999);s.campaign.disabled=true;
  toPhase(s,0);
  ok(st(s,0,'amnesty1')==='locked','амністія закрита, поки СВ нічого не втратила');
  s.map.settlements[3].control=1;  // СВ втратила Село Г
  ok(Decisions.start(s,0,'amnesty1').ok,'СВ розпочала амністію для ДП');
  ok(st(s,0,'amnesty2')==='excluded','амністія для НП тепер виключена (обрано інший шлях)');
  // ДП і НП мають перемир’я — прийняття амністії буде зрадою
  Politics.rel(s,1,2).agreements.push({type:'ceasefire',from:1,to:2,terms:{},since:s.time.turn,until:s.time.turn+999});
  hours(s,CONFIG.decisions.amnesty.hours+1);
  const rep0=s.diplomacy.reputation[1];
  respond(s,1,'ceasefire',true);
  hours(s,1);
  ok(Politics.active(s,0,1,'ceasefire'),'ДП прийняла перемир’я з СВ');
  ok(s.diplomacy.reputation[1]<rep0,'НП вважає це зрадою: репутація ДП '+rep0+' → '+s.diplomacy.reputation[1]);
}
// 3. Ескалація: армія РФ → відповідь НАТО; Predator через рішення
{
  const s=Engine.newGame(1999);s.campaign.disabled=true;
  s.map.settlements[0].control=1;s.geo[0]=80;
  toPhase(s,0);
  const n0=s.units.filter(u=>u.faction===0).length,geo1=Foreign.geo(s,1);
  ok(Decisions.start(s,0,'russianArmy').ok,'СВ розпочала «Введення російської армії»');
  hours(s,CONFIG.decisions.russianArmy.hours+1);
  ok(s.units.filter(u=>u.faction===0).length===n0+CONFIG.decisions.russianArmy.units.length,'висадилась батальйонна група ('+CONFIG.decisions.russianArmy.units.length+' підрозділів)');
  ok(s.units.some(u=>u.foreignKind==='army'&&u.experience===2),'регулярна армія — досвідчена');
  ok(Foreign.geo(s,1)>=geo1+15||Foreign.geo(s,1)===100,'НАТО відповідає: стосунки ДП '+geo1+' → '+Foreign.geo(s,1));
  toPhase(s,1);
  ok(st(s,1,'westMission')==='available','ДП: «Західна місія» відкрита після введення армії РФ');
  ok(st(s,1,'natoAir')==='available','ДП: «Повітряна розвідка НАТО» відкрита (стосунки зросли)');
  ok(Decisions.start(s,1,'natoAir').ok,'ДП розпочала «Повітряну розвідку НАТО»');
  hours(s,CONFIG.decisions.natoAir.hours+1);
  ok(Air.uav(s,1).unlocked,'Predator отримано');
}
// 4. Мобілізація діаспори: половинний кулдаун добровольців
{
  const s=Engine.newGame(1999);s.campaign.disabled=true;
  for(const x of s.map.settlements) if(x.control===2&&x.pop) for(const g of Object.keys(x.pop)) Politics.adjustSupport(x,2,40,g,'тест',s);
  toPhase(s,2);
  const cd0=Foreign.volCooldownHours(s,2);
  ok(Decisions.start(s,2,'diasporaMob').ok,'НП розпочала «Мобілізацію діаспори»');
  hours(s,CONFIG.decisions.diasporaMob.hours+1);
  ok(Foreign.volCooldownHours(s,2)<cd0,'кулдаун заклику добровольців менший ('+cd0+' → '+Foreign.volCooldownHours(s,2)+')');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
