const L=require('./load.js')();
const {Engine,Combat,Intel,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Користувач: «вогонь на придушення» — можна подавити вогнем ПРЯМОЇ зброї як ворогів, так і
// порожні/невідомі клітинки, де ворог МОЖЕ бути (а не лише навісною зброєю, як «вогонь по площі»).

function setup(){
  const s=Engine.newGame(1999); s.campaign.disabled=true; toPhase(s,0);
  const u=s.units.find(x=>x.faction===0 && !Combat.hasIndirect(x) && Object.keys(x.weapons||{}).length);
  return {s,u};
}
function emptyAdjHex(s,u){
  const g=Engine.grid(s);
  for (const i of g.within(u.idx,1)) {
    if (i===u.idx) continue;
    if (s.map.terrain[i]===L.TERRAIN_ID.sea) continue;
    if (Engine.unitsAt(s,i).length) continue;
    return i;
  }
  return -1;
}

// 1. звичайна атака прямою зброєю по порожньому/невідомому гексу — заборонена
{
  const {s,u}=setup();
  const hex=emptyAdjHex(s,u);
  ok(hex>=0,'found an empty adjacent hex');
  const pv=Combat.previewAttack(s,u.id,{hex},'normal',{});
  ok(!pv.ok,'direct fire at unknown empty hex refused without suppress: '+JSON.stringify(pv));
}

// 2. вогонь на придушення по тому самому гексу — дозволено, інтенсивність форсується на 'suppress'
{
  const {s,u}=setup();
  const hex=emptyAdjHex(s,u);
  const pv=Combat.previewAttack(s,u.id,{hex},'normal',{suppress:true});
  ok(pv.ok,'suppress fire at empty hex allowed: '+(pv.reason||''));
  ok(pv.intensity==='suppress','intensity forced to suppress: '+pv.intensity);
  ok(pv.area===true,'resolved as area target (no known contact)');
}

// 3. виконання: нікого в гексі нема -> боєприпаси витрачені, звіт kind='suppress', без бою
{
  const {s,u}=setup();
  const hex=emptyAdjHex(s,u);
  const money0=JSON.stringify(u.ammo);
  const r=Combat.attack(s,u.id,{hex},'normal',{suppress:true});
  ok(r.ok,'suppress attack executes: '+(r.reason||''));
  ok(r.report.kind==='suppress','report kind is suppress');
  ok(JSON.stringify(u.ammo)!==money0,'ammo was spent even though hex was empty');
}

// 4. якщо там справді є ворог (нехай і не виявлений заздалегідь) — придушення його зачіпає
{
  const {s,u}=setup();
  const hex=emptyAdjHex(s,u);
  const enemy=s.units.find(x=>x.faction!==0);
  enemy.idx=hex;
  const fitBefore=enemy.personnel.fit;
  const r=Combat.attack(s,u.id,{hex},'normal',{suppress:true});
  ok(r.ok,'suppress attack on occupied hex executes: '+(r.reason||''));
  ok(enemy.suppression>0||enemy.personnel.fit<fitBefore,'enemy actually present in the hex gets suppressed/hit by blind suppression fire');
}

// 5. вогонь на придушення по ВІДОМОМУ противнику теж працює (слаболетальна інтенсивність, не area)
{
  const {s,u}=setup();
  const g=Engine.grid(s);
  const enemy=s.units.find(x=>x.faction!==0);
  enemy.idx=g.neighbor(u.idx,0)>=0?g.neighbor(u.idx,0):u.idx;
  Intel.update(s);
  ok(Intel.isVisible(s,0,enemy.id),'enemy became visible after Intel.update');
  const pv=Combat.previewAttack(s,u.id,{hex:enemy.idx},'normal',{suppress:true});
  ok(pv.ok&&pv.targetUnit===enemy.id,'suppress fire resolves to the known enemy unit as a real target');
  ok(pv.area!==true,'not treated as blind area fire when the enemy is actually known');
  const r=Combat.attack(s,u.id,{hex:enemy.idx},'normal',{suppress:true});
  ok(r.ok&&r.report.kind==='direct','known-enemy suppress fire still runs as a normal direct exchange (defender returns fire)');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
