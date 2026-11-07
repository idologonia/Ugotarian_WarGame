# Онлайн-гра в браузері: сервер (start-server.sh), хост і друг у двох вікнах — лобі, старт,
# накази через сервер, туман війни, чат, зміна фази, повернення після перезавантаження.
import os, random, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
from ui_common import ROOT, out
port = random.randint(21000, 24000)
env = dict(os.environ, NO_BROWSER='1', YUGO_QUIET='1', YUGO_HOST_KEY='uikey', YUGO_SAVES=tempfile.mkdtemp())
srv = subprocess.Popen([os.path.join(ROOT, 'start-server.sh'), '--port', str(port)], env=env)
base = f'http://127.0.0.1:{port}'
errs = []
try:
    for _ in range(60):
        try: urllib.request.urlopen(base + '/api/hello', timeout=1); break
        except Exception: time.sleep(0.5)
    with sync_playwright() as p:
        b = p.chromium.launch()
        def page(name):
            pg = b.new_context(viewport={'width': 1400, 'height': 860}).new_page()
            pg.on('pageerror', lambda e: errs.append(f'PAGEERROR {name}: {e}'))
            return pg
        H, F = page('host'), page('friend')
        H.goto(base + '/?host=uikey'); H.wait_for_selector('#nlName'); H.fill('#nlName', 'Командир'); H.click('#nlJoin')
        H.wait_for_selector('[data-nlkind="1"]'); H.select_option('[data-nlkind="1"]', 'human'); H.wait_for_timeout(300)
        H.click('[data-nl="take"][data-f="0"]'); H.wait_for_timeout(300)
        F.goto(base + '/'); F.wait_for_selector('#nlName'); F.fill('#nlName', 'Друг'); F.click('#nlJoin')
        F.wait_for_selector('[data-nl="take"][data-f="1"]'); F.click('[data-nl="take"][data-f="1"]'); F.wait_for_timeout(300)
        assert F.locator('#nlStart').count() == 0, 'у друга немає кнопок хоста'
        H.screenshot(path=out('online1_lobby.png'))
        H.click('#nlStart'); H.wait_for_timeout(2000)
        assert H.evaluate("document.getElementById('netlobby').hidden"), 'хост у грі'
        fu = F.evaluate("[0,1,2].map(f=>UI.getState().units.filter(u=>u.faction===f).length)")
        print('friend sees units', fu)
        assert fu[0] == 0 and fu[1] > 0, 'туман війни: друг не бачить прихованих підрозділів СВ'
        mv = H.evaluate("""()=>{const s=UI.getState();const u=s.units.find(x=>x.faction===0&&x.type==='inf_squad');const g=Engine.grid(s);
          const r=Engine.issueMoveOrder(s,u.id,g.idx(g.col(u.idx)-3,g.row(u.idx)));return {ok:r.ok,moved:Engine.unitById(UI.getState(),u.id).idx!==u.idx};}""")
        print('host move', mv); assert mv['ok'] and mv['moved'], 'наказ руху виконано сервером'
        bad = F.evaluate("()=>{const s=UI.getState();return Engine.setStance(s,s.units.find(u=>u.faction===1).id,'defend').reason}")
        print('friend out of turn:', bad); assert 'не ваша фаза' in bad
        H.click('#btnChat'); H.fill('#chatPanel .chat-text', 'Привіт!'); H.click('#chatPanel .chat-send'); H.wait_for_timeout(700)
        assert '1' in F.locator('#btnChat').inner_text(), 'друг отримав повідомлення'
        H.click('#btnEndPhase'); H.wait_for_timeout(1500)
        assert F.evaluate("Engine.phaseFaction(UI.getState())") == 1 and not F.evaluate("document.getElementById('btnEndPhase').disabled"), 'хід перейшов до друга'
        F.reload(); F.wait_for_timeout(2500)
        assert F.evaluate("Net.faction()") == 1 and F.evaluate("document.getElementById('netlobby').hidden"), 'після перезавантаження друг знову в грі'
        F.screenshot(path=out('online2_friend.png'))
        b.close()
finally:
    srv.terminate(); srv.wait(timeout=10)
print('ERRORS', errs)
