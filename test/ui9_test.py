from playwright.sync_api import sync_playwright
path='file:///home/claude/yugotaria/dist/Yugotaria-Civil-War-stage4c.html'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase')
    pg.evaluate('''()=>{const s=window.__state;s.diplomacy.rel['1-2'].agreements.push({type:'ceasefire',from:1,to:2,terms:{},since:1,until:99},{type:'alliance',from:1,to:2,terms:{},since:1,until:null});
      const d=s.units.find(u=>u.faction===1&&u.type==='inf_platoon');const n=s.units.find(u=>u.faction===2&&u.type==='inf_platoon');const g=Engine.grid(s);
      for(let k=0;k<6;k++){const m=g.neighbor(d.idx,k);if(m>=0&&!Engine.unitsAt(s,m).length&&Engine.hexPassable(s,'foot',m)){n.idx=m;break;}}Intel.update(s);}''')
    pg.click('#btnEndPhase'); pg.click('#btnBeginPhase'); pg.wait_for_timeout(300)
    pg.click('[data-ltab=allies]'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/al1.png')
    print('ally rows', pg.locator('#unitlist .urow').count())
    b.close()
print('ERRORS', errs)
