from playwright.sync_api import sync_playwright
path='file:///home/claude/yugotaria/dist/Yugotaria-Civil-War-stage4c.html'
errs=[]
SHOT='/tmp/claude-0/-home-claude/1d300be6-9665-56b4-a303-30e7dc4e01f0/scratchpad/'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    ids=pg.evaluate("()=>{const s=window.__state;const u=s.units.find(u=>u.faction===0&&u.type==='mg_team');UI.__test.select(u.id);return u.id;}")
    pg.wait_for_timeout(150)
    print('ambush btn present:', pg.locator('[data-act=ambush]').count())
    pg.click('[data-act=ambush]'); pg.wait_for_timeout(200)
    print('status after:', [l for l in pg.locator('#right').inner_text().split('\n') if 'Засідка' in l][:3])
    pg.screenshot(path=SHOT+'amb1.png')
    k=pg.evaluate("()=>{const s=window.__state;const k=s.units.find(u=>u.type==='veh_kamaz'&&u.faction===0);const d=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);k.idx=d.idx;UI.renderAll();return k.id;}")
    pg.evaluate(f"()=>UI.__test.select({k})"); pg.wait_for_timeout(150)
    print('load selects:', pg.locator('[data-loadsel]').count(), 'load buttons:', pg.locator('[data-act=load]').count())
    pg.select_option('[data-loadsel]', 'fuel')
    pg.click('[data-act=load]'); pg.wait_for_timeout(150)
    print('cargo kg after fuel load:', pg.evaluate(f"()=>Logistics.cargoKg(Engine.unitById(window.__state,{k}))"))
    pg.screenshot(path=SHOT+'amb2.png')
    b.close()
print('ERRORS', errs)
