from playwright.sync_api import sync_playwright
from ui_common import GAME, OUT, out
path=GAME
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    info=pg.evaluate('''()=>{const s=window.__state;const g=Engine.grid(s);
      let u=null,t=-1;for(const x of s.units.filter(x=>x.faction===0&&x.type==='inf_squad').concat(s.units.filter(x=>x.faction===0&&!x.vehicle))){for(let d=0;d<6;d++){const m=g.neighbor(x.idx,d);if(m>=0&&!Engine.unitsAt(s,m).length&&Engine.hexPassable(s,'foot',m)){t=m;u=x;break;}}if(u)break;}
      const e=s.units.find(x=>x.faction===1&&x.type==='inf_platoon');e.idx=t;s.map.terrain[t]=1;Intel.update(s);
      const a=s.units.find(x=>x.faction===0&&x.type==='inf_platoon'); a.idx=u.idx;
      for(let i=0;i<4;i++){a.attackedTurn=0;a.mp=16;Combat.attack(s,a.id,{unitId:e.id},'high');}
      // own squad also dies a bit: put a cache in own hex
      const c=Loot.cacheAt(s,u.idx,true);c.dead[0]+=2;c.weapons['АКМ']=(c.weapons['АКМ']||0)+3;c.ammo['762s']=(c.ammo['762s']||0)+400;
      u.weapons['АК-74']-=2;Intel.update(s);UI.renderAll();return {u:u.id,t, dead:JSON.stringify(Object.values(s.caches).map(c=>c.dead))}}''')
    print(info)
    pg.click(f'[data-unit="{info["u"]}"]'); pg.wait_for_timeout(300)
    for _ in range(2): pg.click('#zoomIn')
    pg.screenshot(path=out('l1.png'))
    pg.click('.subsec [data-act=loot]'); pg.wait_for_timeout(300)
    pg.screenshot(path=out('l2.png'))
    print(pg.evaluate(f'()=>{{const u=Engine.unitById(window.__state,{info["u"]});return [JSON.stringify(u.weapons),JSON.stringify(u.cargo)]}}'))
    b.close()
print('ERRORS', errs)
