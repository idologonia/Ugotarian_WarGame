const L=require('./load.js')();
const {Engine,Scenario,Combat,Intel,Logistics,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const g0=s=>Engine.grid(s);

// Запит гравця: РЕР — «лише натяк на рух, не позицію», окремий підрозділ, навмисно «слабкий».

// 0. кожна фракція стартує з одним підрозділом РЕР
{
  const s=Engine.newGame(2024);
  for(let f=0;f<3;f++){
    const n=s.units.filter(u=>u.faction===f&&u.type==='ew_team').length;
    ok(n===1,'faction '+f+' starts with exactly one ew_team: '+n);
  }
  ok(CONFIG.recruitment.types.includes('ew_team'),'ew_team is a normally recruitable unit (not PMC-exclusive)');
}

// 1. мовчазний/нерухомий ворог для РЕР «невидимий»: не ставить інтел-маркер
{
  const s=Engine.newGame(2024); const g=g0(s);
  const stn=s.units.find(u=>u.faction===0&&u.type==='ew_team');
  const tgt=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
  const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
  let placed=false;
  for(let i=0;i<g.size && !placed;i++){
    if(g.dist(stn.idx,i)>5 && g.dist(stn.idx,i)<=rangeHex && Engine.hexPassable(s,'foot',i) && s.map.control[i]!==0){ tgt.idx=i; placed=true; }
  }
  ok(placed,'found a hex in EW range but outside normal observation for the test');
  tgt.movedTurn=-999; tgt.firedTurn=-999;
  stn.ewLast=null; stn.stance='observe';
  Intel.update(s);
  ok(!s.intel || !s.intel[0] || !s.intel[0][tgt.id] || !s.intel[0][tgt.id].ew,'stationary/silent enemy is not revealed by EW');
}

// 1b. запит гравця: РЕР пінгує лише коли сам у стійці «розвідка» — навіть активна ціль у
//     межах дальності лишається непоміченою, якщо станцію не поставлено в режим сканування
{
  const s=Engine.newGame(2024); const g=g0(s);
  const stn=s.units.find(u=>u.faction===0&&u.type==='ew_team');
  const tgt=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
  const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
  let placed=false;
  for(let i=0;i<g.size && !placed;i++){
    if(g.dist(stn.idx,i)>5 && g.dist(stn.idx,i)<=rangeHex && Engine.hexPassable(s,'foot',i) && s.map.control[i]!==0){ tgt.idx=i; placed=true; }
  }
  ok(placed,'found a hex in EW range for the test');
  tgt.movedTurn=s.time.turn; stn.ewLast=null; stn.stance='none';
  Intel.update(s);
  ok(!s.intel[0][tgt.id] || !s.intel[0][tgt.id].ew,'EW station not set to "розвідка" stance does not scan at all, even against an active target');
}

// 2. активний (рухомий цієї години) ворог у межах дальності — РЕР видає приблизну позицію,
//    але НЕ тип/чисельність
{
  const s=Engine.newGame(2024); const g=g0(s);
  const stn=s.units.find(u=>u.faction===0&&u.type==='ew_team');
  const tgt=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
  // розвести так, щоб вони НЕ бачили один одного звичайним способом, але в межах дальності РЕР
  const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
  let placed=false;
  for(let i=0;i<g.size && !placed;i++){
    if(g.dist(stn.idx,i)>5 && g.dist(stn.idx,i)<=rangeHex && Engine.hexPassable(s,'foot',i) && s.map.control[i]!==0){ tgt.idx=i; placed=true; }
  }
  ok(placed,'found a hex in EW range but outside normal observation for the test');
  tgt.movedTurn=s.time.turn; stn.ewLast=null; stn.stance='observe';
  Intel.update(s);
  const m=s.intel[0][tgt.id];
  ok(!!m,'moving enemy within EW range gets an intel marker');
  ok(m.ew===true,'marker is flagged as coming from EW');
  ok(m.type==null,'EW ping does not reveal unit type');
  ok(typeof m.idx==='number' && m.idx>=0,'EW position is a valid (fuzzed) hex: '+m.idx);
}

// 3. поза дальністю — ніякого пінгу
{
  const s=Engine.newGame(2024); const g=g0(s);
  const stn=s.units.find(u=>u.faction===0&&u.type==='ew_team');
  const tgt=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
  const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
  let placed=false;
  for(let i=0;i<g.size && !placed;i++){ if(g.dist(stn.idx,i)>rangeHex+3 && Engine.hexPassable(s,'foot',i)){ tgt.idx=i; placed=true; } }
  ok(placed,'found a hex outside EW range for the test');
  tgt.movedTurn=s.time.turn; stn.ewLast=null; stn.stance='observe';
  Intel.update(s);
  ok(!s.intel[0][tgt.id] || !s.intel[0][tgt.id].ew,'enemy out of EW range is not detected by EW');
}

// 4. кулдаун: одразу після вдалого пеленгу станція не пінгує знову, доки не минуло cooldownHours
{
  const s=Engine.newGame(2024); const g=g0(s);
  const stn=s.units.find(u=>u.faction===0&&u.type==='ew_team');
  const a=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
  const b=s.units.find(u=>u.faction===1&&u.type==='inf_platoon');
  const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
  const spots=[];
  for(let i=0;i<g.size && spots.length<2;i++){ if(g.dist(stn.idx,i)>5 && g.dist(stn.idx,i)<=rangeHex && Engine.hexPassable(s,'foot',i) && s.map.control[i]!==0) spots.push(i); }
  ok(spots.length===2,'found two distinct in-range spots for the test');
  a.idx=spots[0]; b.idx=spots[1];
  a.movedTurn=s.time.turn; b.movedTurn=s.time.turn;
  stn.ewLast=null; stn.stance='observe';
  Intel.update(s);
  const firstHit=(s.intel[0][a.id]&&s.intel[0][a.id].ew)?a.id:((s.intel[0][b.id]&&s.intel[0][b.id].ew)?b.id:null);
  ok(firstHit!=null,'EW detects exactly one of the two active targets on this scan');
  const otherId=firstHit===a.id?b.id:a.id;
  ok(!s.intel[0][otherId]||!s.intel[0][otherId].ew,'the other active target is NOT also revealed in the same scan (one target per scan)');
  ok(stn.ewLast===s.time.turn,'station records the turn of its successful ping');
  // одразу наступного «пінгу» (той самий turn) — кулдаун не дає повторного виявлення нової цілі
  delete s.intel[0][a.id]; delete s.intel[0][b.id];
  Intel.update(s);
  ok(!s.intel[0][a.id] && !s.intel[0][b.id],'station on cooldown does not detect again this same turn');
}

// 5. раніше впізнаний тип не «забувається» (стирається) новим пінгом РЕР
{
  const s=Engine.newGame(2024); const g=g0(s);
  const stn=s.units.find(u=>u.faction===0&&u.type==='ew_team');
  const tgt=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
  if(!s.intel) s.intel=[{},{},{}];
  if(!s.intel[0]) s.intel[0]={};
  s.intel[0][tgt.id]={id:tgt.id,faction:1,idx:tgt.idx,day:s.time.day,hour:s.time.hour,turn:s.time.turn,cls:'foot',type:'inf_squad',label:'Піхотне відділення (впізнано раніше)',fit:5,approx:null,dist:0};
  const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
  let placed=false;
  for(let i=0;i<g.size && !placed;i++){ if(g.dist(stn.idx,i)>5 && g.dist(stn.idx,i)<=rangeHex && Engine.hexPassable(s,'foot',i) && s.map.control[i]!==0){ tgt.idx=i; placed=true; } }
  tgt.movedTurn=s.time.turn; stn.ewLast=null; stn.stance='observe';
  Intel.update(s);
  const m=s.intel[0][tgt.id];
  ok(!!m,'target still has an intel marker after EW re-ping');
  ok(m.type==='inf_squad','previously identified type is preserved, not erased by a weaker EW ping: '+m.type);
}

// 6. похибка позиції росте з дистанцією (далека ціль у середньому дає більше відхилення, ніж близька)
{
  const dev=(seed,dist)=>{
    const s=Engine.newGame(seed); const g=g0(s);
    const stn=s.units.find(u=>u.faction===0&&u.type==='ew_team');
    const tgt=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
    const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
    let placed=false;
    for(let i=0;i<g.size && !placed;i++){ const d=g.dist(stn.idx,i); if(d>=dist-1 && d<=dist+1 && d<=rangeHex && Engine.hexPassable(s,'foot',i)){ tgt.idx=i; placed=true; } }
    if(!placed) return null;
    tgt.movedTurn=s.time.turn; stn.ewLast=null; stn.stance='observe';
    Intel.update(s);
    const m=s.intel[0][tgt.id];
    if(!m||!m.ew) return null;
    return g.dist(m.idx,tgt.idx);
  };
  const rangeHex=Math.floor(CONFIG.ew.range/CONFIG.hexMeters);
  let nearSum=0,nearN=0,farSum=0,farN=0;
  for(let seed=1;seed<=25;seed++){
    const dn=dev(seed,6); if(dn!=null){nearSum+=dn;nearN++;}
    const df=dev(seed,Math.max(4,rangeHex-2)); if(df!=null){farSum+=df;farN++;}
  }
  ok(nearN>3&&farN>3,'collected enough near/far samples: '+nearN+'/'+farN);
  const nearAvg=nearSum/Math.max(1,nearN), farAvg=farSum/Math.max(1,farN);
  ok(farAvg>nearAvg,'average position error is larger for far targets than near ones: '+farAvg.toFixed(2)+' vs '+nearAvg.toFixed(2));
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
