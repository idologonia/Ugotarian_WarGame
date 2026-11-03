from playwright.sync_api import sync_playwright
from ui_common import GAME, OUT, out
path=GAME
errs=[]
def hexscreen(pg, idx, sel_idx, box, scale=24):
    c=pg.evaluate('(i)=>Engine.grid(window.__state).center(i)', idx)
    s=pg.evaluate('(i)=>Engine.grid(window.__state).center(i)', sel_idx)
    return box['x']+box['width']/2+(c['x']-s['x'])*scale, box['y']+box['height']/2+(c['y']-s['y'])*scale
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(1200)
    pg.screenshot(path=out('t1_handover.png'))
    pg.click('#btnBeginPhase'); pg.wait_for_timeout(300)
    # place a dem squad 2 hexes from first soc platoon, in the open
    info=pg.evaluate('''()=>{const s=window.__state;const g=Engine.grid(s);
      for(const u of s.units.filter(x=>x.faction===0&&!x.vehicle)){for(let d=0;d<6;d++){const m=g.neighbor(u.idx,d);if(m>=0&&!Engine.unitsAt(s,m).length&&Engine.hexPassable(s,'foot',m)){
      const e=s.units.find(x=>x.faction===1&&x.type==='inf_squad');e.idx=m;Intel.update(s);return {u:u.id,uidx:u.idx,e:e.id,eidx:m,vis:Intel.isVisible(s,0,e.id)}}}}}''')
    print(info)
    pg.click(f'[data-unit="{info["u"]}"]'); pg.wait_for_timeout(200)
    pg.click('[data-act=attack]'); pg.wait_for_timeout(200)
    box=pg.locator('#map').bounding_box()
    x,y=hexscreen(pg,info['eidx'],info['uidx'],box)
    pg.mouse.click(x,y); pg.wait_for_timeout(200)
    pg.screenshot(path=out('t2_attackpreview.png'))
    print('fire button', pg.locator('[data-act=fire]').count())
    pg.click('[data-act=fire]'); pg.wait_for_timeout(300)
    pg.screenshot(path=out('t3_report.png'))
    print('report steps', pg.locator('.rep-step').count())
    # end phase -> handover for dem
    pg.click('#btnEndPhase'); pg.wait_for_timeout(200)
    print('handover visible', pg.is_visible('#handover'))
    pg.click('#btnBeginPhase'); pg.wait_for_timeout(300)
    pg.click('[data-ltab=intel]'); pg.wait_for_timeout(200)
    pg.screenshot(path=out('t4_dem.png'))
    # cycle a full day quickly
    for i in range(3*6):
        pg.click('#btnEndPhase'); pg.click('#btnBeginPhase')
    print('time', pg.evaluate('()=>window.__state.time'))
    # save/load roundtrip
    pg.click('#btnSaves'); pg.click('[data-save=slot2]'); pg.click('[data-load=slot2]'); pg.wait_for_timeout(300)
    print('after load handover', pg.is_visible('#handover'))
    m=b.new_page(viewport={'width':400,'height':800}); m.on('pageerror', lambda e: errs.append('M '+str(e)))
    m.goto(path); m.wait_for_timeout(800); m.click('#btnBeginPhase'); m.wait_for_timeout(300); m.screenshot(path=out('t5_mobile.png'))
    print('mobile width', m.evaluate('()=>[document.documentElement.scrollWidth, innerWidth]'))
    d=b.new_page(viewport={'width':1440,'height':900}, color_scheme='dark'); d.goto(path); d.wait_for_timeout(800); d.screenshot(path=out('t6_dark_handover.png'))
    b.close()
print('ERRORS', errs)
