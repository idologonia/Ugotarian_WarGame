const L=require('./load.js')();
const {Engine}=L;
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};

// Запит гравця: «Додай ще одну річку біля якогось села, щоб трохи протестувати бій біля
// річки і переправи» — друга річка має реально існувати на карті (не лише головне русло
// через Місто А) і мати хоча б один обладнаний брід/міст поруч для переправи.

for (const seed of [1999, 2024, 42, 7]) {
  const s = Engine.newGame(seed);
  const g = Engine.grid(s);
  const villE = s.map.settlements[5];
  ok(villE && villE.name === 'Село Е', 'seed '+seed+': Село Е exists as settlements[5]');

  // усі річкові гекси
  const riverHexes = []; for (let i = 0; i < s.map.river.length; i++) if (s.map.river[i]) riverHexes.push(i);
  // гекси головного русла пролягають переважно через/біля Місто А; друга річка — поруч із Селом Е,
  // далеко (у гексах) від центру міста. Перевіряємо, що є річкові гекси в радіусі 12 від Села Е.
  const nearVillE = riverHexes.filter(i => g.dist(i, villE.center) <= 12);
  ok(nearVillE.length > 0, 'seed '+seed+': a second river segment actually exists near Село Е ('+nearVillE.length+' hexes within 12)');

  // переправа: хоч один річковий гекс поруч із Селом Е має міст (гарантована переправа з mapgen)
  const bridgeNear = nearVillE.some(i => s.map.bridge[i]);
  ok(bridgeNear, 'seed '+seed+': a bridge/crossing exists over the river near Село Е');

  // річка не розрізає саме Село Е (не стоїть на гексі поселення)
  ok(!s.map.river[villE.center], 'seed '+seed+': the river does not run through the village center itself');

  // це НЕ ті самі гекси, що головне русло біля Міста А (перевіряємо, що є річка і далеко від
  // Міста А — тобто це справді окремий сегмент, а не просто той самий потік)
  const city = s.map.settlements[0];
  const farFromCity = riverHexes.some(i => g.dist(i, city.center) > 15 && g.dist(i, villE.center) <= 12);
  ok(farFromCity, 'seed '+seed+': the second river segment is a distinct stretch away from the city');
}

console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
