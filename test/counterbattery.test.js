const L=require('./load.js')();
const {Engine,Intel,Combat,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const s=Engine.newGame(21);s.campaign.disabled=true;
const g=Engine.grid(s);
const mor=s.units.find(u=>u.faction===0&&u.type==='mortar');
if(!mor.deployed)Engine.deploy(s,mor.id);
const z=Combat.fireZone(s,mor);
const hex=[...z.hexes].find(i=>g.dist(i,mor.idx)>3&&!s.units.some(u=>u.idx===i));
const victim=s.units.find(u=>u.faction===1&&u.type==='inf_platoon');
victim.idx=hex;
Intel.update(s);

ok(!Intel.isVisible(s,1,mor.id),'dem does not see the mortar before any strike');

// 1-й виклик поспіль — ще просто пристрілка, рано для контрбатарейного виявлення
mor.ammo.m81=40;
let r=Combat.attack(s,mor.id,{hex},'high');
ok(r.ok&&victim.lastLoss>0,'1st barrage lands and actually hits someone');
let m=Intel.ensure(s)[1][mor.id];
ok(!m||!m.sound,'no counter-battery lead yet after just 1 strike: '+JSON.stringify(m));

// 2-й виклик поспіль (та сама позиція, той самий гекс) — має спрацювати контрбатарея
s.time.turn++; mor.attackedTurn=-1; mor.ammo.m81=40;
r=Combat.attack(s,mor.id,{hex},'high');
ok(r.ok&&victim.lastLoss>0,'2nd consecutive barrage lands and hits again');
m=Intel.ensure(s)[1][mor.id];
ok(m&&m.sound,'counter-battery lead appears after 2nd consecutive strike: '+JSON.stringify(m));
ok(m&&m.type===null,'lead is unidentified (no exact type revealed)');
const err=g.dist(m.idx,mor.idx);
ok(err<=Math.ceil(g.dist(hex,mor.idx)*CONFIG.combat.counterBattery.distanceErrorShare)+1,'position guess error is within the configured bound: off by '+err+' hex');
ok(Intel.knownList(s,1).some(x=>x.id===mor.id&&x.sound),'the lead shows up in the dem faction known-enemies list');

// якщо позицію реально помітили — звичайна видимість переважає над звуковим здогадом
const scout=L.Scenario.createUnit(s,'recon',1,mor.idx,9); s.units.push(scout);
Intel.update(s);
s.time.turn++; mor.attackedTurn=-1; mor.ammo.m81=40;
r=Combat.attack(s,mor.id,{hex},'high');
m=Intel.ensure(s)[1][mor.id];
ok(m&&m.idx===mor.idx&&!m.sound,'once genuinely spotted, the real identified position overrides the sound-only guess: '+JSON.stringify(m));

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
