from playwright.sync_api import sync_playwright
path='file:///home/claude/yugotaria/dist/Yugotaria-Civil-War-stage4c.html'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('console', lambda m: errs.append(m.text) if m.type=='error' and 'ERR_TUNNEL' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto(path); pg.wait_for_timeout(800); pg.click('#btnBeginPhase'); pg.wait_for_timeout(200)
    ids=pg.evaluate('''()=>{const s=window.__state;const f=t=>s.units.find(u=>u.faction===0&&u.type===t).id;return {eng:f('eng_squad'),ags:f('ags_team'),mp:Logistics.facilities(s).find(x=>x.type==='motorpool').id}}''')
    pg.click(f'[data-unit="{ids["eng"]}"]'); pg.wait_for_timeout(200)
    pg.click('[data-act=eng][data-etype=shelter]'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/a1_eng.png')
    pg.click(f'[data-unit="{ids["ags"]}"]'); pg.wait_for_timeout(200)
    print('ags deployed at start', pg.evaluate(f'()=>Engine.unitById(window.__state,{ids["ags"]}).deployed'))
    pg.screenshot(path='/tmp/claude-0/a2_ags.png')
    # motorpool
    pg.evaluate(f'()=>{{const s=window.__state;const f=Logistics.byId(s,{ids["mp"]});UI.renderAll();window.__mp=f.idx}}')
    idx=pg.evaluate('()=>window.__mp')
    # select hex via evaluate to show card: select a unit then click map is hard; call internal selection by clicking list of a unit and set selectedHex via hexCard? use issue directly through button rendering: open by selecting unit placed in motorpool hex
    pg.evaluate(f'()=>{{const s=window.__state;const u=s.units.find(u=>u.faction===0&&u.type==="inf_squad");u.idx={idx};UI.renderAll();}}')
    sq=pg.evaluate('()=>window.__state.units.find(u=>u.faction===0&&u.type==="inf_squad").id')
    pg.click(f'[data-unit="{sq}"]'); pg.wait_for_timeout(200)
    pg.click('[data-act=issueVeh]'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/a3_mp.png')
    print('uaz count', pg.evaluate(f'()=>Logistics.byId(window.__state,{ids["mp"]}).vehicles.veh_uaz'))
    for i in range(6): pg.click('#btnEndPhase'); pg.click('#btnBeginPhase')
    print('shelter', pg.evaluate(f'()=>{{const s=window.__state;return s.map.shelter[Engine.unitById(s,{ids["eng"]}).idx]}}'))
    b.close()
print('ERRORS', errs)
