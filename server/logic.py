"""Yugotaria: Civil War — серверна логіка гри для HGS (HOME GAME SERVER).

Сервер головний: браузер надсилає лише дії гравця, сервер виконує їх і розсилає кожному
гравцю картину ЙОГО сторони (строгий туман війни: невидимих ворогів, чужої економіки,
розвідки й мін браузер не отримує).

Правила гри написані на JavaScript (src/*.js — ті самі, що в браузері), тому цей клас
запускає їх окремим процесом Node.js (server/engine.js) і передає йому дії. Механіки,
баланс і формат збережень не змінюються. Потрібен Node.js на ПК, де працює HGS.

Кімнати:
  * "lobby" — загальна кімната: чат; звідси гравці бачать список кімнат і створюють свою.
  * кожна інша кімната — окрема кампанія: 3 сторони (гравець / бот легкий / бот важкий),
    номер карти; творець кімнати — хост (якщо його немає в кімнаті, права має той, хто
    зайшов найраніше). Хост починає гру або продовжує збережену.

Збереження ігор — файли в теці даних HGS (HGS_DATA_DIR/game-data/<гра>/), не в теці гри:
оновлення гри (заміна папки) їх не стирає. У знімок HGS (on_save) іде лише короткий перелік.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from hgs_sdk import GameLogic

GAME_DIR = Path(__file__).resolve().parent.parent
KINDS = ("human", "easy", "hard")
FACTIONS = ("Соціалістична влада", "Демократичні повстанці", "Націоналістичні повстанці")
SHORT = ("Соц. влада", "Дем. повстанці", "Нац. повстанці")
LOBBY = "lobby"
MAX_TEXT = 400


class EngineError(RuntimeError):
    pass


class RulesEngine:
    """Процес Node.js з правилами гри (server/engine.js): запит — рядок JSON, відповідь — рядок JSON."""

    def __init__(self, node: str, log) -> None:
        self.node = node
        self.log = log
        self.proc: asyncio.subprocess.Process | None = None
        self.next_id = 1
        self.waiting: dict[int, asyncio.Future] = {}
        self.lock = asyncio.Lock()
        self.generation = 0          # зростає після кожного перезапуску процесу

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            self.node, str(GAME_DIR / "server" / "engine.js"),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            cwd=str(GAME_DIR), limit=64 * 1024 * 1024)
        ready = json.loads(await asyncio.wait_for(self.proc.stdout.readline(), 60))
        if not ready.get("ready"):
            raise EngineError("engine.js не запустився")
        self.generation += 1
        asyncio.create_task(self._read(self.proc))
        asyncio.create_task(self._errors(self.proc))
        self.log.info("Правила гри (Node.js) запущено")

    async def _read(self, proc) -> None:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            fut = self.waiting.pop(msg.get("id"), None)
            if fut and not fut.done():
                fut.set_result(msg)
        for fut in self.waiting.values():
            if not fut.done():
                fut.set_exception(EngineError("процес правил завершився"))
        self.waiting.clear()

    async def _errors(self, proc) -> None:
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            self.log.warning("engine: %s", line.decode("utf-8", "replace").rstrip())

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def call(self, op: str, **kw: Any) -> dict:
        async with self.lock:
            if not self.alive:
                await self.start()
            rid = self.next_id
            self.next_id += 1
            fut = asyncio.get_running_loop().create_future()
            self.waiting[rid] = fut
            self.proc.stdin.write((json.dumps({"id": rid, "op": op, **kw}, ensure_ascii=False) + "\n").encode("utf-8"))
            await self.proc.stdin.drain()
        msg = await asyncio.wait_for(fut, 120)
        if not msg.get("ok"):
            raise EngineError(msg.get("reason") or "помилка правил")
        return msg

    async def stop(self) -> None:
        if self.alive:
            try:
                self.proc.stdin.close()
                await asyncio.wait_for(self.proc.wait(), 5)
            except Exception:
                self.proc.kill()


class Game(GameLogic):
    tick_rate = 0

    def __init__(self) -> None:
        super().__init__()
        self.engine: RulesEngine | None = None
        self.node: str | None = None
        self.data_dir = Path(os.environ.get("HGS_DATA_DIR") or GAME_DIR / "server") / "game-data" / (os.environ.get("HGS_GAME_ID") or "ugotarian-wargame")
        self.index: dict[str, dict] = {}   # save_id -> {name, time, turn, players:{id:name}, updated}
        self.lobby_chat: list[dict] = []

    # ------------------------------------------------------------------ життєвий цикл
    async def on_load(self, data: Any) -> None:
        if isinstance(data, dict) and isinstance(data.get("index"), dict):
            self.index.update(data["index"])

    async def on_start(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        idx = self.data_dir / "index.json"
        if idx.exists():
            try:
                self.index.update(json.loads(idx.read_text("utf-8")))
            except ValueError:
                self.log.warning("index.json пошкоджено — перелік ігор відновиться з нових збережень")
        self.node = shutil.which(str(self.config.get("node") or "node"))
        if not self.node:
            self.log.error("Node.js не знайдено: встановіть його з https://nodejs.org (потрібен для правил гри)")
            return
        self.engine = RulesEngine(self.node, self.log)
        await self.engine.start()

    async def on_save(self) -> Any:
        for room in list(self.rooms.values()):
            await self._save_game(room)
        return {"version": 1, "index": self.index}

    async def on_shutdown(self) -> None:
        for room in list(self.rooms.values()):
            await self._save_game(room)
        if self.engine:
            await self.engine.stop()

    # ------------------------------------------------------------------ кімнати
    def _g(self, room) -> dict | None:
        return room.state if isinstance(room.state, dict) and room.state.get("kind") == "campaign" else None

    async def on_room_created(self, room) -> None:
        if room.id == LOBBY:
            return
        p = room.params or {}
        kinds = p.get("slots") if isinstance(p.get("slots"), list) else []
        room.state = {
            "kind": "campaign", "name": room.name, "phase": "setup",
            "seed": _seed(p.get("seed")),
            "slots": [{"kind": kinds[f] if f < len(kinds) and kinds[f] in KINDS else ("human" if f == 0 else "easy"), "owner": None, "owner_name": None} for f in range(3)],
            "host": None, "order": [], "chat": [], "rev": 0, "save_id": None, "loaded": False,
        }

    async def on_room_closed(self, room) -> None:
        g = self._g(room)
        if g and g["phase"] == "game":
            await self._save_game(room)
            if self.engine and g.get("loaded"):
                try:
                    await self.engine.call("unload", room=room.id)
                except Exception:
                    pass

    async def on_join(self, room, player):
        if room.id == LOBBY:
            return True
        if room.state is None:
            await self.on_room_created(room)
        g = self._g(room)
        if not self.engine:
            return "На сервері гри не встановлено Node.js — мережева гра недоступна."
        if g["host"] is None:
            g["host"] = player.id
        if player.id not in g["order"]:
            g["order"].append(player.id)
        return True

    async def on_leave(self, room, player, reason: str) -> None:
        if room.id == LOBBY:
            return
        g = self._g(room)
        if g:
            if player.id in g["order"]:
                g["order"].remove(player.id)
                g["order"].append(player.id)   # повернеться — стане в кінець черги на права хоста
            await self._push_room(room)

    # ------------------------------------------------------------------ допоміжне
    def _faction(self, g: dict, player) -> int | None:
        for f, s in enumerate(g["slots"]):
            if s["kind"] == "human" and s["owner"] == player.id:
                return f
        return None

    def _host_id(self, room, g: dict) -> str | None:
        if g["host"] in room.players:
            return g["host"]
        for pid in g["order"]:
            if pid in room.players:
                return pid
        return g["host"]

    def _room_info(self, room, g: dict) -> dict:
        return {
            "name": g["name"], "phase": g["phase"], "seed": g["seed"], "host": self._host_id(room, g),
            "slots": [{"faction": f, "name": FACTIONS[f], "kind": s["kind"], "owner": s["owner"], "owner_name": s["owner_name"],
                       "online": bool(s["owner"] and s["owner"] in room.players)} for f, s in enumerate(g["slots"])],
            "players": [{"id": p.id, "name": p.name, "faction": self._faction(g, p)} for p in room.players.values()],
            "game": g.get("info"), "rev": g["rev"],
        }

    def _saves_for(self, pid: str) -> list[dict]:
        out = [dict(v, id=k) for k, v in self.index.items() if pid in (v.get("players") or {})]
        out.sort(key=lambda v: v.get("updated", 0), reverse=True)
        return out[:20]

    async def _push_room(self, room) -> None:
        g = self._g(room)
        if not g:
            return
        info = self._room_info(room, g)
        room.broadcast("room", info)
        host = room.players.get(info["host"])
        if host is not None and g["phase"] == "setup":
            room.send(host, "saves", self._saves_for(host.id))
        free = sum(1 for s in g["slots"] if s["kind"] == "human" and not s["owner"])
        room.update(params={"seed": g["seed"], "phase": g["phase"], "free": free,
                            "time": (g.get("info") or {}).get("time"), "sides": [s["kind"] for s in g["slots"]]})

    async def _push_views(self, room) -> None:
        g = self._g(room)
        if not g or g["phase"] != "game" or not self.engine:
            return
        for p in list(room.players.values()):
            f = self._faction(g, p)
            if f is None:
                continue
            try:
                r = await self.engine.call("view", room=room.id, faction=f)
                room.send(p, "view", {"rev": g["rev"], "view": r["view"]})
            except EngineError as e:
                self.log.warning("картина для %s: %s", p.name, e)

    async def _ensure_loaded(self, room) -> None:
        """Після перезапуску процесу правил відновлюємо гру кімнати з її файлу."""
        g = self._g(room)
        if not g or g["phase"] != "game" or not self.engine:
            return
        if g.get("loaded") and g.get("gen") == self.engine.generation and self.engine.alive:
            return
        data = self._read_save(g.get("save_id"))
        if data is None:
            raise EngineError("збереження гри не знайдено")
        r = await self.engine.call("load", room=room.id, save=data, players=[s["kind"] for s in g["slots"]])
        g["loaded"], g["gen"], g["info"] = True, self.engine.generation, r.get("info")

    def _save_path(self, save_id: str) -> Path:
        return self.data_dir / f"{save_id}.json.gz"

    def _read_save(self, save_id: str | None) -> str | None:
        if not save_id:
            return None
        p = self._save_path(save_id)
        if not p.exists():
            return None
        return gzip.decompress(p.read_bytes()).decode("utf-8")

    async def _save_game(self, room) -> None:
        g = self._g(room)
        if not g or g["phase"] != "game" or not self.engine or not g.get("loaded"):
            return
        try:
            r = await self.engine.call("save", room=room.id)
        except EngineError as e:
            self.log.warning("збереження кімнати %s: %s", room.id, e)
            return
        if not g.get("save_id"):
            g["save_id"] = uuid.uuid4().hex[:12]
        tmp = self._save_path(g["save_id"]).with_suffix(".tmp")
        tmp.write_bytes(gzip.compress(r["save"].encode("utf-8")))
        os.replace(tmp, self._save_path(g["save_id"]))
        players = dict((self.index.get(g["save_id"]) or {}).get("players") or {})
        for s in g["slots"]:
            if s["owner"]:
                players[s["owner"]] = s["owner_name"]
        self.index[g["save_id"]] = {"name": g["name"], "time": r["info"]["time"], "turn": r["info"]["turn"],
                                    "players": players, "sides": [s["kind"] for s in g["slots"]],
                                    "owners": [s["owner"] for s in g["slots"]], "owner_names": [s["owner_name"] for s in g["slots"]],
                                    "seed": g["seed"], "updated": time.time()}
        idx_tmp = self.data_dir / "index.tmp"
        idx_tmp.write_text(json.dumps(self.index, ensure_ascii=False), "utf-8")
        os.replace(idx_tmp, self.data_dir / "index.json")

    def _chat_visible(self, m: dict, g: dict | None, player) -> bool:
        if m["to"] == "all":
            return True
        return m.get("from_id") == player.id or (g is not None and self._faction(g, player) == m["to"])

    def _chat_out(self, m: dict) -> dict:
        return {k: m[k] for k in ("id", "t", "from", "fromFaction", "to", "text", "system") if k in m}

    def _post_chat(self, room, g: dict | None, m: dict) -> None:
        log = g["chat"] if g else self.lobby_chat
        m["id"] = (log[-1]["id"] + 1) if log else 1
        m["t"] = int(time.time() * 1000)
        log.append(m)
        del log[:-150]
        for p in room.players.values():
            if self._chat_visible(m, g, p):
                room.send(p, "chat", self._chat_out(m))

    def _system(self, room, g: dict, text: str) -> None:
        self._post_chat(room, g, {"from": "Сервер", "fromFaction": None, "to": "all", "text": text, "system": True})

    # ------------------------------------------------------------------ події гравців
    async def on_event(self, room, player, event: str, data: Any) -> None:
        d = data if isinstance(data, dict) else {}
        g = self._g(room)
        if event == "chat":
            text = str(d.get("text") or "").strip()[:MAX_TEXT]
            if not text:
                return
            to = d.get("to")
            to = to if to in (0, 1, 2) and g is not None else "all"
            self._post_chat(room, g, {"from": player.name, "from_id": player.id, "fromFaction": self._faction(g, player) if g else None, "to": to, "text": text})
            return
        if event == "hello":
            log = g["chat"] if g else self.lobby_chat
            room.send(player, "chatlog", [self._chat_out(m) for m in log if self._chat_visible(m, g, player)][-80:])
            if g:
                await self._push_room(room)
                if g["phase"] == "game" and self._faction(g, player) is not None:
                    try:
                        await self._ensure_loaded(room)
                        r = await self.engine.call("view", room=room.id, faction=self._faction(g, player))
                        room.send(player, "view", {"rev": g["rev"], "view": r["view"]})
                    except EngineError as e:
                        room.send(player, "notice", {"text": f"Не вдалося відновити гру: {e}"})
            return
        if g is None:
            return
        try:
            if event == "cmd":
                await self._command(room, g, player, d)
            else:
                await self._setup(room, g, player, event, d)
        except EngineError as e:
            self.log.warning("подія %s: %s", event, e)
            room.send(player, "notice", {"text": str(e)})

    async def _command(self, room, g: dict, player, d: dict) -> None:
        cid = d.get("id")
        f = self._faction(g, player)
        if g["phase"] != "game" or f is None:
            room.send(player, "result", {"id": cid, "ok": False, "reason": "Ви не керуєте жодною стороною в цій грі."})
            return
        mod, fn, args = str(d.get("mod") or ""), str(d.get("fn") or ""), d.get("args")
        if not isinstance(args, list) or len(args) > 8:
            room.send(player, "result", {"id": cid, "ok": False, "reason": "Некоректний наказ."})
            return
        await self._ensure_loaded(room)
        r = await self.engine.call("cmd", room=room.id, faction=f, mod=mod, fn=fn, args=args)
        if not r.get("accepted"):
            room.send(player, "result", {"id": cid, "ok": False, "reason": r.get("reason") or "Наказ відхилено."})
            return
        g["rev"] += 1
        g["info"] = r.get("info")
        if r.get("hourEnded"):
            await self._save_game(room)
        # спершу картина тому, хто віддав наказ, потім результат — інтерфейс одразу бачить новий стан
        try:
            v = await self.engine.call("view", room=room.id, faction=f)
            room.send(player, "view", {"rev": g["rev"], "view": v["view"]})
        except EngineError:
            pass
        room.send(player, "result", {"id": cid, "ok": True, "result": r.get("result")})
        for p in list(room.players.values()):
            pf = self._faction(g, p)
            if p.id == player.id or pf is None:
                continue
            try:
                v = await self.engine.call("view", room=room.id, faction=pf)
                room.send(p, "view", {"rev": g["rev"], "view": v["view"]})
            except EngineError:
                pass
        await self._push_room(room)

    async def _setup(self, room, g: dict, player, event: str, d: dict) -> None:
        is_host = self._host_id(room, g) == player.id
        f = d.get("faction")
        ok_f = f in (0, 1, 2)
        if event == "take":
            if not ok_f:
                return
            s = g["slots"][f]
            if s["kind"] != "human":
                room.send(player, "notice", {"text": "Цією стороною керує бот."})
                return
            if s["owner"] and s["owner"] != player.id:
                room.send(player, "notice", {"text": "Сторону вже зайнято."})
                return
            for x in g["slots"]:
                if x["owner"] == player.id:
                    x["owner"], x["owner_name"] = None, None
            s["owner"], s["owner_name"] = player.id, player.name
            self._system(room, g, f"{player.name} грає за «{FACTIONS[f]}».")
        elif event == "leave_side":
            for x in g["slots"]:
                if x["owner"] == player.id:
                    x["owner"], x["owner_name"] = None, None
        elif not is_host:
            room.send(player, "notice", {"text": "Лише хост кімнати."})
            return
        elif event == "slot" and ok_f and d.get("kind") in KINDS:
            s = g["slots"][f]
            s["kind"] = d["kind"]
            if s["kind"] != "human":
                s["owner"], s["owner_name"] = None, None
            if g["phase"] == "game":
                await self._ensure_loaded(room)
                r = await self.engine.call("players", room=room.id, players=[x["kind"] for x in g["slots"]])
                g["info"] = r.get("info")
                g["rev"] += 1
                self._system(room, g, f"«{FACTIONS[f]}» тепер: {_kind_name(s['kind'])}.")
                await self._push_views(room)
        elif event == "kick" and ok_f:
            g["slots"][f]["owner"], g["slots"][f]["owner_name"] = None, None
        elif event == "seed" and g["phase"] == "setup":
            g["seed"] = _seed(d.get("seed"))
        elif event == "start" and g["phase"] == "setup":
            if not any(s["kind"] == "human" and s["owner"] for s in g["slots"]):
                room.send(player, "notice", {"text": "Займіть хоча б одну сторону."})
                return
            r = await self.engine.call("new", room=room.id, seed=g["seed"], players=[s["kind"] for s in g["slots"]])
            g.update(phase="game", loaded=True, gen=self.engine.generation, info=r.get("info"), save_id=uuid.uuid4().hex[:12])
            g["rev"] += 1
            await self._save_game(room)
            self._system(room, g, f"Кампанію розпочато (карта {g['seed']}).")
            await self._push_views(room)
        elif event == "resume" and g["phase"] == "setup":
            sid = str(d.get("save") or "")
            meta = self.index.get(sid)
            data = self._read_save(sid)
            if not meta or data is None or player.id not in (meta.get("players") or {}):
                room.send(player, "notice", {"text": "Збереження не знайдено."})
                return
            # сторони й гравці — як були в тій грі; гравці повертаються на свої сторони, щойно зайдуть
            for i, s in enumerate(g["slots"]):
                s["kind"] = (meta.get("sides") or ["human"] * 3)[i]
                owners, names = meta.get("owners") or [None] * 3, meta.get("owner_names") or [None] * 3
                s["owner"], s["owner_name"] = (owners[i], names[i]) if s["kind"] == "human" else (None, None)
            r = await self.engine.call("load", room=room.id, save=data, players=[s["kind"] for s in g["slots"]])
            g.update(phase="game", loaded=True, gen=self.engine.generation, info=r.get("info"), save_id=sid, seed=meta.get("seed", g["seed"]))
            g["rev"] += 1
            self._system(room, g, f"Продовжено гру «{meta.get('name')}» ({meta.get('time')}).")
            await self._push_views(room)
        elif event == "save" and g["phase"] == "game":
            await self._save_game(room)
            self._system(room, g, "Гру збережено на сервері.")
        elif event == "end" and g["phase"] == "game":
            await self._save_game(room)
            try:
                await self.engine.call("unload", room=room.id)
            except EngineError:
                pass
            g.update(phase="setup", loaded=False, info=None, save_id=None)
            g["rev"] += 1
            self._system(room, g, "Хост завершив гру (її збережено — можна продовжити з лобі кімнати).")
        else:
            return
        await self._push_room(room)


def _seed(v: Any) -> int:
    try:
        return max(1, min(999999, int(v)))
    except (TypeError, ValueError):
        return 1999


def _kind_name(k: str) -> str:
    return {"human": "гравець", "easy": "бот (легкий)", "hard": "бот (важкий)"}.get(k, k)
