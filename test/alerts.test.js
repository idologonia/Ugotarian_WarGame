const L=require('./load.js')();
const {Engine,Intel,Politics,Combat,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};
const s=Engine.newGame(1999);s.campaign.disabled=true;toPhase(s,0);
const g=Engine.grid(s);
const mor=s.units.find(u=>u.faction===0&&u.type==='mortar');
// переставляємо міномет ближче до села — дальність міномета це налаштування балансу,
// тест не має залежати від того, чи саме його стартова позиція сценарію опиняється в зоні.
let villHex=-1;for(let i=0;i<g.size;i++){if(s.map.settlement[i]>0){villHex=i;break;}}
let near=-1;for(let i=0;i<g.size;i++){if(g.dist(i,villHex)<=8&&!s.units.some(u=>u.idx===i)&&Engine.hexPassable(s,'foot',i)&&s.map.settlement[i]<=0){near=i;break;}}
mor.idx=near;
if(!mor.deployed)Engine.deploy(s,mor.id);
Intel.update(s);
// ворожий підрозділ у селі в зоні міномета, видимий
const z=Combat.fireZone(s,mor);
const vil=[...z.hexes].find(i=>s.map.settlement[i]>0&&!s.units.some(u=>u.idx===i));
ok(vil!=null,'village hex in mortar range');
const e=s.units.find(u=>u.faction===2&&u.type==='inf_platoon');e.idx=vil;
const rec=s.units.find(u=>u.faction===0&&u.type==='recon');rec.idx=g.neighbor(vil,0)>=0&&!s.units.some(u=>u.idx===g.neighbor(vil,0))?g.neighbor(vil,0):g.neighbor(vil,3);
Intel.update(s);
ok(Intel.isVisible(s,0,e.id),'target visible');
const st=s.map.settlements[s.map.settlement[vil]];const sup0=Politics.support(st,0);
const logBefore=s.nextLogId;
let r;for(let k=0;k<6;k++){mor.attackedTurn=-1;mor.ammo.m81=40;s.time.turn+= (k?1:0);r=Combat.attack(s,mor.id,{hex:vil},'high');if(!r.ok){console.log(r.reason);break;}}console.log('civ',st.civKilled,st.civWounded,st.civAcc);
const fresh=s.log.filter(x=>x.id>=logBefore);
const hit=fresh.filter(x=>x.kind==='alert'&&x.vis&&x.vis.includes(2)&&/^ОБСТРІЛЯНО/.test(x.text));
ok(hit.length>0&&hit.every(x=>x.at!=null&&x.uid===e.id),'nat gets ОБСТРІЛЯНО alerts with location ('+hit.length+'): '+(hit[0]&&hit[0].text));
ok(!fresh.some(x=>x.kind==='alert'&&/^ОБСТРІЛЯНО/.test(x.text)&&x.vis.includes(0)),'shooter does not get the victim alert');
const supA=fresh.filter(x=>x.kind==='alert'&&/^ПІДТРИМКА/.test(x.text));
ok(supA.length>0&&supA.every(x=>x.vis.includes(0)&&x.at===vil),'soc gets support-drop alert: '+(supA[0]&&supA[0].text));
ok(Politics.support(st,0)<sup0,'soc support fell '+sup0+'→'+Politics.support(st,0));
ok((st.supLog||[]).some(x=>x.f===0&&x.d<0&&/обстріл/.test(x.why)),'support history records shelling');
const shot=fresh.filter(x=>x.kind==='combat'&&/^ОБСТРІЛ/.test(x.text));ok(shot.length&&shot[0].at===vil,'shooter log entry has location');
// пряма атака — тривога для оборони
const sq=s.units.find(u=>u.faction===0&&u.type==='inf_squad'&&u.embarked==null);
const d=s.units.find(u=>u.faction===1&&u.type==='inf_squad');
let adj=-1;for(let k=0;k<6;k++){const n=g.neighbor(sq.idx,k);if(n>=0&&!s.units.some(u=>u.idx===n)&&Engine.hexPassable(s,'foot',n)){adj=n;break;}}
d.idx=adj;Intel.update(s);s.time.turn++;sq.mp=Engine.mpMax(sq);sq.attackedTurn=-1;
const l2=s.nextLogId;const r2=Combat.attack(s,sq.id,{unitId:d.id});ok(r2.ok,'direct attack ok');
const a2=s.log.filter(x=>x.id>=l2&&x.kind==='alert'&&x.vis.includes(1));
const underFire=a2.filter(x=>/^ПІД ВОГНЕМ/.test(x.text));
ok(underFire.length===1&&underFire[0].uid===d.id,'defender alert: '+(underFire[0]&&underFire[0].text));
const b2=s.log.find(x=>x.id>=l2&&/^БІЙ/.test(x.text));ok(b2&&Array.isArray(b2.uid)&&b2.at===adj,'battle entry references both units and hex');
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
