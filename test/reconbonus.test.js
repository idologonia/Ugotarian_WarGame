const L=require('./load.js')();
const {Engine,Intel,Field,Logistics,CONFIG,TERRAIN_ID}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const toPhase=(s,f)=>{let k=0;while(Engine.phaseFaction(s)!==f&&k++<5)Engine.endPhase(s);};

// Запит гравця: розвідку, що стоїть у стійці «Розвідка» в укритті (без руху цієї години),
// бачити далі; бінокль додає дальність незалежно від місцевості.

// 1. прихований спостережний пункт: укриття + стійка «Розвідка» + без руху цієї години -> бонус
{
  const s=Engine.newGame(1999); const g=Engine.grid(s);
  const u=s.units.find(x=>x.faction===0&&x.type==='recon');
  u.stance='none';
  const base=Intel.observeRange(s,u);
  // знайдемо гекс з укриттям (concealment>0) поруч, де нема інших підрозділів/річки
  let forestIdx=-1;
  for(let i=0;i<s.map.terrain.length;i++){
    const key=Object.keys(TERRAIN_ID).find(k=>TERRAIN_ID[k]===s.map.terrain[i]);
    if((CONFIG.detection.concealment[key]||0)>0 && !s.units.some(x=>x.idx===i)){ forestIdx=i; break; }
  }
  ok(forestIdx>=0,'found a hex with natural concealment');
  u.idx=forestIdx; u.stance='observe'; u.movedTurn=-999;
  const withCover=Intel.observeRange(s,u);
  ok(withCover>base,'stationary recon in cover + observe stance sees further than baseline: '+base+' -> '+withCover);
  // той самий гекс, але щойно рухався цієї години -> бонусу укриття немає (лишається observeBonus)
  u.movedTurn=s.time.turn;
  const justMoved=Intel.observeRange(s,u);
  ok(justMoved<withCover,'cover bonus does not apply the same hour the unit moved: '+justMoved+' < '+withCover);
}

// 2. бінокль: лише розвідка, додає дальність, видається зі складу/вантажу поруч
{
  const s=Engine.newGame(1999); toPhase(s,0);
  const u=s.units.find(x=>x.faction===0&&x.type==='recon');
  const notRecon=s.units.find(x=>x.faction===0&&x.type==='mg_team');
  ok(!!Field.issueBinocularsReason(s,notRecon),'non-recon unit cannot get binoculars: '+Field.issueBinocularsReason(s,notRecon));
  const store=Logistics.facilities(s).find(x=>Logistics.isStore(x)&&x.owner===0&&!x.destroyed);
  store.stock.goods.bino=2;
  // пересунемо розвідку до складу (в радіус постачання — findGoods теж бачить мережу постачання,
  // але найпростіше — впритул)
  u.idx=store.idx; u.movedThisPhase=false; u.mp=16;
  const before=Intel.observeRange(s,u);
  const r=Field.issueBinoculars(s,u.id);
  ok(r.ok,'binoculars issued to recon from nearby store: '+(r.reason||''));
  ok(u.binoculars===true,'unit now flagged as having binoculars');
  const after=Intel.observeRange(s,u);
  ok(after>before,'observe range increased after getting binoculars: '+before+' -> '+after);
  const r2=Field.issueBinoculars(s,u.id);
  ok(!r2.ok,'cannot issue binoculars twice: '+r2.reason);
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
