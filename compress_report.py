#!/usr/bin/env python3
"""Misura quanto si risparmierebbe comprimendo le TUE animazioni (sola lettura, non modifica nulla).

Uso dentro il container:   docker exec -i pixelanim python - /data/pixelanim.db < compress_report.py
Oppure dal Raspberry:      python3 compress_report.py data/pixelanim.db

Formati confrontati (dimensioni in byte):
  grezzo    1 bit per pixel (8 byte a frame) se l'animazione è monocolore, 4 bit (32 byte a frame) se usa i colori
  Δ righe   un byte di maschera + le sole righe cambiate rispetto al frame precedente (decoder di ~10 righe)
  zlib      riferimento "massimo" (richiede un decompressore sulla scheda)
"""
import json
import sqlite3
import sys
import zlib

path = sys.argv[1] if len(sys.argv) > 1 else "data/pixelanim.db"
con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
anims = con.execute("SELECT id, name, width, height FROM animations ORDER BY id").fetchall()


def rows_of(frame, color):
    """Righe di un frame: mono 1 bit/pixel, colore 4 bit/pixel."""
    out = []
    for row in frame:
        if color:
            px = [min(max(int(v), 0), 15) for v in row]
            out.append(bytes((px[i] << 4) | (px[i + 1] if i + 1 < len(px) else 0)
                             for i in range(0, len(px), 2)))
        else:
            out.append(bytes(sum((1 if row[c] else 0) << (7 - (c % 8))
                                 for c in range(start, min(start + 8, len(row))))
                             for start in range(0, len(row), 8)))
    return out


def row_delta(frames_rows):
    prev, out = None, bytearray()
    for rows in frames_rows:
        base = prev or [bytes(len(row)) for row in rows]
        body = bytearray()
        # One byte mask supports up to 8 rows; larger matrices use a byte mask per 8 rows.
        mask_bytes = bytearray((len(rows) + 7) // 8)
        for r, row in enumerate(rows):
            if row != base[r]:
                mask_bytes[r // 8] |= 1 << (r % 8)
                body += row
        out += mask_bytes
        out += body
        prev = rows
    return len(out)


print("%-24s %6s %-8s | %7s %7s %5s | %7s %5s" % ("animazione", "frame", "formato", "grezzo", "Δ righe", "", "zlib", ""))
tot = [0, 0, 0]
for aid, name, width, height in anims:
    frames = [json.loads(p) for (p,) in con.execute("SELECT pixels FROM frames WHERE animation_id=? ORDER BY frame_index", (aid,))]
    if not frames:
        continue
    color = any(v > 1 for f in frames for row in f for v in row)
    per = [rows_of(f, color) for f in frames]
    raw = b"".join(b"".join(r) for r in per)
    d, z = row_delta(per), len(zlib.compress(raw, 9))
    tot = [tot[0] + len(raw), tot[1] + d, tot[2] + z]
    print("%-24s %6d %-8s | %7d %7d %4.0f%% | %7d %4.0f%%" % (name[:24], len(frames), "colore" if color else "mono", len(raw), d, 100 * d / len(raw), z, 100 * z / len(raw)))
if tot[0]:
    print("-" * 78)
    print("%-24s %6s %-8s | %7d %7d %4.0f%% | %7d %4.0f%%" % ("TOTALE", "", "", tot[0], tot[1], 100 * tot[1] / tot[0], tot[2], 100 * tot[2] / tot[0]))
print("\nBuffer di riferimento: 2048 byte mono e 8192 byte colore; il numero di frame dipende dalla geometria.")
