# Головне меню й боти: соло проти ботів (хід повертається людині), гаряче місце з ботом,
# режим глядача (пауза/крок).
from playwright.sync_api import sync_playwright
from ui_common import GAME, out
path = GAME.split('#')[0]
errs = []
st = "()=>{const s=UI.getState();return {f:Engine.phaseFaction(s),turn:s.time.turn,phase:s.phase,ho:!document.getElementById('handover').hidden,end:document.getElementById('btnEndPhase').disabled}}"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.goto(path); pg.wait_for_timeout(800)
    assert pg.locator('#mainmenu').is_visible(), 'на старті відкрито головне меню'
    pg.screenshot(path=out('ai1_menu.png'))
    # соло: людина — ДП, решта — важкі боти
    pg.select_option('[data-side="0"]', 'hard'); pg.select_option('[data-side="1"]', 'human'); pg.select_option('[data-side="2"]', 'hard')
    pg.click('#btnStart'); pg.wait_for_timeout(1500)
    s1 = pg.evaluate(st); print('solo start', s1)
    assert s1['f'] == 1 and not s1['end'], 'після ходу бота СВ фаза людини ДП, кнопка доступна'
    if s1['ho']: pg.click('#btnBeginPhase')
    pg.click('#btnEndPhase'); pg.wait_for_timeout(2500)
    s2 = pg.evaluate(st); print('solo next', s2)
    assert s2['f'] == 1 and s2['turn'] == s1['turn'] + 1, 'боти відходили, хід знову в людини'
    pg.screenshot(path=out('ai2_solo.png'))
    # глядач
    pg.click('#btnNew'); pg.wait_for_timeout(200)
    for k, v in ((0, 'hard'), (1, 'easy'), (2, 'hard')): pg.select_option(f'[data-side="{k}"]', v)
    pg.click('#btnStart'); pg.select_option('#spSpeed', '150'); pg.wait_for_timeout(3000)
    t = pg.evaluate("()=>UI.getState().time.turn"); print('spectate turn', t)
    assert t >= 3, 'боти грають самі'
    pg.click('#spPause'); pg.wait_for_timeout(400)
    a = pg.evaluate("()=>UI.getState().time.turn*10+UI.getState().phase")
    pg.wait_for_timeout(600)
    a2 = pg.evaluate("()=>UI.getState().time.turn*10+UI.getState().phase")
    pg.click('#spStep'); pg.wait_for_timeout(300)
    c = pg.evaluate("()=>UI.getState().time.turn*10+UI.getState().phase")
    print('pause', a, a2, 'step', c)
    assert a == a2 and c != a2, 'пауза зупиняє, «Крок» робить одну фазу'
    pg.screenshot(path=out('ai3_spectate.png'))
    b.close()
print('ERRORS', errs)
