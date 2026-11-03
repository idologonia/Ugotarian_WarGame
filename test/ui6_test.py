from playwright.sync_api import sync_playwright
from ui_common import GAME, OUT, out
path=GAME
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    pg.click('#btnPol'); pg.wait_for_timeout(200); pg.screenshot(path=out('p1_pop.png'))
    pg.click('[data-ptab=dip]'); pg.wait_for_timeout(100)
    pg.select_option('#dipType','ceasefire'); pg.click('[data-pol=send]'); pg.wait_for_timeout(200)
    pg.keyboard.press('Escape')
    pg.click('#btnEndPhase'); pg.wait_for_timeout(200); pg.screenshot(path=out('p2_handover.png'))
    pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    print('badge', pg.inner_text('#btnPol'))
    pg.click('#btnPol'); pg.click('[data-ptab=dip]'); pg.wait_for_timeout(100); pg.screenshot(path=out('p3_dip.png'))
    pg.click('[data-pol=accept]'); pg.wait_for_timeout(200)
    print('status', pg.evaluate('()=>Politics.statusText(window.__state,0,1)'))
    pg.click('[data-ptab=goals]'); pg.wait_for_timeout(100); pg.screenshot(path=out('p4_goals.png')); pg.keyboard.press('Escape')
    # finish campaign quickly
    pg.evaluate('()=>{window.__state.campaign.endDay=1;}')
    for i in range(60):
        if pg.evaluate('()=>window.__state.campaign.over'): break
        pg.click('#btnEndPhase'); pg.click('#btnBeginPhase')
    pg.wait_for_timeout(300); pg.screenshot(path=out('p5_chron.png'))
    print('over', pg.evaluate('()=>window.__state.campaign.reason'))
    b.close()
print('ERRORS', errs)
