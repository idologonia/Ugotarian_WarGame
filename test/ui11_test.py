from playwright.sync_api import sync_playwright
path='file:///home/claude/yugotaria/dist/Yugotaria-Civil-War-stage4c.html'
errs=[]
SHOT='/tmp/claude-0/-home-claude/1d300be6-9665-56b4-a303-30e7dc4e01f0/scratchpad/'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    info=pg.evaluate("""()=>{const s=window.__state;const g=Engine.grid(s);const mor=s.units.find(u=>u.faction===0&&u.type==='mortar');if(!mor.deployed)Engine.deploy(s,mor.id);
      const z=Combat.fireZone(s,mor);const vil=[...z.hexes].find(i=>s.map.settlement[i]>0&&!s.units.some(u=>u.idx===i));
      const e=s.units.find(u=>u.faction===1&&u.type==='inf_squad');e.idx=vil;Intel.update(s);
      for(let k=0;k<5;k++){mor.attackedTurn=-1;mor.ammo.m81=40;Combat.attack(s,mor.id,{hex:vil},'high');}
      UI.renderAll();return {vil,eid:e.id};}""")
    pg.click('#logAlerts'); pg.wait_for_timeout(150)
    print('soc alerts:', pg.locator('#logbody .le.alert').count(), pg.locator('#logbody .le.alert .x').first.inner_text()[:140] if pg.locator('#logbody .le.alert').count() else '')
    pg.screenshot(path=SHOT+'a1.png')
    pg.click('#logAlerts')
    pg.click('#btnEndPhase'); pg.wait_for_timeout(300)
    pg.screenshot(path=SHOT+'a2.png')
    print('handover alerts:', pg.locator('[data-halert]').count())
    pg.locator('[data-halert]').first.click(); pg.wait_for_timeout(300)
    sel=pg.evaluate("()=>document.querySelector('#right h2') && document.querySelector('#right h2').textContent")
    print('selected after click:', sel)
    print('new badge:', pg.locator('#alertCount').inner_text())
    pg.screenshot(path=SHOT+'a3.png')
    # картка пункту з історією підтримки
    pg.evaluate(f"()=>{{const s=window.__state;UI.__test.hexClick({info['vil']});}}"); pg.wait_for_timeout(200)
    txt=pg.locator('#right').inner_text()
    print('suplog:', [l for l in txt.split('\n') if 'обстріл' in l][:2])
    b.close()
print('ERRORS', errs)
