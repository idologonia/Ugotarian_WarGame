import sys, json
from playwright.sync_api import sync_playwright
path='file:///home/claude/yugotaria/dist/Yugotaria-Civil-War-stage1.html'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':1440,'height':880})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(1500)
    pg.screenshot(path='/tmp/claude-0/s1.png')
    # select first unit in list
    pg.click('#unitlist .urow >> nth=0'); pg.wait_for_timeout(200)
    st=pg.evaluate('()=>{const s=window.__state;return {phase:s.phase,units:s.units.length}}')
    print('state',st)
    pg.click('[data-act=move]'); pg.wait_for_timeout(100)
    # click a hex west of the unit, computed via the page
    tgt=pg.evaluate('''()=>{const s=window.__state;const g=Engine.grid(s);const u=s.units.find(x=>x.faction===0);
      for(let i=0;i<g.size;i++){if(g.dist(i,u.idx)>=20&&g.dist(i,u.idx)<=24&&Engine.hexPassable(s,'foot',i)&&!Engine.unitsAt(s,i).length){return i}}return -1}''')
    # use engine-level preview via simulated click: convert hex to screen
    pos=pg.evaluate('''(t)=>{const s=window.__state;const g=Engine.grid(s);const u=s.units.find(x=>x.faction===0);return {u:u.idx}}''',tgt)
    # center map on target then click canvas center
    pg.evaluate('(t)=>{}',tgt)
    box=pg.locator('#map').bounding_box()
    # ask the UI to center: use btnCenter after selecting hex; simpler: compute screen coords using same transforms
    sc=pg.evaluate('''(t)=>{const s=window.__state;const g=Engine.grid(s);return g.center(t)}''',tgt)
    print('target',tgt,sc)
    # zoom out a lot so target likely visible
    for _ in range(4): pg.click('#zoomOut')
    pg.click('#btnCenter'); pg.wait_for_timeout(100)
    # now view centered on selected unit; scale?
    sel=pg.evaluate('''()=>{const s=window.__state;const g=Engine.grid(s);const u=s.units.find(x=>x.faction===0);return g.center(u.idx)}''')
    scale=24/(1.25**4)
    x=box['x']+box['width']/2+(sc['x']-sel['x'])*scale
    y=box['y']+box['height']/2+(sc['y']-sel['y'])*scale
    pg.mouse.click(x,y); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/s2.png')
    print('preview panel:', pg.locator('.route').count())
    pg.click('[data-act=confirm]'); pg.wait_for_timeout(200)
    u0=pg.evaluate('()=>{const u=window.__state.units.find(x=>x.faction===0);return {idx:u.idx,mp:u.mp,order:!!u.order}}')
    print('after confirm',u0)
    for _ in range(3): pg.click('#btnEndPhase'); pg.wait_for_timeout(150)
    t=pg.evaluate('()=>window.__state.time')
    print('time',t)
    pg.click('#btnSaves'); pg.wait_for_timeout(200)
    pg.click('[data-save=slot1]'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/s3.png')
    pg.click('[data-load=slot1]'); pg.wait_for_timeout(300)
    print('after load', pg.evaluate('()=>window.__state.time'))
    pg.click('#btnHelp'); pg.wait_for_timeout(200); pg.screenshot(path='/tmp/claude-0/s4.png'); pg.keyboard.press('Escape')
    # mobile
    m=b.new_page(viewport={'width':400,'height':800})
    m.on('pageerror', lambda e: errs.append('M PAGEERROR '+str(e)))
    m.goto(path); m.wait_for_timeout(1200); m.screenshot(path='/tmp/claude-0/m1.png', full_page=False)
    sw=m.evaluate('()=>[document.documentElement.scrollWidth, innerWidth]'); print('mobile width',sw)
    # dark
    d=b.new_page(viewport={'width':1440,'height':880}, color_scheme='dark'); d.goto(path); d.wait_for_timeout(1200); d.screenshot(path='/tmp/claude-0/d1.png')
    b.close()
print('ERRORS', errs)
