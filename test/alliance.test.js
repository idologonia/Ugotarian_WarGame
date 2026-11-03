const L=require('./load.js')();
const {Engine,Intel,Politics,Scenario}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const s=Engine.newGame(1999);s.campaign.disabled=true;toPhase(s,1);
const nat=s.units.filter(u=>u.faction===2), dem=s.units.filter(u=>u.faction===1);
ok(!Intel.isVisible(s,1,nat[0].id),'before alliance: nat units hidden from dem');
const p=Politics.propose(s,1,2,'ceasefire');Engine.endPhase(s);Politics.respond(s,p.id,true);
const a=Politics.propose(s,2,1,'alliance');toPhase(s,1);Politics.respond(s,a.id,true);Intel.update(s);
ok(Politics.allied(s,1,2),'alliance concluded');
ok(nat.every(u=>Intel.isVisible(s,1,u.id)),'dem sees all nat units ('+nat.length+')');
ok(dem.every(u=>Intel.isVisible(s,2,u.id)),'nat sees all dem units');
const rec=Intel.knownList(s,1,{allies:true});ok(rec.length===nat.filter(u=>u.embarked==null).length&&rec.every(r=>r.type&&r.fit!=null),'allied records fully identified');
ok(Intel.knownList(s,1).every(r=>!Politics.allied(s,1,r.faction)),'allies not listed as enemy intel');
// союзник бачить противника — і я теж
const g=Engine.grid(s);const soc=s.units.find(u=>u.faction===0&&u.type==='recon');const n=nat[0];
soc.idx=g.neighbor(n.idx,0)>=0&&!s.units.some(u=>u.idx===g.neighbor(n.idx,0))?g.neighbor(n.idx,0):g.neighbor(n.idx,3);Intel.update(s);
ok(Intel.isVisible(s,2,soc.id)&&Intel.isVisible(s,1,soc.id),'enemy spotted by ally is visible to me');
// рух поруч із союзником не зупиняє
const d=dem.find(u=>u.type==='inf_squad');const tgt=n.idx;const r=Engine.issueMoveOrder(s,d.id,g.neighbor(tgt,1)>=0?g.neighbor(tgt,1):g.neighbor(tgt,2));
ok(!r.result||!(r.result.contact||[]).some(e=>e.faction===2),'moving next to ally is not a contact');
// розрив союзу — партнер зникає
Politics.dissolveAlliance(s,1,2);Intel.update(s);ok(!nat.every(u=>Intel.isVisible(s,1,u.id)),'after breaking alliance, partner units hidden again');
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
