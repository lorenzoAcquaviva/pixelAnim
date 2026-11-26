import os
import sqlite3
import json

import aioesphomeapi
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="PixelAnim Editor")

DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "pixelanim.db"),
)
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)          # attende fino a 30 s se il database è occupato
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = NORMAL")          # con il WAL è sicuro e fa molte meno scritture su SD
    return conn


def enable_wal():
    """Giornale WAL: letture e scritture non si bloccano a vicenda (impostazione salvata nel file)."""
    try:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.close()
    except sqlite3.Error as e:
        print("WAL non attivato:", e)

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS animations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL DEFAULT 8,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS frames (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            animation_id INTEGER NOT NULL,
            frame_index INTEGER NOT NULL,
            pixels TEXT NOT NULL,
            FOREIGN KEY (animation_id) REFERENCES animations(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()

init_db()

enable_wal()
# ── Models ────────────────────────────────────────────────────────────────────

class AnimationCreate(BaseModel):
    name: str
    width: int
    height: int = 8

class FrameUpdate(BaseModel):
    pixels: List[List[int]]

class AnimationRename(BaseModel):
    name: str

class EspSendRequest(BaseModel):
    ip: str
    port: int = 6053
    api_key: str = ""
    width: Optional[int] = None
    height: Optional[int] = None
    hex_stream: str
    color_r: int = 0
    color_g: int = 255
    color_b: int = 102

# ── Helpers ───────────────────────────────────────────────────────────────────

def make_empty_frame(width: int, height: int = 8):
    return [[0] * width for _ in range(height)]

def get_animation_or_404(conn, anim_id: int):
    anim = conn.execute("SELECT * FROM animations WHERE id = ?", (anim_id,)).fetchone()
    if not anim:
        raise HTTPException(status_code=404, detail="Animation not found")
    return anim

# ── Animations ────────────────────────────────────────────────────────────────

@app.get("/api/animations")
def list_animations():
    conn = get_db()
    rows = conn.execute(
        "SELECT a.*, COUNT(f.id) as frame_count FROM animations a "
        "LEFT JOIN frames f ON f.animation_id = a.id "
        "GROUP BY a.id ORDER BY a.updated_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/animations", status_code=201)
def create_animation(body: AnimationCreate):
    supported = {(8, 8), (32, 8), (16, 16)}
    if (body.width, body.height) not in supported:
        raise HTTPException(400, "Supported matrix sizes are 8x8, 32x8 and 16x16")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO animations (name, width, height) VALUES (?, ?, ?)",
        (body.name, body.width, body.height)
    )
    anim_id = cur.lastrowid
    pixels = make_empty_frame(body.width, body.height)
    conn.execute(
        "INSERT INTO frames (animation_id, frame_index, pixels) VALUES (?, 0, ?)",
        (anim_id, json.dumps(pixels))
    )
    conn.commit()
    conn.close()
    return {"id": anim_id, "name": body.name, "width": body.width, "height": body.height}

@app.patch("/api/animations/{anim_id}")
def rename_animation(anim_id: int, body: AnimationRename):
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    conn.execute(
        "UPDATE animations SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (body.name, anim_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/animations/{anim_id}")
def delete_animation(anim_id: int):
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    conn.execute("DELETE FROM animations WHERE id=?", (anim_id,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ── Frames ────────────────────────────────────────────────────────────────────

@app.get("/api/animations/{anim_id}/frames")
def get_frames(anim_id: int):
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    rows = conn.execute(
        "SELECT * FROM frames WHERE animation_id=? ORDER BY frame_index",
        (anim_id,)
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "frame_index": r["frame_index"], "pixels": json.loads(r["pixels"])} for r in rows]

@app.post("/api/animations/{anim_id}/frames", status_code=201)
def add_frame(anim_id: int, copy_from: Optional[int] = None):
    conn = get_db()
    anim = get_animation_or_404(conn, anim_id)
    last = conn.execute(
        "SELECT MAX(frame_index) as mx FROM frames WHERE animation_id=?", (anim_id,)
    ).fetchone()
    next_index = (last["mx"] if last["mx"] is not None else -1) + 1

    if copy_from is not None:
        src = conn.execute(
            "SELECT pixels FROM frames WHERE animation_id=? AND frame_index=?",
            (anim_id, copy_from)
        ).fetchone()
        pixels_str = src["pixels"] if src else json.dumps(make_empty_frame(anim["width"], anim["height"]))
    else:
        pixels_str = json.dumps(make_empty_frame(anim["width"], anim["height"]))

    cur = conn.execute(
        "INSERT INTO frames (animation_id, frame_index, pixels) VALUES (?, ?, ?)",
        (anim_id, next_index, pixels_str)
    )
    conn.execute(
        "UPDATE animations SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (anim_id,)
    )
    conn.commit()
    frame_id = cur.lastrowid
    conn.close()
    return {"id": frame_id, "frame_index": next_index, "pixels": json.loads(pixels_str)}

@app.put("/api/animations/{anim_id}/frames/{frame_index}")
def update_frame(anim_id: int, frame_index: int, body: FrameUpdate):
    conn = get_db()
    anim = get_animation_or_404(conn, anim_id)
    expected_w, expected_h = int(anim["width"]), int(anim["height"])
    if len(body.pixels) != expected_h or any(len(row) != expected_w for row in body.pixels):
        conn.close()
        raise HTTPException(400, f"Frame dimensions must be {expected_w}x{expected_h}")
    if any(not isinstance(value, int) or value < 0 or value > 15 for row in body.pixels for value in row):
        conn.close()
        raise HTTPException(400, "Pixel values must be integers from 0 to 15")
    row = conn.execute(
        "SELECT id FROM frames WHERE animation_id=? AND frame_index=?",
        (anim_id, frame_index)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Frame not found")
    conn.execute(
        "UPDATE frames SET pixels=? WHERE id=?",
        (json.dumps(body.pixels), row["id"])
    )
    conn.execute(
        "UPDATE animations SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (anim_id,)
    )
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/animations/{anim_id}/frames/{frame_index}")
def delete_frame(anim_id: int, frame_index: int):
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    count = conn.execute(
        "SELECT COUNT(*) as c FROM frames WHERE animation_id=?", (anim_id,)
    ).fetchone()["c"]
    if count <= 1:
        raise HTTPException(400, "Cannot delete the last frame")
    conn.execute(
        "DELETE FROM frames WHERE animation_id=? AND frame_index=?",
        (anim_id, frame_index)
    )
    rows = conn.execute(
        "SELECT id FROM frames WHERE animation_id=? ORDER BY frame_index",
        (anim_id,)
    ).fetchall()
    for i, f in enumerate(rows):
        conn.execute("UPDATE frames SET frame_index=? WHERE id=?", (i, f["id"]))
    conn.execute(
        "UPDATE animations SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (anim_id,)
    )
    conn.commit()
    conn.close()
    return {"ok": True}

# ── ESPHome ───────────────────────────────────────────────────────────────────

@app.post("/api/esp/send")
async def esp_send(body: EspSendRequest):
    """Invia animazione al minis3 via API nativa ESPHome (porta 6053, Noise)."""
    if not body.hex_stream:
        raise HTTPException(400, "hex_stream obbligatorio")
    try:
        if not ipaddress.ip_address(body.ip.strip()).is_private:
            raise HTTPException(400, "Serve un indirizzo IP della rete locale")
    except ValueError:
        raise HTTPException(400, "Indirizzo IP non valido")
    if (body.width is None) != (body.height is None):
        raise HTTPException(400, "width e height devono essere specificati insieme")
    if body.width is not None and (body.width, body.height) not in {(8, 8), (32, 8), (16, 16)}:
        raise HTTPException(400, "Dimensione matrice non supportata")
    if not re.fullmatch(r"[0-9a-fA-F]+", body.hex_stream):
        raise HTTPException(400, "hex_stream deve contenere solo cifre esadecimali")
    stream_bytes = len(body.hex_stream) // 2
    if body.width is not None:
        frame_bytes = body.width * body.height // 8
        if len(body.hex_stream) % (frame_bytes * 2):
            raise HTTPException(400, f"Lunghezza stream non valida: ogni frame deve essere di {frame_bytes} byte")
    elif len(body.hex_stream) % 16:
        raise HTTPException(400, "Lunghezza stream monocromatico non valida")
    if stream_bytes > MONO_MAX_BYTES:
        raise HTTPException(400, f"Animazione troppo grande: buffer monocromatico massimo {MONO_MAX_BYTES} byte")

    cli = aioesphomeapi.APIClient(
        address=body.ip,
        port=body.port,
        password=None,
        noise_psk=body.api_key or os.environ.get("ESP_API_KEY", ""),
    )
    try:
        await cli.connect(login=True)
        services = await cli.list_entities_services()
        user_services = services[1]
        target = next((s for s in user_services if s.name == "carica_animazione"), None)
        if target is None:
            raise HTTPException(404,
                "Service 'carica_animazione' non trovato — hai reflashato il dispositivo?")

        frame_count = (len(body.hex_stream) // (body.width * body.height // 4)) if body.width else "legacy/unknown"
        print(
            f"[ESP SEND] frame={frame_count}, "
            f"hex={len(body.hex_stream)}, "
            f"byte={len(body.hex_stream) // 2}"
        )
        print(f"[ESP SEND] Invio servizio: {target.name}")
        print(f"[ESP SEND] Lunghezza HEX: {len(body.hex_stream)}")

        try:
            await cli.execute_service(target, {
                "hex_data": body.hex_stream,
                "color_r": body.color_r,
                "color_g": body.color_g,
                "color_b": body.color_b,
            })
            print("[ESP SEND] Servizio completato")
        except Exception as e:
            print(f"[ESP SEND] ERRORE durante execute_service: {type(e).__name__}: {e}")
            raise

        return {"ok": True, "bytes": len(body.hex_stream) // 2}
    except HTTPException:
        raise
    except aioesphomeapi.InvalidAuthAPIError:
        raise HTTPException(401, "Chiave API errata")
    except aioesphomeapi.ResolveAPIError:
        raise HTTPException(502, f"Dispositivo non raggiungibile: {body.ip}:{body.port}")
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        try:
            await cli.disconnect()
        except Exception:
            pass

# ── Static ────────────────────────────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ── Bozze (draft) e salvataggio definitivo ───────────────────────────────────

def init_drafts():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS drafts (
            animation_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (animation_id) REFERENCES animations(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()

init_drafts()


class FramesPayload(BaseModel):
    frames: List[List[List[int]]]


def check_frames(anim, frames):
    if not frames:
        raise HTTPException(400, "Serve almeno un frame")
    if len(frames) > 2000:
        raise HTTPException(400, "Troppi frame")
    w, h = anim["width"], anim["height"]
    for fr in frames:
        if len(fr) != h or any(len(row) != w for row in fr):
            raise HTTPException(400, "Dimensioni del frame non valide")
        if any(not isinstance(value, int) or value < 0 or value > 15 for row in fr for value in row):
            raise HTTPException(400, "I pixel devono essere interi da 0 a 15")


@app.get("/api/drafts")
def list_drafts():
    conn = get_db()
    ids = [r["animation_id"] for r in conn.execute("SELECT animation_id FROM drafts")]
    conn.close()
    return ids


@app.get("/api/animations/{anim_id}/draft")
def get_draft(anim_id: int):
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    row = conn.execute(
        "SELECT data, updated_at FROM drafts WHERE animation_id=?", (anim_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Nessuna bozza")
    return {"frames": json.loads(row["data"]), "updated_at": row["updated_at"]}


@app.put("/api/animations/{anim_id}/draft")
def put_draft(anim_id: int, body: FramesPayload):
    conn = get_db()
    anim = get_animation_or_404(conn, anim_id)
    check_frames(anim, body.frames)
    conn.execute(
        "INSERT INTO drafts (animation_id, data, updated_at) "
        "VALUES (?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(animation_id) DO UPDATE SET "
        "data=excluded.data, updated_at=CURRENT_TIMESTAMP",
        (anim_id, json.dumps(body.frames))
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/animations/{anim_id}/draft")
def delete_draft(anim_id: int):
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    conn.execute("DELETE FROM drafts WHERE animation_id=?", (anim_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.put("/api/animations/{anim_id}/frames")
def replace_frames(anim_id: int, body: FramesPayload):
    """Salvataggio definitivo: sostituisce tutti i frame in una transazione e cancella la bozza."""
    conn = get_db()
    anim = get_animation_or_404(conn, anim_id)
    check_frames(anim, body.frames)
    try:
        conn.execute("DELETE FROM frames WHERE animation_id=?", (anim_id,))
        conn.executemany(
            "INSERT INTO frames (animation_id, frame_index, pixels) VALUES (?, ?, ?)",
            [(anim_id, i, json.dumps(fr)) for i, fr in enumerate(body.frames)]
        )
        conn.execute(
            "UPDATE animations SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (anim_id,)
        )
        conn.execute("DELETE FROM drafts WHERE animation_id=?", (anim_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"ok": True, "frame_count": len(body.frames)}


# ── Streaming verso la board (WebSocket) ─────────────────────────────────────
import asyncio
import ipaddress
import re
import time
from fastapi import WebSocket

STREAM_PROTO = 4
STREAM_SERVICE = os.environ.get("STREAM_SERVICE", "mostra_frame")
COLOR_SERVICE = os.environ.get("COLOR_SERVICE", "mostra_frame_colore")
STOP_SERVICE = os.environ.get("STOP_SERVICE", "ferma_stream")
COLOR_LOAD_SERVICE = os.environ.get("COLOR_LOAD_SERVICE", "carica_animazione_colore")
MONO_MAX_BYTES = int(os.environ.get("MONO_MAX_BYTES", "2048"))
COLOR_MAX_BYTES = int(os.environ.get("COLOR_MAX_BYTES", "8192"))
# 1bpp: 8x8 = 8 byte; 32x8 e 16x16 = 32 byte per frame.
HEX_FRAME = re.compile(r"(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{64})")
# 4bpp: 8x8 = 32 byte; 32x8 e 16x16 = 128 byte per frame.
HEX_PIX = re.compile(r"(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{256})")
HEX_PAL = re.compile(r"[0-9a-fA-F]{96}")        # palette: 16 colori RRGGBB

def esp_error(e):
    if isinstance(e, aioesphomeapi.InvalidAuthAPIError):
        return "Chiave API errata"
    if isinstance(e, aioesphomeapi.ResolveAPIError):
        return "Dispositivo non raggiungibile"
    return str(e) or e.__class__.__name__


def clamp8(v):
    try:
        return max(0, min(255, int(v)))
    except (TypeError, ValueError):
        return 0


class EspLink:
    """Connessione persistente a un dispositivo ESPHome (colore singolo o multiplo)."""

    def __init__(self, ip, port, key, color=False):
        self.ip, self.port, self.key, self.color = ip, port, key, color
        self.cli = None
        self.svc = None
        self.stop_svc = None
        self.last_pal = None

    async def open(self):
        await self.close()
        cli = aioesphomeapi.APIClient(
            address=self.ip, port=self.port, password=None, noise_psk=self.key
        )
        await cli.connect(login=True)
        services = await cli.list_entities_services()
        want = COLOR_SERVICE if self.color else STREAM_SERVICE
        svc = next((s for s in services[1] if s.name == want), None)
        if svc is None:
            await cli.disconnect()
            raise RuntimeError("Servizio '%s' non trovato sulla board" % want)
        self.cli, self.svc = cli, svc
        self.stop_svc = next((s for s in services[1] if s.name == STOP_SERVICE), None)
        self.last_pal = None

    async def send(self, hex_data, r, g, b):

        print(
            f"[ESP SEND] HEX={len(hex_data)} "
            f"BYTE={len(hex_data)//2} "
            f"PRIMI={hex_data[:32]}"
        )

        if self.cli is None:
            await self.open()

        await self.cli.execute_service(
            self.svc,
            {
                "hex_data": hex_data,
                "color_r": r,
                "color_g": g,
                "color_b": b,
            },
        )

    async def send_color(self, pix, pal):
        if self.cli is None:
            await self.open()
        # la palette viaggia solo quando cambia (stringa vuota = "mantieni quella di prima")
        await self.cli.execute_service(
            self.svc, {"hex_data": pix, "palette": pal if pal != self.last_pal else ""}
        )
        self.last_pal = pal

    async def restore(self):
        """Fine streaming: la board torna all'animazione/effetto di prima."""
        if self.cli is not None and self.stop_svc is not None:
            try:
                await self.cli.execute_service(self.stop_svc, {})
            except Exception:
                pass

    async def close(self):
        if self.cli is not None:
            try:
                await self.cli.disconnect()
            except Exception:
                pass
        self.cli = self.svc = self.stop_svc = None


class ColorSendRequest(BaseModel):
    ip: str
    port: int = 6053
    api_key: str = ""
    width: Optional[int] = None
    height: Optional[int] = None
    frames: List[str]
    palette: str                   # 96 cifre: 16 colori RRGGBB
    fps: int = 8
    save: bool = True              # True = salva anche nella flash della scheda


@app.post("/api/esp/send_color")
async def esp_send_color(body: ColorSendRequest):
    """Invia alla board un'animazione a colori (palette da 16 voci, 4 bit per pixel)."""
    try:
        private = ipaddress.ip_address(body.ip.strip()).is_private
    except ValueError:
        private = False
    if not private:
        raise HTTPException(400, "Serve un indirizzo IP della rete locale")
    if not body.frames:
        raise HTTPException(400, "Nessun frame da inviare")
    if (body.width is None) != (body.height is None):
        raise HTTPException(400, "width e height devono essere specificati insieme")
    if body.width is not None:
        if (body.width, body.height) not in {(8, 8), (32, 8), (16, 16)}:
            raise HTTPException(400, "Dimensione matrice non supportata")
        expected_hex = body.width * body.height
        if any(len(f) != expected_hex for f in body.frames):
            raise HTTPException(400, f"Ogni frame deve contenere {expected_hex} cifre esadecimali per la matrice {body.width}x{body.height}")
    total_bytes = sum(len(f) // 2 for f in body.frames)
    if total_bytes > COLOR_MAX_BYTES:
        raise HTTPException(400, "Animazione troppo grande: la scheda contiene al massimo %d byte" % COLOR_MAX_BYTES)
    if not HEX_PAL.fullmatch(body.palette) or not all(HEX_PIX.fullmatch(f) for f in body.frames):
        raise HTTPException(400, "Frame o palette non validi: ogni frame deve contenere 64 (8x8) o 256 (32x8/16x16) cifre esadecimali")
    frame_sizes = {len(f) for f in body.frames}
    if len(frame_sizes) != 1:
        raise HTTPException(400, "Tutti i frame devono avere la stessa dimensione")

    n = len(body.frames)
    cli = aioesphomeapi.APIClient(
        address=body.ip.strip(), port=body.port, password=None,
        noise_psk=body.api_key or os.environ.get("ESP_API_KEY", ""),
    )
    try:
        await cli.connect(login=True)
        services = await cli.list_entities_services()
        target = next((s for s in services[1] if s.name == COLOR_LOAD_SERVICE), None)
        if target is None:
            raise HTTPException(404, "Servizio '%s' non trovato: hai aggiornato il firmware?" % COLOR_LOAD_SERVICE)
        await cli.execute_service(target, {
            "hex_data": "".join(f.lower() for f in body.frames),
            "palette": body.palette.lower(),
            "fps": max(1, min(30, int(body.fps))),
            "salva": bool(body.save),
        })
        print("send_color: %d frame (%d byte) verso %s, salva=%s" % (n, total_bytes, body.ip, body.save))
        return {"ok": True, "frames": n, "bytes": total_bytes}
    except HTTPException:
        raise
    except aioesphomeapi.InvalidAuthAPIError:
        raise HTTPException(401, "Chiave API errata")
    except aioesphomeapi.ResolveAPIError:
        raise HTTPException(502, "Dispositivo non raggiungibile: %s:%s" % (body.ip, body.port))
    except Exception as e:
        raise HTTPException(500, str(e) or e.__class__.__name__)
    finally:
        try:
            await cli.disconnect()
        except Exception:
            pass


@app.websocket("/api/esp/stream")
async def esp_stream(ws: WebSocket):
    await ws.accept()
    link = None
    latest = None                 # ultimo frame richiesto: i frame vecchi si scartano
    wake = asyncio.Event()
    tasks = {}
    stats = {"sent": 0, "report": 0.0}

    async def bad(detail):
        print("stream: scartato:", detail)
        try:
            await ws.send_json({"type": "error", "detail": detail})
        except Exception:
            pass

    async def sender():
        nonlocal latest
        while True:
            await wake.wait()
            wake.clear()
            item, latest = latest, None
            if item is None or link is None:
                continue
            try:
                if item[0] == "c":
                    await link.send_color(item[1], item[2])
                else:
                    await link.send(*item[1:])
                stats["sent"] += 1
                if stats["sent"] == 1:
                    print("stream: primo frame consegnato alla board (%s)" % ("colore" if item[0] == "c" else "singolo"))
                now = time.monotonic()
                if now - stats["report"] >= 1.0:          # al massimo un aggiornamento al secondo
                    stats["report"] = now
                    await ws.send_json({"type": "sent", "n": stats["sent"]})
            except Exception as e:
                await link.close()          # si riapre da solo al frame successivo
                try:
                    await ws.send_json({"type": "error", "detail": esp_error(e)})
                except Exception:
                    return
                await asyncio.sleep(1)

    async def player(items, fps, loop):
        nonlocal latest
        period = 1.0 / fps
        nxt = time.monotonic()
        i = 0
        while True:
            latest = items[i]
            wake.set()
            i += 1
            if i >= len(items):
                if not loop:
                    return
                i = 0
            nxt += period
            await asyncio.sleep(max(0.0, nxt - time.monotonic()))

    def stop_player():
        t = tasks.pop("player", None)
        if t:
            t.cancel()

    tasks["sender"] = asyncio.create_task(sender())
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")

            if kind == "open":
                ip = str(msg.get("ip", "")).strip()
                try:
                    ok = ipaddress.ip_address(ip).is_private
                except ValueError:
                    ok = False
                if not ok:
                    await ws.send_json({"type": "error", "detail": "Serve un indirizzo IP della rete locale"})
                    continue
                if link is not None:
                    await link.close()
                if msg.get("width") is not None or msg.get("height") is not None:
                    requested_size = (int(msg.get("width") or 0), int(msg.get("height") or 0))
                    if requested_size not in {(8, 8), (32, 8), (16, 16)}:
                        await bad("Dimensione matrice non supportata")
                        continue
                    matrix_width, matrix_height = requested_size
                else:
                    # Legacy websocket clients do not send geometry; retain length-based validation.
                    matrix_width, matrix_height = None, None
                link = EspLink(ip, int(msg.get("port") or 6053),
                               msg.get("key") or os.environ.get("ESP_API_KEY", ""),
                               bool(msg.get("color")))
                try:
                    await link.open()
                    stats["sent"] = 0
                    print("stream: aperto verso %s (%s)" % (ip, "colore" if link.color else "singolo"))
                    await ws.send_json({"type": "ready", "color": link.color, "proto": STREAM_PROTO})
                except Exception as e:
                    link = None
                    print("stream: apertura fallita:", esp_error(e))
                    await ws.send_json({"type": "error", "detail": esp_error(e)})

            elif kind == "frame":                       # colore singolo
                h = str(msg.get("hex", ""))
                if link is None:
                    await bad("Collegamento non aperto")
                    continue
                if link.color:
                    await bad("Il collegamento è a colori: serve un messaggio 'cframe'")
                    continue
                expected_hex = matrix_width * matrix_height // 4 if matrix_width else None
                if not HEX_FRAME.fullmatch(h) or (expected_hex is not None and len(h) != expected_hex):
                    await bad("Frame monocromatico non valido per la dimensione della matrice")
                    continue
                stop_player()
                latest = ("m", h, clamp8(msg.get("r")), clamp8(msg.get("g")), clamp8(msg.get("b")))
                wake.set()

            elif kind == "cframe":                      # colore multiplo
                pix, pal = str(msg.get("pix", "")), str(msg.get("pal", ""))
                if link is None:
                    await bad("Collegamento non aperto")
                    continue
                if not link.color:
                    await bad("Il collegamento è a colore singolo: riapri lo streaming a colori")
                    continue
                expected_hex = matrix_width * matrix_height if matrix_width else None
                if not HEX_PIX.fullmatch(pix) or (expected_hex is not None and len(pix) != expected_hex) or not HEX_PAL.fullmatch(pal):
                    await bad("Frame a colori non valido per la dimensione della matrice")
                    continue
                stop_player()
                latest = ("c", pix.lower(), pal.lower())
                wake.set()

            elif kind == "play":
                frames = msg.get("frames") or []
                if link is None or link.color:
                    await bad("Collegamento non adatto a questa riproduzione")
                    continue
                expected_hex = matrix_width * matrix_height // 4 if matrix_width else None
                if not frames or not all(HEX_FRAME.fullmatch(str(h)) and (expected_hex is None or len(str(h)) == expected_hex) for h in frames):
                    await bad("Animazione non valida per la dimensione della matrice")
                    continue
                if len(frames) > 4000:
                    await bad(f"Animazione troppo lunga: {len(frames)} frame (massimo consentito: 4000)")
                    continue
                fps = max(1, min(30, int(msg.get("fps") or 8)))
                col = (clamp8(msg.get("r")), clamp8(msg.get("g")), clamp8(msg.get("b")))
                stop_player()
                tasks["player"] = asyncio.create_task(
                    player([("m", str(h)) + col for h in frames], fps, bool(msg.get("loop", True)))
                )

            elif kind == "cplay":
                frames = msg.get("frames") or []
                pal = str(msg.get("pal", ""))
                if link is None or not link.color:
                    await bad("Collegamento non adatto a questa riproduzione")
                    continue
                expected_hex = matrix_width * matrix_height if matrix_width else None
                if not HEX_PAL.fullmatch(pal) or not all(HEX_PIX.fullmatch(str(h)) and (expected_hex is None or len(str(h)) == expected_hex) for h in frames):
                    await bad("Frame a colori o palette non validi per la dimensione della matrice")
                    continue
                if not frames:
                    await bad("Nessun frame ricevuto")
                    continue
                if len(frames) > 4000:
                    await bad(f"Animazione a colori troppo lunga: {len(frames)} frame (massimo consentito: 4000)")
                    continue
                    continue
                fps = max(1, min(30, int(msg.get("fps") or 8)))
                stop_player()
                tasks["player"] = asyncio.create_task(
                    player([("c", str(h).lower(), pal.lower()) for h in frames], fps, bool(msg.get("loop", True)))
                )

            elif kind == "stop":
                stop_player()
            elif kind != "ping":                        # "ping": nessuna azione, tiene viva la connessione
                await bad("Messaggio non supportato: %s" % kind)
    except Exception as e:
        print("stream chiuso:", repr(e))
    finally:
        stop_player()
        t = tasks.pop("sender", None)
        if t:
            t.cancel()
            await asyncio.gather(t, return_exceptions=True)
        if link is not None:
            await link.restore()
            await link.close()


# ── Grafo a nodi (modalità NODI) ─────────────────────────────────────────────
from typing import Any, Dict


def init_graphs():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS graphs (
            animation_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (animation_id) REFERENCES animations(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()

init_graphs()


class GraphPayload(BaseModel):
    graph: Dict[str, Any]


@app.get("/api/animations/{anim_id}/graph")
def get_graph(anim_id: int):
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    row = conn.execute("SELECT data FROM graphs WHERE animation_id=?", (anim_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Nessun grafo salvato")
    return {"graph": json.loads(row["data"])}


@app.put("/api/animations/{anim_id}/graph")
def put_graph(anim_id: int, body: GraphPayload):
    g = body.graph
    if not isinstance(g.get("nodes"), list) or not isinstance(g.get("links"), list):
        raise HTTPException(400, "Grafo non valido")
    if len(g["nodes"]) > 200 or len(g["links"]) > 600:
        raise HTTPException(400, "Grafo troppo grande")
    data = json.dumps(g)
    if len(data) > 300_000:
        raise HTTPException(413, "Grafo troppo grande")
    conn = get_db()
    get_animation_or_404(conn, anim_id)
    conn.execute(
        "INSERT INTO graphs (animation_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(animation_id) DO UPDATE SET data=excluded.data, updated_at=CURRENT_TIMESTAMP",
        (anim_id, data)
    )
    conn.commit()
    conn.close()
    return {"ok": True}
