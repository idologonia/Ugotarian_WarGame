const L=require('./load.js')();
const {Engine,Logistics,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const s=Engine.newGame(7);const g=Engine.grid(s);
for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
const dep=g.idx(40,30);
// дорога вздовж одного напрямку (слідуємо фактичним сусідам, щоб уникнути краю карти)
let cur=dep,dir=0;const road=[cur];
for(let k=0;k<25;k++){const n=g.neighbor(cur,dir);if(n<0)break;s.map.road[n]=2;s.map.roadDirs[cur]|=(1<<dir);s.map.roadDirs[n]|=(1<<((dir+3)%6));cur=n;road.push(cur);}
// чисте поле в іншому напрямку (без дороги)
let f=dep;const field=[f];
for(let k=0;k<16;k++){const n=g.neighbor(f,2);if(n<0)break;f=n;field.push(f);}
s.facilities=[{id:0,type:'depot',idx:dep,owner:0,condition:100,destroyed:false,offline:0,stock:{ammo:{},weapons:{},goods:{}}}];
s.units=[];
const net=Logistics.network(s,0);
ok(net.dist[road[10]]>=0,'10 hex along road: in supply (cost '+net.dist[road[10]]+')');
ok(net.dist[road[13]]>=0&&net.dist[road[14]]<0,'13 hex along road still in supply, 14 hex is beyond the cost budget (cost@13 '+net.dist[road[13]]+')');
ok(net.dist[field[3]]>=0&&net.dist[field[4]]<0,'3 hex across open field: in supply, 4 hex is already out (cost@3 '+net.dist[field[3]]+') — reach off-road shrunk on purpose');
ok(net.dist[field[15]]<0,'15 hex across open field: OUT of supply (no road)');
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
