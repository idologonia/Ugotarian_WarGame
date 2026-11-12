"""Мережева гра в браузері через справжній HGS: двоє гравців (реєстрація, кімната зі сторонами,
старт), накази через сервер, туман війни, чат, зміна фази, офлайн-гра без змін.

Сторінка гри відкривається за її справжньою адресою (GitHub Pages) — Playwright віддає з неї
локальну збірку dist/, а підключення йде на локальний HGS через ?hgs=ws://127.0.0.1:…
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from playwright.async_api import async_playwright

from test_logic_e2e import ROOT, start_core, stop_core

SITE = "https://idologonia.github.io/Ugotarian_WarGame/"
DIST = ROOT / "dist"
OUT = ROOT / "test" / "out"


async def serve(route):
    name = route.request.url.split("?")[0][len(SITE):] or "index.html"
    f = DIST / ("Yugotaria-Civil-War.html" if name == "index.html" else name)
    if not f.exists():
        return await route.fulfill(status=404, body="")
    ctype = "text/html; charset=utf-8" if f.suffix == ".html" else "application/javascript"
    await route.fulfill(status=200, body=f.read_bytes(), headers={"Content-Type": ctype})


async def test_two_players_in_browser(tmp_path):
    OUT.mkdir(parents=True, exist_ok=True)
    app = await start_core(tmp_path)
    url = f"{SITE}?hgs=ws://127.0.0.1:{app.gateway_port}"
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults"])

            async def page(name):
                ctx = await b.new_context(viewport={"width": 1400, "height": 860})
                await ctx.route(SITE + "**", serve)
                pg = await ctx.new_page()
                pg.on("pageerror", lambda e: errs.append(f"{name}: {e}"))
                return pg

            async def register(pg, user):
                await pg.goto(url)
                await pg.wait_for_selector("[data-hgs-login]", timeout=20000)
                await pg.click('[data-tab="register"]')
                await pg.fill('[name="u"]', user)
                await pg.fill('[name="p"]', "secret123")
                await pg.click("[data-go]")
                await pg.wait_for_selector("#nrCreate", timeout=20000)

            H, F = await page("host"), await page("friend")
            await register(H, "Командир")
            await H.screenshot(path=str(OUT / "hgs1_rooms.png"))
            # хост створює кімнату: СВ і ДП — гравці, НП — легкий бот
            await H.fill("#nrName", "Тестова кампанія")
            await H.select_option("#nrSide1", "human")
            await H.click("#nrCreate")
            await H.wait_for_selector('[data-nl="take"][data-f="0"]', timeout=20000)
            await H.click('[data-nl="take"][data-f="0"]')
            # друг бачить кімнату в списку й заходить
            await register(F, "Друг")
            await F.wait_for_selector("[data-room]", timeout=20000)
            await F.click("[data-room]")
            await F.wait_for_selector('[data-nl="take"][data-f="1"]', timeout=20000)
            await F.click('[data-nl="take"][data-f="1"]')
            assert await F.locator("#nlStart").count() == 0, "у друга немає кнопок хоста"
            await H.wait_for_function("() => document.querySelector('.nl-slot:nth-child(2) .nl-pl')", timeout=20000)
            await H.screenshot(path=str(OUT / "hgs2_room.png"))
            await H.click("#nlStart")
            await H.wait_for_function("() => document.getElementById('netlobby').hidden && UI.getState()", timeout=30000)
            await F.wait_for_function("() => document.getElementById('netlobby').hidden && UI.getState()", timeout=30000)
            fu = await F.evaluate("[0,1,2].map(f=>UI.getState().units.filter(u=>u.faction===f).length)")
            assert fu[0] == 0 and fu[1] > 0, f"туман війни: {fu}"
            # хост віддає наказ руху через інтерфейс: результат приходить із сервера
            mv = await H.evaluate("""async () => { const s = UI.getState(); const u = s.units.find(x => x.faction === 0 && x.type === 'inf_squad');
                const g = Engine.grid(s); const r = await Engine.issueMoveOrder(s, u.id, g.idx(g.col(u.idx) - 3, g.row(u.idx)));
                return { ok: r.ok, moved: Engine.unitById(UI.getState(), u.id).idx !== u.idx }; }""")
            assert mv["ok"] and mv["moved"], mv
            bad = await F.evaluate("async () => { const s = UI.getState(); return (await Engine.setStance(s, s.units.find(u => u.faction === 1).id, 'defend')).reason; }")
            assert "не ваша фаза" in bad, bad
            # чат
            await H.click("#btnChat")
            await H.fill("#chatPanel .chat-text", "Привіт!")
            await H.click("#chatPanel .chat-send")
            await F.wait_for_function("() => /Чат\\s*1|Чат1/.test(document.getElementById('btnChat').innerText)", timeout=10000)
            # зміна фази
            await H.click("#btnEndPhase")
            await F.wait_for_function("() => Engine.phaseFaction(UI.getState()) === 1 && !document.getElementById('btnEndPhase').disabled", timeout=20000)
            await F.screenshot(path=str(OUT / "hgs3_friend_turn.png"))
            # перезавантаження: друг повертається в гру (вхід пам’ятає браузер)
            await F.reload()
            await F.wait_for_function("() => UI.getState() && document.getElementById('netlobby').hidden && Net.faction() === 1", timeout=30000)
            await b.close()
    finally:
        await stop_core(app)
    assert not errs, errs


async def test_offline_without_server():
    """Без сервера: головне меню, «Гра на одинці» як раніше; «Гра в мережі» → «сервер вимкнено»."""
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults"])
        ctx = await b.new_context()
        await ctx.route(SITE + "**", serve)
        await ctx.route("https://api.github.com/**", lambda r: r.fulfill(status=404, body=""))
        await ctx.route("https://raw.githubusercontent.com/**", lambda r: r.fulfill(status=404, body=""))
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(SITE)
        await pg.wait_for_selector("#mmOnline")
        await pg.click("#mmOnline")
        await pg.wait_for_selector("#nlRetry", timeout=15000)
        await pg.click("#nlBackSolo")
        await pg.wait_for_selector("#btnStart", timeout=15000)
        await pg.click("#btnStart")
        await pg.wait_for_function("() => UI.getState() && !Net.active()", timeout=15000)
        assert await pg.evaluate("Engine.phaseFaction(UI.getState())") == 0
        await b.close()
        assert not errs, errs
