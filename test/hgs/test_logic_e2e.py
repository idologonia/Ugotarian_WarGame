"""Наскрізна перевірка серверної логіки гри на справжньому ядрі HGS.

Запуск (потрібні HGS з https://github.com/idologonia/HGS і Node.js):
    HGS_SRC=/шлях/до/HGS/src python -m pytest test/hgs -q
Ядро HGS піднімається в процесі на випадкових портах з тимчасовою текою даних; гра
додається з кореня цього репозиторію (hgs-game.json) — як це робить хост.
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, os.environ.get("HGS_SRC", str(ROOT.parent / "idologonia" / "hgs" / "src")))

import httpx  # noqa: E402
import websockets  # noqa: E402
from hgs.adapters.registry import builtin_registry  # noqa: E402
from hgs.core.app import CoreApp  # noqa: E402
from hgs.core.config.settings import Settings  # noqa: E402

GAME = "ugotarian-wargame"
ORIGIN = "https://idologonia.github.io"


class C:
    """Мінімальний клієнт протоколу HGS (як hgs.js)."""

    def __init__(self, ws):
        self.ws, self.seq, self.n, self.inbox = ws, 0, 0, []

    async def send(self, t, d=None, req=False):
        self.seq += 1
        env = {"v": 1, "t": t, "seq": self.seq}
        rid = None
        if req:
            self.n += 1
            rid = env["id"] = f"r{self.n}"
        if d is not None:
            env["d"] = d
        await self.ws.send(json.dumps(env))
        return rid

    async def recv(self, timeout=10.0):
        return json.loads(await asyncio.wait_for(self.ws.recv(), timeout))

    async def request(self, t, d=None):
        rid = await self.send(t, d, req=True)
        while True:
            m = await self.recv()
            if m["t"] == "reply" and m.get("re") == rid:
                return m
            self.inbox.append(m)

    async def game(self, e, d=None):
        await self.send("game", {"e": e, "d": d})

    async def wait_game(self, e, pred=lambda d: True, timeout=30.0):
        """Наступна ігрова подія e (з урахуванням уже отриманих)."""
        for i, m in enumerate(self.inbox):
            if m.get("t") == "event" and m["d"].get("e") == e and pred(m["d"].get("d")):
                self.inbox.pop(i)
                return m["d"].get("d")
        end = asyncio.get_running_loop().time() + timeout
        while True:
            m = await self.recv(max(0.1, end - asyncio.get_running_loop().time()))
            if m.get("t") == "event" and m["d"].get("e") == e and pred(m["d"].get("d")):
                return m["d"].get("d")
            self.inbox.append(m)

    def drain_games(self, e):
        out = [m["d"].get("d") for m in self.inbox if m.get("t") == "event" and m["d"].get("e") == e]
        self.inbox = [m for m in self.inbox if not (m.get("t") == "event" and m["d"].get("e") == e)]
        return out


async def start_core(tmp):
    s = Settings()
    s.admin.port = 0
    s.gateway.port = 0
    s.worker_bus.port = 0
    app = CoreApp(Path(tmp) / "data", secrets.token_urlsafe(32), s, registry=builtin_registry())
    await app.start()
    app.test_admin = httpx.AsyncClient(base_url=f"http://127.0.0.1:{app.admin_port}/admin/v1",
                                       headers={"Authorization": f"Bearer {app.admin_token}"}, timeout=60)
    r = await app.test_admin.post("/games", json={"path": str(ROOT)})
    assert r.status_code == 201, r.text
    r = await app.test_admin.post(f"/games/{GAME}/start")
    assert r.json()["state"] == "running", r.text
    return app


async def stop_core(app):
    await app.test_admin.aclose()
    await app.stop()


@pytest.fixture
async def core(tmp_path):
    app = await start_core(tmp_path)
    yield app
    await stop_core(app)


async def player(app, name):
    ws = await websockets.connect(f"ws://127.0.0.1:{app.gateway_port}/hgs/v1/ws", origin=ORIGIN, max_size=8 * 1024 * 1024, max_queue=None)
    c = C(ws)
    await c.send("hello", {"game": GAME, "auth": {"type": "account", "username": name, "password": "secret123", "register": True}})
    c.welcome = await c.recv()
    assert c.welcome["t"] == "welcome", c.welcome
    c.id = c.welcome["d"]["player"]["id"]
    return c


async def join(c, room):
    r = await c.request("room.join", {"room_id": room})
    assert r["ok"], r
    await c.game("hello")


async def test_room_game_fog_commands_chat(core):
    host, friend = await player(core, "Командир"), await player(core, "Друг")
    # кімната з налаштуваннями (як у лобі гри)
    r = await host.request("room.create", {"name": "Тест", "max_players": 8, "params": {"seed": 1999, "slots": ["human", "human", "easy"]}})
    assert r["ok"], r
    rid = r["d"]["room"]["id"]
    await join(host, rid)
    info = await host.wait_game("room")
    assert info["host"] == host.id and [s["kind"] for s in info["slots"]] == ["human", "human", "easy"]
    await join(friend, rid)
    await host.game("take", {"faction": 0})
    await friend.game("take", {"faction": 1})
    await friend.game("start")
    note = await friend.wait_game("notice")
    assert "хост" in note["text"], note
    await host.wait_game("room", lambda d: d["slots"][1]["owner"] == friend.id)
    await host.game("start")
    vh = (await host.wait_game("view"))["view"]
    vf = (await friend.wait_game("view"))["view"]
    assert vh["view"]["faction"] == 0 and vf["view"]["faction"] == 1
    # строгий туман війни
    hidden = [u for u in vf["units"] if u["faction"] == 0]
    assert len(hidden) == 0, "ДП не бачить прихованих підрозділів СВ"
    assert vf["economy"][0]["money"] == 0 and vf["economy"][1]["money"] > 0
    # накази: чужа фаза, чужий підрозділ, невідома функція
    await friend.game("cmd", {"id": 1, "mod": "Engine", "fn": "endPhase", "args": []})
    res = await friend.wait_game("result", lambda d: d["id"] == 1)
    assert not res["ok"] and "не ваша фаза" in res["reason"]
    dp_unit = next(u for u in vf["units"] if u["faction"] == 1)
    await host.game("cmd", {"id": 2, "mod": "Engine", "fn": "setStance", "args": [dp_unit["id"], "defend"]})
    res = await host.wait_game("result", lambda d: d["id"] == 2)
    assert not res["ok"] and "не ваш підрозділ" in res["reason"]
    await host.game("cmd", {"id": 3, "mod": "Engine", "fn": "newGame", "args": [5]})
    res = await host.wait_game("result", lambda d: d["id"] == 3)
    assert not res["ok"] and "Невідомий наказ" in res["reason"]
    # дозволений наказ: нова картина приходить раніше за результат
    my = next(u for u in vh["units"] if u["faction"] == 0 and u["type"] == "inf_squad")
    host.drain_games("view")
    await host.game("cmd", {"id": 4, "mod": "Engine", "fn": "setStance", "args": [my["id"], "defend"]})
    v = (await host.wait_game("view"))["view"]
    res = await host.wait_game("result", lambda d: d["id"] == 4)
    assert res["ok"] and res["result"]["ok"]
    assert next(u for u in v["units"] if u["id"] == my["id"])["stance"] == "defend"
    # фази: СВ і ДП — гравці, НП — бот на сервері
    await host.game("cmd", {"id": 5, "mod": "Engine", "fn": "endPhase", "args": []})
    assert (await host.wait_game("result", lambda d: d["id"] == 5))["ok"]
    await friend.game("cmd", {"id": 6, "mod": "Engine", "fn": "endPhase", "args": []})
    assert (await friend.wait_game("result", lambda d: d["id"] == 6))["ok"]
    v2 = (await host.wait_game("view", lambda d: d["view"]["time"]["turn"] == 2))["view"]
    assert v2["time"]["turn"] == 2, "бот НП відходив, настала наступна година"
    # чат: приватне — лише адресату
    third = await player(core, "Глядач")
    await join(third, rid)
    friend.drain_games("chat"); third.drain_games("chat")
    await host.game("chat", {"to": 1, "text": "Пропоную перемир’я"})
    await host.game("chat", {"to": "all", "text": "Усім привіт"})
    await friend.wait_game("chat", lambda d: d["text"] == "Усім привіт")
    assert any(m["text"] == "Пропоную перемир’я" for m in friend.drain_games("chat")), "адресат отримав приватне"
    await third.wait_game("chat", lambda d: d["text"] == "Усім привіт")
    assert not any(m["text"] == "Пропоную перемир’я" for m in third.drain_games("chat"))
    # повернення: друг перепідключається — знову бачить свою сторону
    await friend.ws.close()
    friend2 = C(await websockets.connect(f"ws://127.0.0.1:{core.gateway_port}/hgs/v1/ws", origin=ORIGIN, max_size=8 * 1024 * 1024, max_queue=None))
    await friend2.send("hello", {"game": GAME, "auth": {"type": "account", "username": "Друг", "password": "secret123"}})
    assert (await friend2.recv())["t"] == "welcome"
    await join(friend2, rid)
    vb = (await friend2.wait_game("view"))["view"]
    assert vb["view"]["faction"] == 1 and vb["time"]["turn"] == 2
    for c in (host, friend2, third):
        await c.ws.close()


async def test_save_and_resume_in_new_room(core):
    host = await player(core, "Хост")
    r = await host.request("room.create", {"name": "Кампанія", "params": {"seed": 7, "slots": ["human", "easy", "hard"]}})
    rid = r["d"]["room"]["id"]
    await join(host, rid)
    await host.game("take", {"faction": 0})
    await host.wait_game("room", lambda d: d["slots"][0]["owner"] == host.id)
    await host.game("start")
    await host.wait_game("view")
    await host.game("cmd", {"id": 1, "mod": "Engine", "fn": "endPhase", "args": []})
    assert (await host.wait_game("result", lambda d: d["id"] == 1))["ok"]
    v = (await host.wait_game("view", lambda d: d["view"]["time"]["turn"] == 2))["view"]
    turn = v["time"]["turn"]
    await host.game("end")
    await host.wait_game("room", lambda d: d["phase"] == "setup")
    # нова кімната: у хоста є збереження цієї гри — продовжуємо
    await host.request("room.leave", {})
    r = await host.request("room.create", {"name": "Продовження", "params": {}})
    rid2 = r["d"]["room"]["id"]
    await join(host, rid2)
    saves = await host.wait_game("saves", lambda d: len(d) > 0)
    assert saves[0]["name"] == "Кампанія" and saves[0]["turn"] == turn
    await host.game("resume", {"save": saves[0]["id"]})
    v2 = (await host.wait_game("view"))["view"]
    assert v2["time"]["turn"] == turn and v2["view"]["faction"] == 0, "гра продовжилась з того самого ходу"
    info = await host.wait_game("room", lambda d: d["phase"] == "game")
    assert [s["kind"] for s in info["slots"]] == ["human", "easy", "hard"], "сторони — як були"
    await host.ws.close()
