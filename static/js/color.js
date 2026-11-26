// color.js: gestione del colore (opzionale). Palette di 16 voci: indice 0 = spento, 1-15 = colori.
// Un pixel vale 0 (spento) o l'indice del colore. Con la modalità colore spenta l'editor funziona come prima:
// disegna con l'indice 1 e mostra tutto in arancione.
(function () {
  'use strict';

  const ORANGE = '#ff6b2b';
  const DEFAULT_PAL = ['#000000', '#ff6b2b', '#ff2d2d', '#ffd21f', '#39ff14', '#00e5c8', '#2f8bff', '#3a3aff',
                       '#a855f7', '#ff3aa8', '#ffffff', '#ff9d2e', '#9dff2e', '#8a5a2b', '#7a7a7a', '#1d4d2b'];
  const K_PAL = 'pixelanim.palette', K_MODE = 'pixelanim.colormode', K_SEL = 'pixelanim.colorsel';
  const isHex = s => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

  let pal = DEFAULT_PAL.slice(), colorMode = false, sel = 1;
  try {
    const p = JSON.parse(localStorage.getItem(K_PAL));
    if (Array.isArray(p) && p.length === 16 && p.every(isHex)) pal = p.map(s => s.toLowerCase());
    pal[0] = '#000000';
    colorMode = localStorage.getItem(K_MODE) === '1';
    const s = parseInt(localStorage.getItem(K_SEL), 10);
    if (s >= 1 && s <= 15) sel = s;
  } catch (e) {}

  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const colorOf = v => (colorMode ? (pal[v] || ORANGE) : ORANGE);
  const glow = hex => { const c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.5)'; };

  /* ── Pennello ── */
  window.pxColor = v => colorOf(v);
  window.paintColor = () => (colorMode ? sel : 1);
  // valore da scrivere quando si clicca un pixel che contiene "cur" (clic sul colore già scelto = cancella)
  window.pickPaint = cur => (colorMode ? (cur === sel ? 0 : sel) : (cur ? 0 : 1));

  /* ── Disegno delle celle ── */
  function paintCell(px, v) {
    if (v) {
      const hex = colorOf(v);
      px.classList.add('on');
      px.style.setProperty('--px', hex);
      px.style.setProperty('--pxg', glow(hex));
    } else {
      px.classList.remove('on');
      px.style.removeProperty('--px');
      px.style.removeProperty('--pxg');
    }
  }

  window.syncPixels = function (pixels) {
    const grid = document.querySelector('.pixel-grid');
    if (!grid) return;
    grid.querySelectorAll('.pixel').forEach(px => {
      const row = pixels[+px.dataset.r];
      paintCell(px, (row && row[+px.dataset.c]) || 0);
    });
  };

  window.setPixel = function (r, c, val) {
    const frame = frames[currentFrameIndex];
    if (!frame || frame.pixels[r][c] === val) return;
    frame.pixels[r][c] = val;
    markDirty();
    const px = document.querySelector('.pixel[data-r="' + r + '"][data-c="' + c + '"]');
    if (px) paintCell(px, val);
  };

  window.floodFill = function (r, c, target) {
    const frame = frames[currentFrameIndex];
    if (!frame) return;
    const H = frame.pixels.length, W = frame.pixels[0].length;
    const brush = window.paintColor();
    const replacement = target === brush ? 0 : brush;
    if (target === replacement) return;
    const stack = [[r, c]];
    while (stack.length) {
      const p = stack.pop(), cr = p[0], cc = p[1];
      if (cr < 0 || cr >= H || cc < 0 || cc >= W) continue;
      if (frame.pixels[cr][cc] !== target) continue;
      frame.pixels[cr][cc] = replacement;
      stack.push([cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]);
    }
    markDirty();
    syncPixels(frame.pixels);
    drawOnionCanvas();
  };

  /* ── Miniature e anteprima ── */
  window.drawMini = function (canvas, pixels, W) {
    const ctx = canvas.getContext('2d');
    const H = pixels.length;
    ctx.clearRect(0, 0, W, H);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const v = pixels[r] && pixels[r][c];
        ctx.fillStyle = v ? colorOf(v) : '#28314d';
        ctx.fillRect(c, r, 1, 1);
      }
    }
  };

  window.drawPreviewFrame = function () {
    const anim = animations.find(a => a.id === currentAnimId);
    if (!anim) return;
    const W = anim.width, H = anim.height || 8;
    const scale = Math.max(1, Math.floor(320 / Math.max(W, H)));
    const canvas = document.getElementById('previewCanvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#10131c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const f = frames[previewFrame];
    if (!f) return;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const v = f.pixels[r] && f.pixels[r][c];
        if (v) {
          ctx.fillStyle = colorOf(v);
          ctx.shadowBlur = 12;
          ctx.shadowColor = colorOf(v);
        } else {
          ctx.fillStyle = '#28314d';
          ctx.shadowBlur = 0;
        }
        ctx.fillRect(c * scale + 1, r * scale + 1, scale - 2, scale - 2);
      }
    }
    ctx.shadowBlur = 0;
  };

  /* ── Interfaccia: pulsante e barra della palette ── */
  const tools = document.querySelector('.tools-row');
  const main = document.querySelector('main');
  if (!tools || !main) return;

  const toggle = document.createElement('button');
  toggle.className = 'tool-btn';
  toggle.id = 'toolColor';
  toggle.textContent = '🎨 COLORE';
  toggle.title = 'Disegna con più colori (opzionale). Spento: tutto come prima.';
  tools.insertBefore(toggle, tools.querySelector('.spacer'));

  const row = document.createElement('div');
  row.className = 'palette-row';
  row.id = 'paletteRow';
  row.hidden = true;
  main.insertBefore(row, document.getElementById('canvasArea'));

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(picker);

  function textOn(hex) {
    const c = rgb(hex);
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 > 140 ? '#000' : '#fff';
  }

  function renderPalette() {
    let h = '';
    for (let i = 1; i <= 15; i++) {
      h += '<button class="sw' + (i === sel ? ' sel' : '') + '" data-i="' + i + '" style="background:' + pal[i] +
           ';color:' + textOn(pal[i]) + '" title="Colore ' + i + (i === sel ? ' (clic per modificarlo)' : '') + '">' + (i < 10 ? i : '') + '</button>';
    }
    h += '<button class="tool-btn" id="palEdit" title="Modifica il colore selezionato">✎ MODIFICA</button>' +
         '<button class="tool-btn" id="palReset" title="Ripristina i colori predefiniti">↺</button>';
    row.innerHTML = h;
  }

  let stripTimer = 0;
  function refreshView() {
    const f = frames[currentFrameIndex];
    if (f && document.querySelector('.pixel-grid')) syncPixels(f.pixels);
    clearTimeout(stripTimer);
    stripTimer = setTimeout(() => { if (typeof renderFrameStrip === 'function') renderFrameStrip(); }, 120);
    document.dispatchEvent(new CustomEvent('palettechange'));
  }

  function setSel(i) {
    sel = i;
    store(K_SEL, i);
    renderPalette();
  }
  function setMode(on) {
    colorMode = !!on;
    store(K_MODE, colorMode ? '1' : '0');
    toggle.classList.toggle('active', colorMode);
    row.hidden = !colorMode;
    refreshView();
  }
  function editSel() { picker.value = pal[sel]; picker.click(); }

  row.addEventListener('click', e => {
    const sw = e.target.closest('.sw');
    if (sw) {
      const i = +sw.dataset.i;
      if (i === sel) editSel(); else setSel(i);
    } else if (e.target.closest('#palEdit')) {
      editSel();
    } else if (e.target.closest('#palReset') && confirm('Ripristinare i colori predefiniti della palette?')) {
      pal = DEFAULT_PAL.slice();
      store(K_PAL, JSON.stringify(pal));
      renderPalette();
      refreshView();
    }
  });
  picker.addEventListener('input', () => {
    pal[sel] = picker.value.toLowerCase();
    store(K_PAL, JSON.stringify(pal));
    renderPalette();
    refreshView();
  });
  toggle.addEventListener('click', () => setMode(!colorMode));

  document.addEventListener('keydown', e => {
    if (!colorMode || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    if (/^[1-9]$/.test(e.key)) setSel(+e.key);
  });

  // aprendo un'animazione che contiene già dei colori, la modalità colore si accende da sola
  const _selectAnimation = window.selectAnimation;
  window.selectAnimation = async function (id) {
    const r = await _selectAnimation(id);
    if (!colorMode && frames.some(f => f.pixels.some(rw => rw.some(v => v > 1)))) setMode(true);
    return r;
  };

  /* ── Per la trasmissione live ── */
  window.Palette = {
    list: () => pal.slice(),
    mode: () => colorMode,
    setMode: on => setMode(on),
    selected: () => sel,
    // 96 caratteri esadecimali: 16 colori RRGGBB, con luminosità in %
    palHex(bright) {
      const k = Math.max(1, Math.min(100, bright || 100)) / 100;
      return pal.map((hex, i) => (i === 0 ? '000000'
        : rgb(hex).map(v => Math.round(v * k).toString(16).padStart(2, '0')).join(''))).join('');
    },
    // 64 cifre esadecimali: l'indice colore (0-F) di ogni pixel, riga per riga; rotate = 180°
    pixHex(pixels, rotate) {
      const H = pixels.length || 8;
      const W = (pixels[0] && pixels[0].length) || 8;
      let s = '';
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          const row = pixels[rotate ? H - 1 - r : r];
          const v = (row && row[rotate ? W - 1 - c : c]) || 0;
          s += (v > 15 ? 15 : v < 0 ? 0 : v).toString(16);
        }
      }
      return s;
    }
  };

  renderPalette();
  toggle.classList.toggle('active', colorMode);
  row.hidden = !colorMode;
})();
