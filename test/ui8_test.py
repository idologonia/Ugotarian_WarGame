from playwright.sync_api import sync_playwright
path='file:///home/claude/yugotaria/dist/Yugotaria-Civil-War-stage4c.html'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    k=pg.evaluate('''()=>{const s=window.__state;const d=Logistics.facilities(s).find(f=>f.type==='depot'&&f.owner===0);const u=s.units.find(u=>u.faction===0&&u.type==='inf_squad');u.idx=d.idx;UI.renderAll();return u.id}''')
    pg.click(f'[data-unit="{k}"]'); pg.wait_for_timeout(200)
    pg.select_option('[data-formsel]','hmg_team'); pg.wait_for_timeout(150)
    pg.click('[data-act=form]'); pg.wait_for_timeout(200)
    print('queue', pg.evaluate('()=>window.__state.formations.length'))
    pg.screenshot(path='/tmp/claude-0/b1_form.png', full_page=False)
    pg.click('#btnEco'); pg.wait_for_timeout(200); pg.select_option('#bmItem','НСВ «Утьос»'); pg.click('#bmBuy'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/b2_market.png')
    print('orders', pg.evaluate('()=>window.__state.market.length'))
    b.close()
print('ERRORS', errs)
