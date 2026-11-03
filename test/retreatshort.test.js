const L=require('./load.js')();
const {Engine,Scenario,Intel,Combat,TERRAIN_ID,CONFIG}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Користувач: вимушений відступ мав бути коротким ривком (рівно 1 гекс), а не маршем у тил; і
// стійкість підрозділу до відступу має залежати від бойового досвіду (новобранці ламаються
// за середньої моралі, регулярні — за низької, ветерани — лише за дуже низької). Також хоче
// окреме сповіщення гравцю про відступ з позиції.
// Рішення автора (за відгуком гравця): пороги moraleOutcome знижено (retreatBelow 40→25,
// disperseBelow 20→12, surrenderBelow 10→6) — підрозділи тримаються довше, відступають лише
// за дійсно низької моралі. Атака тут іде на «шквальній» інтенсивності, щоб надійно пробити
// нові, нижчі пороги в обох сценаріях (новобранець/ветеран) з тим самим вихідним боєм.
const disperseBelow0 = Math.round(CONFIG.combat.disperseBelow * CONFIG.combat.experienceResolve[0]);
const retreatBelow3 = Math.round(CONFIG.combat.retreatBelow * CONFIG.combat.experienceResolve[3]);
function blank(seed=17){
  const s=Engine.newGame(seed);s.campaign.disabled=true;const g=Engine.grid(s);
  for(let i=0;i<g.size;i++){s.map.terrain[i]=TERRAIN_ID.plain;s.map.river[i]=0;s.map.bridge[i]=0;s.map.road[i]=0;s.map.roadDirs[i]=0;s.map.control[i]=0;s.map.settlement[i]=-1;}
  s.units=[]; s.intel=[{},{},{}];
  return {s,g};
}
function run(experience){
  const {s,g}=blank();
  const d=Scenario.createUnit(s,'inf_platoon',1,g.idx(20,20),9);
  const a=Scenario.createUnit(s,'inf_platoon',0,g.idx(22,20),9);
  d.experience=experience; d.morale=24; d.mp=0; d.personnel.fit=400; d.personnel.assigned=400;
  a.mp=Engine.mpMax(a);
  s.units=[a,d]; Intel.update(s);
  const logBefore=s.nextLogId;
  const fromIdx=d.idx;
  Combat.attack(s,a.id,{unitId:d.id},'high');
  const fresh=s.log.filter(x=>x.id>=logBefore);
  const alert=fresh.find(x=>x.kind==='alert'&&x.uid===d.id&&/^ВІДСТУП/.test(x.text));
  return { d, fromIdx, dist: g.dist(fromIdx,d.idx), alert };
}

// недосвідчений («ополченець») ламається вже за середньої моралі — поріг вищий
{
  const { d, fromIdx, dist, alert } = run(0);
  ok(!!alert, 'сповіщення «ВІДСТУП» надіслано гравцю');
  ok(alert.vis.includes(1)&&!alert.vis.includes(0), 'сповіщення бачить лише власник підрозділу');
  ok(alert.at===d.idx, 'сповіщення прив’язане до нової позиції підрозділу');
  ok(new RegExp('< '+disperseBelow0).test(alert.text), `поріг розсіювання новобранця (${disperseBelow0}): `+alert.text);
  ok(dist===1, 'відступ — рівно один гекс, а не марш у тил: '+dist+' гекс.');
}

// ветеран (Ветеран, індекс 3) ламається лише за дуже низької моралі — поріг нижчий, тому в
// тих самих умовах він лише впорядковано відступає, а не розсіюється
{
  const { d, fromIdx, dist, alert } = run(3);
  ok(!!alert, 'сповіщення «ВІДСТУП» надіслано гравцю (ветеран)');
  ok(new RegExp('< '+retreatBelow3).test(alert.text), `поріг відступу ветерана (${retreatBelow3}): `+alert.text);
  ok(dist===1, 'відступ ветерана теж рівно один гекс: '+dist+' гекс.');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
