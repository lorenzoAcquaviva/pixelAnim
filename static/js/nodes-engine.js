// nodes-engine.js: motore a nodi (nessun DOM): definizioni dei nodi, valutazione e rasterizzazione.
// Ogni nodo produce un "livello": una funzione (x, y) => bool valutata al centro di ogni pixel.
(function (root) {
  'use strict';

  /* ── Utilità ── */
  const EPS = 1e-6;
  const mod = (a, n) => ((a % n) + n) % n;
  const tri = (d, P) => (P > 0 ? P - Math.abs(mod(d, 2 * P) - P) : d);   // 0 → P → 0
  const EMPTY = () => 0;
  const num = (v, d) => { v = parseFloat(v); return isFinite(v) ? v : (d || 0); };
  const clampCol = v => { v = Math.round(num(v, 1)); return v < 1 ? 1 : v > 15 ? 15 : v; };

  function drive(v0, speed, t, mode, range) {
    const d = speed * t;
    if (!(range > 0) || mode === 'continuo') return v0 + d;
    return v0 + (mode === 'ciclo' ? mod(d, range) : tri(d, range));
  }

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function inTri(px, py, ax, ay, bx, by, cx, cy) {
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (!d) return false;
    const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
    const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
    return l1 >= -EPS && l2 >= -EPS && (1 - l1 - l2) >= -EPS;
  }

  const union = list => (list.length === 0 ? EMPTY
    : list.length === 1 ? list[0]
    : (x, y) => { for (let i = list.length - 1; i >= 0; i--) { const v = list[i](x, y); if (v) return v; } return 0; });

  /* ── Font 5×7 ── */
  const FONT_SRC = {
    ' ': '00000/00000/00000/00000/00000/00000/00000',
    '0': '01110/10001/10011/10101/11001/10001/01110',
    '1': '00100/01100/00100/00100/00100/00100/01110',
    '2': '01110/10001/00001/00010/00100/01000/11111',
    '3': '11111/00010/00100/00010/00001/10001/01110',
    '4': '00010/00110/01010/10010/11111/00010/00010',
    '5': '11111/10000/11110/00001/00001/10001/01110',
    '6': '00110/01000/10000/11110/10001/10001/01110',
    '7': '11111/00001/00010/00100/01000/01000/01000',
    '8': '01110/10001/10001/01110/10001/10001/01110',
    '9': '01110/10001/10001/01111/00001/00010/01100',
    'A': '01110/10001/10001/11111/10001/10001/10001',
    'B': '11110/10001/10001/11110/10001/10001/11110',
    'C': '01110/10001/10000/10000/10000/10001/01110',
    'D': '11100/10010/10001/10001/10001/10010/11100',
    'E': '11111/10000/10000/11110/10000/10000/11111',
    'F': '11111/10000/10000/11110/10000/10000/10000',
    'G': '01110/10001/10000/10111/10001/10001/01111',
    'H': '10001/10001/10001/11111/10001/10001/10001',
    'I': '01110/00100/00100/00100/00100/00100/01110',
    'J': '00111/00010/00010/00010/00010/10010/01100',
    'K': '10001/10010/10100/11000/10100/10010/10001',
    'L': '10000/10000/10000/10000/10000/10000/11111',
    'M': '10001/11011/10101/10101/10001/10001/10001',
    'N': '10001/10001/11001/10101/10011/10001/10001',
    'O': '01110/10001/10001/10001/10001/10001/01110',
    'P': '11110/10001/10001/11110/10000/10000/10000',
    'Q': '01110/10001/10001/10001/10101/10010/01101',
    'R': '11110/10001/10001/11110/10100/10010/10001',
    'S': '01111/10000/10000/01110/00001/00001/11110',
    'T': '11111/00100/00100/00100/00100/00100/00100',
    'U': '10001/10001/10001/10001/10001/10001/01110',
    'V': '10001/10001/10001/10001/10001/01010/00100',
    'W': '10001/10001/10001/10101/10101/10101/01010',
    'X': '10001/10001/01010/00100/01010/10001/10001',
    'Y': '10001/10001/10001/01010/00100/00100/00100',
    'Z': '11111/00001/00010/00100/01000/10000/11111',
    '.': '00000/00000/00000/00000/00000/01100/01100',
    ',': '00000/00000/00000/00000/01100/00100/01000',
    '!': '00100/00100/00100/00100/00100/00000/00100',
    '?': '01110/10001/00001/00010/00100/00000/00100',
    ':': '00000/01100/01100/00000/01100/01100/00000',
    '-': '00000/00000/00000/11111/00000/00000/00000',
    '+': '00000/00100/00100/11111/00100/00100/00000',
    '=': '00000/00000/11111/00000/11111/00000/00000',
    '*': '00000/10101/01110/11111/01110/10101/00000',
    '/': '00001/00001/00010/00100/01000/10000/10000',
    '(': '00010/00100/01000/01000/01000/00100/00010',
    ')': '01000/00100/00010/00010/00010/00100/01000',
    "'": '00100/00100/01000/00000/00000/00000/00000',
    '_': '00000/00000/00000/00000/00000/00000/11111',
    '%': '11001/11010/00010/00100/01000/01011/10011',
    '<': '00010/00100/01000/10000/01000/00100/00010',
    '>': '01000/00100/00010/00001/00010/00100/01000',
    '#': '01010/01010/11111/01010/11111/01010/01010',
    '♥': '01010/11111/11111/11111/01110/00100/00000'
  };
  const GLYPHS = {};
  Object.keys(FONT_SRC).forEach(k => { GLYPHS[k] = FONT_SRC[k].split('/'); });

  const bmCache = new Map();
  function textBitmap(str) {
    str = String(str == null ? '' : str).toUpperCase();
    if (bmCache.has(str)) return bmCache.get(str);
    const chars = Array.from(str);
    const w = chars.length ? chars.length * 6 - 1 : 0;
    const rows = [];
    for (let r = 0; r < 7; r++) {
      const row = new Uint8Array(w);
      chars.forEach((ch, i) => {
        const g = GLYPHS[ch] || GLYPHS['?'];
        for (let c = 0; c < 5; c++) row[i * 6 + c] = g[r].charCodeAt(c) === 49 ? 1 : 0;
      });
      rows.push(row);
    }
    const bm = { w: w, rows: rows };
    if (bmCache.size > 200) bmCache.clear();
    bmCache.set(str, bm);
    return bm;
  }

  const isNum = v => typeof v === 'number' && isFinite(v);

  function localTime(n, t) {
    const r = n.r || {};
    const a = isNum(r.from) ? r.from - 1 : null, b = isNum(r.to) ? r.to - 1 : null;
    if (a === null && b === null) return t;
    if (a !== null && b !== null && a > b) return null;
    let tt = t;
    if ((a !== null && t < a) || (b !== null && t > b)) {
      if (r.fuori === 'blocca' && NODES[n.type].timed) tt = (a !== null && t < a) ? a : b;
      else return null;
    }
    return a !== null ? tt - a : tt;
  }

  function sanitizeRange(r) {
    r = r || {};
    const frame = v => (isNum(v) && v >= 1 ? Math.round(v) : null);
    return { from: frame(r.from), to: frame(r.to), fuori: r.fuori === 'blocca' ? 'blocca' : 'spento' };
  }

  /* ── Definizione dei nodi ── */
  const MODI = ['continuo', 'ciclo', 'rimbalzo'];
  const first = list => list[0] || null;

  const NODES = {
bitmap8x8: {
      title: 'Bitmap', group: 'Forme',
      ins: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }],
      params: [
        { k: 'x', label: 'x', type: 'num', step: 1 },
        { k: 'y', label: 'y', type: 'num', step: 1 },
        { k: 'w', label: 'Larghezza', type: 'num', step: 1 },
        { k: 'h', label: 'Altezza', type: 'num', step: 1 },
        { k: 'mode', label: 'Modalità', type: 'sel', opts: ['mono', 'colore'] },
        { k: 'col', label: 'Colore', type: 'col' },
        { k: 'paint', label: 'Colore pixel', type: 'col' },
        { k: 'pixels', label: 'Disegno', type: 'bitmap' },
        { k: 'scale', label: 'Scala', type: 'num', step: 1 }
      ],
      def: c => ({ x: 0, y: 0, w: 8, h: 8, mode: 'mono', col: 1, paint: 1, pixels: '0'.repeat(256), scale: 1 }),
      make(p, ins) {
        const w = Math.max(1, Math.min(16, Math.round(num(p.w, 8))));
        const h = Math.max(1, Math.min(16, Math.round(num(p.h, 8))));
        const raw = String(p.pixels || '').toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(256, '0').slice(0, 256);
        const pixels = [];
        for (let r = 0; r < 16; r++) {
          const row = [];
          for (let c = 0; c < 16; c++) row.push(parseInt(raw[r * 16 + c], 16) || 0);
          pixels.push(row);
        }
        const fX = first(ins.x), fY = first(ins.y);
        const evalCoord = (f, defVal) => {
          if (!f) return defVal;
          if (f.isNumericValue) return f.staticValue;
          const res = f(0, 0);
          return typeof res === 'number' ? res : defVal;
        };
        const mono = p.mode !== 'colore';
        const monoColor = clampCol(p.col);
        const scale = Math.max(1, Math.round(num(p.scale, 1)));
        return (x, y) => {
          const px = evalCoord(fX, num(p.x)), py = evalCoord(fY, num(p.y));
          const localX = Math.floor((x - px) / scale);
          const localY = Math.floor((y - py) / scale);
          if (localX < 0 || localX >= w || localY < 0 || localY >= h) return 0;
          const value = pixels[localY][localX];
          return value ? (mono ? monoColor : value) : 0;
        };
      }
    },

  punto: {
      title: 'PuntoXY', group: 'Forme',
      ins: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }],
      params: [
        { k: 'x', label: 'x', type: 'num', step: 1 }, 
        { k: 'y', label: 'y', type: 'num', step: 1 }
      ],
      def: c => ({ x: Math.floor(c.W / 2), y: Math.floor(c.H / 2) }),
      make(p, ins) {
        const fX = first(ins.x), fY = first(ins.y);
        const evalCoord = (f, defVal) => {
          if (!f) return defVal;
          if (f.isNumericValue) return f.staticValue;
          const res = f(0, 0);
          return typeof res === 'number' && res !== 0 ? res : defVal;
        };
        return (x, y) => {
          const px = Math.round(evalCoord(fX, num(p.x)));
          const py = Math.round(evalCoord(fY, num(p.y)));
          return Math.round(x) === px && Math.round(y) === py ? 1 : 0;
        };
      }
    },
    linea: {
      title: 'Linea', group: 'Forme', ins: [],
      params: [
        { k: 'col', label: 'colore', type: 'col' },
        { k: 'x1', label: 'x1', type: 'num', step: 0.5 }, { k: 'y1', label: 'y1', type: 'num', step: 0.5 },
        { k: 'x2', label: 'x2', type: 'num', step: 0.5 }, { k: 'y2', label: 'y2', type: 'num', step: 0.5 },
        { k: 'sp', label: 'spessore', type: 'num', step: 0.5 }
      ],
      def: c => { const y = Math.floor((c.H - 1) / 2); return { col: 1, x1: 0, y1: y, x2: c.W - 1, y2: y, sp: 1 }; },
      make(p) {
        const x1 = num(p.x1), y1 = num(p.y1), x2 = num(p.x2), y2 = num(p.y2), h = Math.max(0, num(p.sp, 1)) / 2 + EPS, col = clampCol(p.col);
        return (x, y) => (distSeg(x, y, x1, y1, x2, y2) <= h ? col : 0);
      }
    },
    cerchio: {
      title: 'Cerchio', group: 'Forme',
      ins: [{ id: 'cx', label: 'x' }, { id: 'cy', label: 'y' }],
      params: [
        { k: 'cx', label: 'centro x', type: 'num', step: 0.5 }, { k: 'cy', label: 'centro y', type: 'num', step: 0.5 },
        { k: 'r', label: 'raggio', type: 'num', step: 0.5 },
        { k: 'pieno', label: 'pieno', type: 'bool' }, { k: 'sp', label: 'spessore', type: 'num', step: 0.5 }
      ],
      def: c => ({ cx: (c.W - 1) / 2, cy: (c.H - 1) / 2, r: 3, pieno: true, sp: 1 }),
      make(p, ins, t, ctx) {
        const fX = first(ins.cx), fY = first(ins.cy);
        const evalCoord = (f, defVal) => {
          if (!f) return defVal;
          if (f.isNumericValue) return f.staticValue;
          const res = f(0, 0);
          return typeof res === 'number' && res !== 0 ? res : defVal;
        };
        return (x, y) => {
          const cx = evalCoord(fX, num(p.cx));
          const cy = evalCoord(fY, num(p.cy));
          const r = Math.max(0, num(p.r)), h = Math.max(0, num(p.sp, 1)) / 2 + EPS;
          const inside = p.pieno
            ? Math.hypot(x - cx, y - cy) <= r + EPS
            : Math.abs(Math.hypot(x - cx, y - cy) - r) <= h;
          return inside ? 1 : 0;
        };
      }
    },
    triangolo: {
      title: 'Triangolo', group: 'Forme',
      ins: [
        { id: 'x', label: 'x' }, 
        { id: 'y', label: 'y' },
        { id: 'w', label: 'base' },
        { id: 'h', label: 'altezza' }
      ],
      params: [
        { k: 'col', label: 'colore', type: 'col' },
        { k: 'x', label: 'x', type: 'num', step: 0.5 }, { k: 'y', label: 'y', type: 'num', step: 0.5 },
        { k: 'w', label: 'base (dispari)', type: 'num', step: 1 }, { k: 'h', label: 'altezza', type: 'num', step: 1 },
        { k: 'rot', label: 'rotazione (°)', type: 'num', step: 15 },
        { k: 'pieno', label: 'pieno', type: 'bool' }, { k: 'sp', label: 'spessore', type: 'num', step: 0.5 }
      ],
      def: c => ({ col: 1, x: Math.floor((c.W - 7) / 2), y: Math.floor((c.H - 4) / 2), w: 7, h: 4, rot: 0, pieno: true, sp: 1 }),
      make(p, ins, t, ctx) {
        const col = clampCol(p.col);
        const fX = first(ins.x), fY = first(ins.y);
        const fW = first(ins.w), fH = first(ins.h);

        const evalVal = (f, defVal) => {
          if (!f) return defVal;
          if (f.isNumericValue) return f.staticValue;
          const res = f(0, 0);
          return typeof res === 'number' ? res : defVal;
        };

        return (px, py) => {
          const x = evalVal(fX, num(p.x));
          const y = evalVal(fY, num(p.y));
          const w = Math.max(1, Math.round(evalVal(fW, num(p.w, 7))));
          const h = Math.max(1, Math.round(evalVal(fH, num(p.h, 4))));
          const rotDeg = num(p.rot, 0);

          // Vertici del triangolo basati su w e h (dinamici o statici)
          const ax = x + (w - 1) / 2, ay = y;
          const bx = x, by = y + h - 1;
          const cx = x + w - 1, cy = by;

          // Centro di rotazione
          const rcx = x + (w - 1) / 2;
          const rcy = y + (h - 1) / 2;

          let testX = px, testY = py;
          if (rotDeg !== 0) {
            const rad = (-rotDeg * Math.PI) / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const dx = px - rcx, dy = py - rcy;
            testX = rcx + dx * cos - dy * sin;
            testY = rcy + dx * sin + dy * cos;
          }

          const hh = Math.max(0, num(p.sp, 1)) / 2 + EPS;
          return p.pieno
            ? (inTri(testX, testY, ax, ay, bx, by, cx, cy) ? col : 0)
            : (Math.min(distSeg(testX, testY, ax, ay, bx, by), distSeg(testX, testY, bx, by, cx, cy), distSeg(testX, testY, cx, cy, ax, ay)) <= hh ? col : 0);
        };
      }
    },
    quadrato: {
      title: 'Quadrato / rettangolo', group: 'Forme', ins: [],
      params: [
        { k: 'col', label: 'colore', type: 'col' },
        { k: 'x', label: 'x', type: 'num', step: 0.5 }, { k: 'y', label: 'y', type: 'num', step: 0.5 },
        { k: 'w', label: 'larghezza', type: 'num', step: 1 }, { k: 'h', label: 'altezza', type: 'num', step: 1 },
        { k: 'pieno', label: 'pieno', type: 'bool' }, { k: 'sp', label: 'spessore', type: 'num', step: 1 }
      ],
      def: c => ({ col: 1, x: Math.floor((c.W - 4) / 2), y: Math.floor((c.H - 4) / 2), w: 4, h: 4, pieno: true, sp: 1 }),
      make(p) {
        const col = clampCol(p.col);
        const x = num(p.x), y = num(p.y), w = num(p.w), h = num(p.h), s = Math.max(0, num(p.sp, 1));
        const inside = (px, py, x0, y0, x1, y1) => px >= x0 - EPS && px < x1 - EPS && py >= y0 - EPS && py < y1 - EPS;
        return p.pieno
          ? (px, py) => (inside(px, py, x, y, x + w, y + h) ? col : 0)
          : (px, py) => (inside(px, py, x, y, x + w, y + h) && !inside(px, py, x + s, y + s, x + w - s, y + h - s) ? col : 0);
      }
    },
    testo: {
      title: 'Testo', group: 'Forme', ins: [], timed: true,
      params: [
        { k: 'col', label: 'colore', type: 'col' },
        { k: 'text', label: 'testo', type: 'txt' },
        { k: 'x', label: 'x', type: 'num', step: 1 }, { k: 'y', label: 'y', type: 'num', step: 1 },
        { k: 'vx', label: 'scorri (px/frame)', type: 'num', step: 0.5 },
        { k: 'loop', label: 'ripeti', type: 'bool' }, { k: 'gap', label: 'spazio tra ripetizioni', type: 'num', step: 1 }
      ],
      def: c => ({ col: 1, text: 'CIAO', x: 0, y: 1, vx: -1, loop: true, gap: c.W }),
      info: p => {
        const w = textBitmap(p.text).w, v = Math.abs(num(p.vx));
        return v && p.loop ? 'ciclo completo: ' + Math.max(1, Math.round((w + Math.max(0, num(p.gap))) / v)) + ' frame' : 'larghezza: ' + w + ' px';
      },
      make(p, ins, t) {
        const bm = textBitmap(p.text), w = bm.w, col = clampCol(p.col);
        const vx = num(p.vx), x0 = num(p.x) + vx * t, y0 = Math.round(num(p.y));
        const per = w + Math.max(0, num(p.gap));
        const wrap = !!p.loop && vx !== 0 && per > 0;
        return (x, y) => {
          const r = Math.round(y) - y0;
          if (r < 0 || r >= 7) return 0;
          let u = Math.round(x - x0);
          if (wrap) u = mod(u, per);
          return u >= 0 && u < w && bm.rows[r][u] === 1 ? col : 0;
        };
      }
    },
    muovi: {
      title: 'Muovi', group: 'Trasforma', ins: [{ id: 'in', label: 'in' }], timed: true,
      params: [
        { k: 'vx', label: 'velocità x (px/frame)', type: 'num', step: 0.5 }, { k: 'vy', label: 'velocità y (px/frame)', type: 'num', step: 0.5 },
        { k: 'x0', label: 'offset x', type: 'num', step: 1 }, { k: 'y0', label: 'offset y', type: 'num', step: 1 },
        { k: 'modo', label: 'modo', type: 'sel', opts: MODI },
        { k: 'px', label: 'periodo x (0=auto)', type: 'num', step: 1 }, { k: 'py', label: 'periodo y (0=auto)', type: 'num', step: 1 }
      ],
      def: () => ({ vx: 1, vy: 0, x0: 0, y0: 0, modo: 'ciclo', px: 0, py: 0 }),
      make(p, ins, t, ctx) {
        const f = first(ins.in);
        if (!f) return EMPTY;
        const vx = num(p.vx), vy = num(p.vy), px = num(p.px), py = num(p.py);
        let dx, dy;
        if (p.modo === 'rimbalzo') {
          dx = num(p.x0) + tri(vx * t, px > 0 ? px : ctx.W - 1);
          dy = num(p.y0) + tri(vy * t, py > 0 ? py : ctx.H - 1);
        } else {
          dx = num(p.x0) + vx * t;
          dy = num(p.y0) + vy * t;
        }
        const wx = p.modo === 'ciclo' ? (px > 0 ? px : ctx.W) : 0;
        const wy = p.modo === 'ciclo' ? (py > 0 ? py : ctx.H) : 0;
        return (x, y) => {
          let u = x - dx, v = y - dy;
          if (wx) u = mod(u, wx);
          if (wy) v = mod(v, wy);
          return f(u, v);
        };
      }
    },
    ruota: {
      title: 'Ruota', group: 'Trasforma', ins: [{ id: 'in', label: 'in' }], timed: true,
      params: [
        { k: 'a0', label: 'angolo iniziale (°)', type: 'num', step: 5 }, { k: 'vel', label: 'velocità (°/frame)', type: 'num', step: 5 },
        { k: 'modo', label: 'modo', type: 'sel', opts: MODI }, { k: 'range', label: 'ampiezza (°)', type: 'num', step: 15 },
        { k: 'cx', label: 'centro x', type: 'num', step: 0.5 }, { k: 'cy', label: 'centro y', type: 'num', step: 0.5 }
      ],
      def: c => ({ a0: 0, vel: 15, modo: 'continuo', range: 360, cx: (c.W - 1) / 2, cy: (c.H - 1) / 2 }),
      make(p, ins, t) {
        const f = first(ins.in);
        if (!f) return EMPTY;
        const a = drive(num(p.a0), num(p.vel), t, p.modo, num(p.range)) * Math.PI / 180;
        const co = Math.cos(a), si = Math.sin(a), cx = num(p.cx), cy = num(p.cy);
        return (x, y) => {
          const dx = x - cx, dy = y - cy;
          return f(cx + dx * co + dy * si, cy - dx * si + dy * co);
        };
      }
    },
    scala: {
      title: 'Scala', group: 'Trasforma', ins: [{ id: 'in', label: 'in' }], timed: true,
      params: [
        { k: 's0', label: 'scala iniziale', type: 'num', step: 0.1 }, { k: 'vel', label: 'variazione per frame', type: 'num', step: 0.05 },
        { k: 'modo', label: 'modo', type: 'sel', opts: MODI }, { k: 'range', label: 'ampiezza', type: 'num', step: 0.5 },
        { k: 'cx', label: 'centro x', type: 'num', step: 0.5 }, { k: 'cy', label: 'centro y', type: 'num', step: 0.5 }
      ],
      def: c => ({ s0: 0.5, vel: 0.1, modo: 'rimbalzo', range: 1, cx: (c.W - 1) / 2, cy: (c.H - 1) / 2 }),
      make(p, ins, t) {
        const f = first(ins.in);
        if (!f) return EMPTY;
        const s = Math.max(0.05, drive(num(p.s0, 1), num(p.vel), t, p.modo, num(p.range)));
        const cx = num(p.cx), cy = num(p.cy);
        return (x, y) => f(cx + (x - cx) / s, cy + (y - cy) / s);
      }
    },
    specchia: {
      title: 'Specchia', group: 'Trasforma', ins: [{ id: 'in', label: 'in' }],
      params: [
        { k: 'h', label: 'orizzontale', type: 'bool' }, { k: 'v', label: 'verticale', type: 'bool' },
        { k: 'cx', label: 'centro x', type: 'num', step: 0.5 }, { k: 'cy', label: 'centro y', type: 'num', step: 0.5 }
      ],
      def: c => ({ h: true, v: false, cx: (c.W - 1) / 2, cy: (c.H - 1) / 2 }),
      make(p, ins) {
        const f = first(ins.in);
        if (!f) return EMPTY;
        const cx = num(p.cx), cy = num(p.cy);
        return (x, y) => f(p.h ? 2 * cx - x : x, p.v ? 2 * cy - y : y);
      }
    },
    lampeggia: {
      title: 'Lampeggia', group: 'Trasforma', ins: [{ id: 'in', label: 'in' }],
      params: [
        { k: 'on', label: 'frame accesi', type: 'num', step: 1 }, { k: 'off', label: 'frame spenti', type: 'num', step: 1 },
        { k: 'fase', label: 'fase', type: 'num', step: 1 }
      ],
      def: () => ({ on: 1, off: 1, fase: 0 }),
      make(p, ins, t) {
        const f = first(ins.in);
        if (!f) return EMPTY;
        const on = Math.max(0, Math.round(num(p.on, 1))), off = Math.max(0, Math.round(num(p.off, 1)));
        if (on + off === 0) return f;
        return mod(t + Math.round(num(p.fase)), on + off) < on ? f : EMPTY;
      }
    },
    scia: {
      title: 'Scia', group: 'Trasforma', ins: [{ id: 'in', label: 'in' }],
      params: [
        { k: 'n', label: 'ripetizioni', type: 'num', step: 1 }, { k: 'passo', label: 'frame di distanza', type: 'num', step: 1 },
        { k: 'eco', label: 'colore degli echi', type: 'col', none: true }
      ],
      def: () => ({ n: 3, passo: 1, eco: 0 }),
      make(p, ins, t, ctx, up, tg) {
        const n = Math.max(0, Math.min(30, Math.round(num(p.n)))), step = Math.max(1, Math.round(num(p.passo, 1)));
        const ec = Math.round(num(p.eco)), list = [];
        for (let k = n; k >= 0; k--) {
          let f = first(up('in', tg - k * step));
          if (!f) continue;
          if (k > 0 && ec > 0) { const c = clampCol(ec), g = f; f = (x, y) => (g(x, y) ? c : 0); }
          list.push(f);
        }
        return union(list);
      }
    },
    combina: {
      title: 'Combina', group: 'Combina', ins: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      params: [{ k: 'modo', label: 'operazione', type: 'sel', opts: ['unione', 'sottrai', 'intersezione', 'xor'] }],
      def: () => ({ modo: 'sottrai' }),
      make(p, ins) {
        const a = first(ins.a) || EMPTY, b = first(ins.b) || EMPTY;
        switch (p.modo) {
          case 'unione': return (x, y) => b(x, y) || a(x, y);
          case 'intersezione': return (x, y) => (b(x, y) ? a(x, y) : 0);
          case 'xor': return (x, y) => { const va = a(x, y), vb = b(x, y); return va && vb ? 0 : (va || vb); };
          default: return (x, y) => (b(x, y) ? 0 : a(x, y));
        }
      }
    },
    colora: {
      title: 'Colora', group: 'Colore', ins: [{ id: 'in', label: 'in' }],
      params: [{ k: 'col', label: 'colore', type: 'col' }],
      def: () => ({ col: 2 }),
      make(p, ins) {
        const f = first(ins.in);
        if (!f) return EMPTY;
        const c = clampCol(p.col);
        return (x, y) => (f(x, y) ? c : 0);
      }
    },
    gradiente: {
      title: 'Gradiente di colori', group: 'Colore', ins: [{ id: 'in', label: 'in' }], timed: true,
      params: [
        { k: 'da', label: 'dal colore', type: 'col' }, { k: 'a', label: 'al colore', type: 'col' },
        { k: 'dir', label: 'direzione', type: 'sel', opts: ['righe', 'colonne', 'diagonale'] },
        { k: 'passo', label: 'colori per pixel', type: 'num', step: 0.5 },
        { k: 'vel', label: 'scorrimento (colori/frame)', type: 'num', step: 0.25 }
      ],
      def: () => ({ da: 2, a: 8, dir: 'righe', passo: 1, vel: 0.5 }),
      make(p, ins, t) {
        const f = first(ins.in);
        if (!f) return EMPTY;
        let a = clampCol(p.da), b = clampCol(p.a);
        if (a > b) { const tmp = a; a = b; b = tmp; }
        const n = b - a + 1, step = num(p.passo, 1), shift = Math.floor(num(p.vel) * t);
        const dir = p.dir;
        return (x, y) => {
          if (!f(x, y)) return 0;
          const pos = dir === 'colonne' ? x : dir === 'diagonale' ? x + y : y;
          return a + mod(Math.floor(pos * step) + shift, n);
        };
      }
    },
    fisso: {
      title: 'Valore Fisso', group: 'Generatori', ins: [], timed: true,
      params: [
        { k: 'val', label: 'valore', type: 'num', step: 1 }
      ],
      def: c => ({ val: 4 }),
      info: p => 'valore: ' + p.val,
      make(p) {
        const v = Math.round(num(p.val));
        const fn = (x, y) => v;
        fn.isNumericValue = true;
        fn.staticValue = v;
        return fn;
      }
    },
    onda: {
      title: 'Onda / Range', group: 'Generatori', ins: [], timed: true,
      params: [
        { k: 'min', label: 'valore min', type: 'num', step: 1 },
        { k: 'max', label: 'valore max', type: 'num', step: 1 },
        { k: 'forma', label: 'curva', type: 'sel', opts: ['lineare', 'sinusoidale'] },
        { k: 'cicli', label: 'cicli per animazione', type: 'num', step: 1 }
      ],
      def: c => ({ min: 0, max: c.H - 1, forma: 'sinusoidale', cicli: 1 }),
      info: p => p.forma + ' (' + p.min + ' → ' + p.max + ')',
      make(p, ins, t, ctx) {
        const totalFrames = (ctx && ctx.totalFrames) || 8;
        const min = num(p.min), max = num(p.max);
        const cicli = Math.max(1, num(p.cicli, 1));
        
        const progress = (t % totalFrames) / totalFrames;
        const angle = progress * Math.PI * 2 * cicli;

        let val;
        if (p.forma === 'sinusoidale') {
          const sine = (Math.sin(angle - Math.PI / 2) + 1) / 2;
          val = min + (max - min) * sine;
        } else {
          const linear = mod(progress * cicli, 1);
          val = min + (max - min) * linear;
        }

        const targetVal = Math.round(val);
        const fn = (x, y) => targetVal;
        fn.isNumericValue = true;
        fn.staticValue = targetVal;
        return fn;
      }
    },
    out: {
      title: 'Uscita', group: 'Uscita', ins: [{ id: 'in', label: 'in', multi: true }], noOut: true, single: true, noRange: true,
      params: [
        { k: 'frame', label: 'numero di frame', type: 'num', step: 1 }, { k: 'fps', label: 'FPS anteprima', type: 'num', step: 1 }
      ],
      def: () => ({ frame: 8, fps: 8 }),
      make(p, ins) { return union(ins.in); }
    }
  };

  /* ── Grafo ── */
  function defaults(type, ctx) { return NODES[type].def(ctx); }

  function addNode(g, type, x, y, over, ctx) {
    const n = { id: g.nextId++, type: type, x: x, y: y, p: Object.assign(defaults(type, ctx), over || {}), r: sanitizeRange(null) };
    g.nodes.push(n);
    return n;
  }
  function addLink(g, from, to, port) { g.links.push({ from: from.id, to: to.id, port: port }); }

  function starterGraph(W, H) {
    const ctx = { W: W, H: H }, g = { nodes: [], links: [], nextId: 1 };
    const l = addNode(g, 'linea', 30, 40, { y1: 0, y2: 0 }, ctx);
    const m = addNode(g, 'muovi', 290, 40, { vx: 0, vy: 1 }, ctx);
    const o = addNode(g, 'out', 550, 40, { frame: H }, ctx);
    addLink(g, l, m, 'in');
    addLink(g, m, o, 'in');
    return g;
  }

  function normalizeGraph(g, W, H) {
    const ctx = { W: W, H: H };
    if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.links)) return starterGraph(W, H);
    g.nodes = g.nodes.filter(n => n && NODES[n.type]);
    g.nodes.forEach(n => {
      const oldParams = n.p || {};
      if (n.type === 'bitmap8x8' && oldParams.pixels == null && oldParams.bits != null) {
        const bits = String(oldParams.bits).toUpperCase().padEnd(16, '0').slice(0, 16);
        const migrated = Array(256).fill('0');
        for (let r = 0; r < 8; r++) {
          const byte = parseInt(bits.slice(r * 2, r * 2 + 2), 16) || 0;
          for (let c = 0; c < 8; c++) migrated[r * 16 + c] = (byte & (1 << (7 - c))) ? '1' : '0';
        }
        oldParams.pixels = migrated.join('');
        oldParams.w = 8; oldParams.h = 8;
        delete oldParams.bits;
      }
      n.p = Object.assign(defaults(n.type, ctx), oldParams);
      if (n.type === 'bitmap8x8') {
        n.p.w = Math.max(1, Math.min(16, Math.round(num(n.p.w, 8))));
        n.p.h = Math.max(1, Math.min(16, Math.round(num(n.p.h, 8))));
        if (n.p.mode !== 'colore') n.p.mode = 'mono';
      }
      n.x = num(n.x); n.y = num(n.y); n.r = sanitizeRange(n.r);
    });
    const ids = new Set(g.nodes.map(n => n.id));
    g.links = g.links.filter(l => ids.has(l.from) && ids.has(l.to));
    g.nextId = Math.max(num(g.nextId, 1), 1 + Math.max(0, ...g.nodes.map(n => n.id)));
    if (!g.nodes.some(n => n.type === 'out')) addNode(g, 'out', 550, 40, {}, ctx);
    return g;
  }

  function wouldCycle(g, fromId, toId) {
    if (fromId === toId) return true;
    const seen = new Set(), stack = [toId];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === fromId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      g.links.forEach(l => { if (l.from === cur) stack.push(l.to); });
    }
    return false;
  }

  /* ── Valutazione ── */
  function makeEngine(g, ctx) {
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    const incoming = new Map();
    g.links.forEach(l => {
      if (!incoming.has(l.to)) incoming.set(l.to, {});
      const ports = incoming.get(l.to);
      (ports[l.port] = ports[l.port] || []).push(l.from);
    });
    const memo = new Map();
    function layer(id, t, depth) {
      depth = depth || 0;
      if (depth > 64) return EMPTY;
      const key = id + '|' + t;
      if (memo.has(key)) return memo.get(key);
      const n = byId.get(id), d = n && NODES[n.type];
      if (!d) return EMPTY;
      const ports = incoming.get(id) || {}, ins = {};
      d.ins.forEach(port => { ins[port.id] = (ports[port.id] || []).map(src => layer(src, t, depth + 1)); });
      const up = (port, tt) => (ports[port] || []).map(src => layer(src, tt, depth + 1));
      memo.set(key, EMPTY);
      const tl = d.noRange ? t : localTime(n, t);
      let f;
      if (tl === null) f = d.ins.length ? (first(ins[d.ins[0].id]) || EMPTY) : EMPTY;
      else f = d.make(n.p, ins, tl, ctx, up, t);
      memo.set(key, f);
      return f;
    }
    return { layer: layer };
  }

  function frameCount(g) {
    const o = g.nodes.find(n => n.type === 'out');
    return o ? Math.max(1, Math.min(500, Math.round(num(o.p.frame, 1)))) : 1;
  }

  function renderGraph(g, W, H) {
    const o = g.nodes.find(n => n.type === 'out');
    const N = frameCount(g);
    const eng = makeEngine(g, { W: W, H: H, totalFrames: N }), out = [];
    for (let t = 0; t < N; t++) {
      const f = o ? eng.layer(o.id, t) : EMPTY, px = [];
      for (let r = 0; r < H; r++) {
        const row = new Array(W);
        for (let c = 0; c < W; c++) row[c] = f(c, r) || 0;
        px.push(row);
      }
      out.push(px);
    }
    return out;
  }

  const api = {
    NODES: NODES, MODI: MODI, defaults: defaults, addNode: addNode, addLink: addLink,
    starterGraph: starterGraph, normalizeGraph: normalizeGraph, wouldCycle: wouldCycle,
    renderGraph: renderGraph, frameCount: frameCount, textBitmap: textBitmap, localTime: localTime, makeEngine: makeEngine
  };
  root.NodeEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);