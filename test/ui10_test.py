from playwright.sync_api import sync_playwright
from ui_common import GAME, OUT, out
path=GAME
errs=[]
SHOT=OUT+'/'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.on('console', lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' else None)
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    # піхота: зони руху та вогню
    pg.evaluate("()=>{const s=window.__state;const u=s.units.find(u=>u.faction===0&&u.type==='inf_squad'&&u.embarked==null);UI.__test.select(u.id);}")
    pg.wait_for_timeout(250); pg.screenshot(path=SHOT+'z1.png')
    print('card:', pg.locator('#right').inner_text()[:0] or [l for l in pg.locator('#right').inner_text().split('\n') if 'Рух зараз' in l or 'вогонь' in l.lower()][:4])
    # міномет: вогонь по площі наосліп
    res=pg.evaluate("""()=>{const s=window.__state;const g=Engine.grid(s);const m=s.units.find(u=>u.faction===0&&u.type==='mortar');
      if(!m.deployed)Engine.deploy(s,m.id);
      UI.__test.select(m.id);const z=Combat.fireZone(s,m);let t=-1;
      for(const i of z.hexes){if(g.dist(i,m.idx)<6)continue;if(s.units.some(u=>u.idx===i))continue;if(Intel.hexObserved(s,0,i))continue;if(Intel.markerAt(s,0,i).length)continue;t=i;break;}
      return {mid:m.id,t,ammo:JSON.stringify(m.ammo)};}""")
    pg.click('[data-act=attack]'); pg.wait_for_timeout(200)
    pg.screenshot(path=SHOT+'z2.png')
    print('hint:', pg.locator('#modehint').inner_text())
    pg.evaluate(f"()=>UI.__test.hexClick({res['t']})"); pg.wait_for_timeout(200)
    print('preview:', [l for l in pg.locator('#right').inner_text().split('\n') if 'площ' in l][:3])
    pg.screenshot(path=SHOT+'z3.png')
    pg.click('[data-act=fire]'); pg.wait_for_timeout(300)
    after=pg.evaluate(f"()=>JSON.stringify(window.__state.units.find(u=>u.id==={res['mid']}).ammo)")
    print('ammo changed:', after!=res['ammo'])
    print('log:', [l for l in pg.locator('#log').inner_text().split('\n') if 'ОБСТРІЛ' in l][:2])
    pg.click('#tglZones'); pg.wait_for_timeout(150); print('zones pressed:', pg.get_attribute('#tglZones','aria-pressed'))
    b.close()
print('ERRORS', errs)
