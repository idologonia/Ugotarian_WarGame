from playwright.sync_api import sync_playwright
path='file:///home/claude/yugotaria/dist/Yugotaria-Civil-War-stage4c.html'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    ids=pg.evaluate('''()=>{const s=window.__state;const k=s.units.find(u=>u.type==='veh_kamaz'&&u.faction===0);const d=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);k.idx=d.idx;UI.renderAll();return {k:k.id}}''')
    pg.click('#tglSupply'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/e1_map.png')
    pg.click(f'[data-unit="{ids["k"]}"]'); pg.wait_for_timeout(200)
    pg.select_option('.subsec [data-loadsel]', 'mix'); pg.click('.subsec [data-act=load]'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/e2_truck.png')
    print('cargo kg', pg.evaluate(f'()=>Logistics.cargoKg(Engine.unitById(window.__state,{ids["k"]}))'))
    pg.click('#btnEco'); pg.wait_for_timeout(200); pg.screenshot(path='/tmp/claude-0/e3_eco.png'); pg.keyboard.press('Escape')
    for i in range(6): pg.click('#btnEndPhase'); pg.click('#btnBeginPhase')
    print('time', pg.evaluate('()=>window.__state.time'))
    pg.click('#btnSaves'); pg.click('[data-save=slot1]'); pg.click('[data-load=slot1]'); pg.wait_for_timeout(200)
    m=b.new_page(viewport={'width':400,'height':800}); m.on('pageerror', lambda e: errs.append('M '+str(e))); m.goto(path); m.wait_for_timeout(600); m.click('#btnBeginPhase'); m.click('#btnEco'); m.wait_for_timeout(200); m.screenshot(path='/tmp/claude-0/e4_mobile.png')
    print('mobile', m.evaluate('()=>[document.documentElement.scrollWidth, innerWidth]'))
    b.close()
print('ERRORS', errs)
