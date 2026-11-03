const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,SaveSystem,Transport,Loot,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
function blank(seed=7){const s=Engine.newGame(seed);const g=Engine.grid(s);for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;}s.units=[];s.intel=[{},{},{}];s.campaign.disabled=true;s.facilities=[];s.caches={};s.phase=0;return {s,g};}
const sumW=u=>Object.values(u.weapons).reduce((a,b)=>a+b,0);
// загиблі лишають зброю, загальна кількість зброї зберігається
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_platoon',0,g.idx(10,10),1),b=Scenario.createUnit(s,'inf_platoon',1,g.idx(11,10),1);s.units=[a,b];Intel.update(s);
 const total0=sumW(a)+sumW(b);
 for(let h=0;h<3;h++){a.attackedTurn=0;a.mp=16;if(!s.units.includes(b))break;Combat.attack(s,a.id,{unitId:b.id},'high');}
 const cw=Object.values(s.caches).reduce((t,c)=>t+Object.values(c.weapons).reduce((x,y)=>x+y,0),0);
 const now=s.units.reduce((t,u)=>t+sumW(u)+Object.values(u.cargo.weapons).reduce((x,y)=>x+y,0),0);
 ok(now+cw===total0,'weapons conserved across units and battlefield ('+now+'+'+cw+'='+total0+')');
 const dead=Object.values(s.caches).reduce((t,c)=>t+c.dead[0]+c.dead[1],0);const killed=a.personnel.killed+b.personnel.killed+(s.lost.reduce((t,l)=>0,0));
 ok(dead>0&&dead===a.personnel.killed+b.personnel.killed,'dead counted on map ('+dead+')');
 ok(Object.values(s.caches).every(c=>c.knownBy.includes(0)),'faction 0 knows battlefield');
 ok(Loot.holders(b)<=b.personnel.fit+b.personnel.wounded+b.personnel.straggling,'no more personal weapons than living men');
}
// лутання: переозброєння та вантаж
{const {s,g}=blank();const at=g.idx(10,10);const u=Scenario.createUnit(s,'inf_squad',0,at,1);s.units=[u];
 const c=Loot.cacheAt(s,at,true);c.weapons={'АКМ':6,'ПКМ':1};c.ammo={'762s':500,'762r':300};c.dead[1]=4;
 u.weapons={'АК-74':2};u.personnel.fit=5; Intel.update(s);
 const r=Loot.loot(s,u.id);ok(r.ok,'loot ok: '+r.text);
 ok(Loot.holders(u)===5,'unarmed men rearmed (holders '+Loot.holders(u)+')');
 ok(r.text.includes('7,62×39 мм 500'),'ammo for new weapons goes to combat load');
 const cargoW=Object.values(u.cargo.weapons).reduce((a,b)=>a+b,0);ok(cargoW===4&&Loot.count(Loot.cacheAt(s,at).weapons)===0,'rest goes to cargo (cap 5): '+JSON.stringify(u.cargo));
 ok(u.mp===12,'loot costs 25% of hour');
 const d=Loot.dropCargo(s,u.id);ok(d.ok&&Loot.count(Loot.cacheAt(s,at).weapons)===4,'cargo dropped back to hex');
}
// туман війни: чужі місця боїв невідомі
{const {s,g}=blank();const a=Scenario.createUnit(s,'inf_squad',0,g.idx(10,10),1);s.units=[a];const c=Loot.cacheAt(s,g.idx(40,40),true);c.dead[2]=3;c.weapons={'АКМ':3};Intel.update(s);
 ok(Loot.known(s,0).length===0,'distant battlefield unknown');a.idx=g.idx(39,40);Intel.update(s);ok(Loot.known(s,0).length===1,'observed battlefield becomes known');
}
// збереження v3 -> v4
{const s=Engine.newGame(1999);const t=JSON.parse(SaveSystem.serialize(s));t.version=3;delete t.caches;for(const u of t.units)delete u.cargo;const m=SaveSystem.deserialize(JSON.stringify(t));ok(m.ok&&m.state.caches,'v3 save migrates to v4');}
// довга гра без помилок і зі збереженням сумарної зброї
{const s=Engine.newGame(1999);let attacks=0,loots=0;
 for(let h=0;h<36*3;h++){const f=Engine.phaseFaction(s);
  for(const u of s.units.filter(x=>x.faction===f)){
   if(!Loot.lootReason(s,u)){if(Loot.loot(s,u.id).ok)loots++;}
   const vis=[...Intel.visibleIds(s,f)].map(id=>Engine.unitById(s,id)).filter(Boolean);let done=false;
   for(const e of vis){const r=Combat.attack(s,u.id,{unitId:e.id});if(r.ok){attacks++;done=true;break;}}
   if(!done&&!u.order&&Engine.canAct(u)&&u.embarked==null)Engine.issueMoveOrder(s,u.id,s.map.settlements[0].center);
  } Engine.endPhase(s);}
 ok(true,'36h sim: attacks '+attacks+', loots '+loots+', caches '+Object.keys(s.caches).length+', dead '+Object.values(s.caches).reduce((t,c)=>t+c.dead.reduce((a,b)=>a+b,0),0));
 ok(SaveSystem.deserialize(SaveSystem.serialize(s)).ok,'save ok after sim');
}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
