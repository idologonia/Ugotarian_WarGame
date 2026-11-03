const L=require('./load.js')();
const {Engine,Combat,Intel,Scenario,CONFIG,TERRAIN_ID,Hex}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
function blank(){const s=Engine.newGame(7);const g=Engine.grid(s);for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=-1;}s.units=[];s.intel=[{},{},{}];s.campaign.disabled=true;s.facilities=[];s.caches={};s.phase=0;return {s,g};}
// дорога на захід (тил), ворог на сході, свої на заході
{const {s,g}=blank();const row=20;
 for(let c=5;c<30;c++){const i=g.idx(c,row),j=g.idx(c+1,row);s.map.road[i]=2;s.map.road[j]=2;const d=g.dirTo(i,j);s.map.roadDirs[i]|=1<<d;s.map.roadDirs[j]|=1<<Hex.opposite(d);}
 for(let c=0;c<20;c++)for(let r=0;r<60;r++)s.map.control[g.idx(c,r)]=0;
 const u=Scenario.createUnit(s,'inf_squad',0,g.idx(25,row),1),friend=Scenario.createUnit(s,'inf_platoon',0,g.idx(8,row),1),e=Scenario.createUnit(s,'inf_platoon',1,g.idx(26,row),1);
 s.units=[u,friend,e];Intel.update(s);
 const r=Combat.findRetreatHex(s,u,e.idx,0.4);
 ok(r.idx>=0&&g.col(r.idx)<25,'forced retreat goes west (rear): '+g.label(r.idx));
 ok(r.path.filter(i=>s.map.road[i]).length>=r.path.length-1,'mostly by road ('+r.path.length+' hexes)');
 ok(g.dist(r.idx,e.idx)>=6,'gets well away along the road (dist '+g.dist(r.idx,e.idx)+')');
 const sug=Engine.suggestRetreat(s,u.id);ok(sug!=null&&g.col(sug)<g.col(r.idx),'voluntary retreat suggests further rear: '+g.label(sug));
 const pv=Engine.previewMove(s,u.id,sug,'retreat');ok(pv.ok&&pv.hours===1,'suggested retreat fits in one hour');
}
// без дороги, але свої на півночі
{const {s,g}=blank();const u=Scenario.createUnit(s,'inf_squad',0,g.idx(30,30),1),fr=Scenario.createUnit(s,'inf_squad',0,g.idx(30,15),1),e=Scenario.createUnit(s,'inf_squad',1,g.idx(30,32),1);s.units=[u,fr,e];Intel.update(s);
 const r=Combat.findRetreatHex(s,u,e.idx,0.4);ok(r.idx>=0&&g.row(r.idx)<30,'retreats away from enemy toward friends (north): '+g.label(r.idx));}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
