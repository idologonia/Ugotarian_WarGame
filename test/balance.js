const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,CONFIG,TERRAIN_ID}=L;
function duel(ta,tb,{terrA='plain',terrB='plain',dist=1,fortB=0,stanceB='none',ambush=false,intensity='normal',hours=4,expA=null,expB=null,quiet=false}={}){
  const s=Engine.newGame(7);
  const g=Engine.grid(s);
  // flatten area
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;}
  s.units=[];
  const aIdx=g.idx(20,30); // along column direction: find hex at distance dist
  let bIdx=-1;for(let c=21;c<40;c++){const i=g.idx(c,30);if(g.dist(aIdx,i)===dist){bIdx=i;break;}}
  s.map.terrain[aIdx]=TERRAIN_ID[terrA]; s.map.terrain[bIdx]=TERRAIN_ID[terrB];
  const A=Scenario.createUnit(s,ta,0,aIdx,1), B=Scenario.createUnit(s,tb,1,bIdx,1);
  if(expA!=null)A.experience=expA; if(expB!=null)B.experience=expB;
  B.fort=fortB;B.stance=stanceB; s.units=[A,B];
  if(Combat.hasIndirect(A)){ let o=-1; for(let d=0;d<6;d++){const n=g.neighbor(bIdx,d); if(n>=0 && g.dist(n,aIdx)<dist){o=n;break;}} const O=Scenario.createUnit(s,'recon',0,o,9); s.units.push(O);} s.phase=0; s.intel=[{},{},{}];s.campaign.disabled=true;
  Intel.update(s);
  if(!ambush && !Intel.isVisible(s,1,A.id)){ // force defender awareness
    s.intel[1][A.id]={id:A.id,idx:A.idx,turn:s.time.turn};  // known but needs visible: emulate by observe
  }
  const out=[];
  for(let h=0;h<hours;h++){
    s.phase=0;A.mp=Engine.mpMax(A);A.movedThisPhase=false;
    if(!s.units.includes(A)||!s.units.includes(B))break;
    let r;
    if(Combat.hasIndirect(A)) r=Combat.attack(s,A.id,{hex:B.idx},intensity);
    else r=Combat.attack(s,A.id,{unitId:B.id},intensity);
    if(!r.ok){out.push('h'+(h+1)+' FAIL '+r.reason);break;}
    const R=r.report.result||{};
    out.push(`h${h+1}: A ${A.personnel.fit}/${A.personnel.assigned} m${A.morale} s${Math.round(A.suppression)}${A.vehicle?' c'+A.vehicle.condition:''} | B ${B.personnel.fit}/${B.personnel.assigned} m${B.morale} s${Math.round(B.suppression)}${B.vehicle?' c'+B.vehicle.condition:''} ${R.attacker||''}/${R.defender||''} ammoA ${JSON.stringify(A.ammo)}`);
    if(R.defender&&R.defender!=='held')break;
    if(R.attacker&&R.attacker!=='held')break;
    // hour passes: suppression decay
    for(const u of [A,B]){u.suppression=Math.max(0,u.suppression-CONFIG.combat.suppressionDecayPerHour);}
    s.time.turn++;
    // keep adjacency: if B retreated, stop
    Intel.update(s);
    if(!Intel.isVisible(s,0,B.id)){out.push('B out of sight');break;}
  }
  return out;
}
const cases=[
 ['Відд vs відд, рівнина, 250м','inf_squad','inf_squad',{}],
 ['Взвод vs відд, рівнина','inf_platoon','inf_squad',{}],
 ['Відд vs взвод, рівнина','inf_squad','inf_platoon',{}],
 ['Взвод vs відд у лісі','inf_platoon','inf_squad',{terrB:'forest'}],
 ['Взвод vs відд у місті, окопи 2','inf_platoon','inf_squad',{terrB:'city',fortB:2,stanceB:'defend'}],
 ['Взвод vs взвод рівнина','inf_platoon','inf_platoon',{}],
 ['Взвод vs взвод, засідка з густого лісу 500м','inf_platoon','inf_platoon',{ambush:true,terrA:'denseForest',dist:2}],
 ['Взвод vs взвод, без засідки 500м','inf_platoon','inf_platoon',{dist:2}],
 ['Кулемет vs відд 750м','mg_team','inf_squad',{dist:3}],
 ['Кулемет vs відд 250м шквал','mg_team','inf_squad',{intensity:'high'}],
 ['Гранатометники vs МТ-ЛБ','at_team','veh_mtlb',{}],
 ['Відд vs МТ-ЛБ','inf_squad','veh_mtlb',{}],
 ['МТ-ЛБ vs відд','veh_mtlb','inf_squad',{}],
 ['Гранатометники vs УАЗ','at_team','veh_uaz',{}],
 ['Взвод vs УАЗ','inf_platoon','veh_uaz',{}],
 ['Міномет vs відд 1.5км','mortar','inf_squad',{dist:6}],
 ['Міномет vs взвод у лісі','mortar','inf_platoon',{dist:6,terrB:'forest'}],
 ['Міномет vs відд в окопах','mortar','inf_squad',{dist:6,fortB:2,stanceB:'defend'}],
 ['Снайпер-розвідка vs відд 500м','recon','inf_squad',{dist:2}],
];
for(const [n,a,b,o] of cases){console.log('\n== '+n);for(const l of duel(a,b,o))console.log('  '+l);}
