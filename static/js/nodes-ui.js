// nodes-ui.js: editor a nodi (grafo di forme, testi e trasformazioni → frame)
(function () {
  'use strict';

  const E = window.NodeEngine;
  const header = document.querySelector('header');
  const main = document.querySelector('main');
  if (!E || !header || !main) return;

  const $ = id => document.getElementById(id);
  const raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : f => setTimeout(f, 16);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const DEFAULT_PAL = ['#000000', '#ff6b2b', '#ff2d2d', '#ffd21f', '#39ff14', '#00e5c8', '#2f8bff', '#3a3aff',
                       '#a855f7', '#ff3aa8', '#ffffff', '#ff9d2e', '#9dff2e', '#8a5a2b', '#7a7a7a', '#1d4d2b'];
  const palette = () => ((window.Palette && window.Palette.list) ? window.Palette.list() : DEFAULT_PAL);
  const textOn = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 > 140 ? '#000' : '#fff';
  };
  function swatch(v) {
    if (!v) return { text: '—', style: 'background:transparent;color:var(--text-dim)' };
    const hex = palette()[v] || DEFAULT_PAL[v] || '#ff6b2b';
    return { text: String(v), style: 'background:' + hex + ';color:' + textOn(hex) };
  }

  let graph = null, loadedFor = null, graphDirty = false, saveTimer = 0, renderRaf = 0;
  let drag = null, uid = 0;
  const view = { x: 24, y: 24, s: 1 };
  const prev = { frames: [], i: 0, timer: 0, fps: 0 };

  /* ── Interfaccia ── */
  const btn = document.createElement('button');
  btn.id = 'btnNodes';
  btn.className = 'btn';
  btn.textContent = '🔗 NODI';
  btn.title = 'Modalità nodi: genera animazioni da forme, testi e movimenti';
  header.querySelector('.sep').after(btn);

  const groups = {};
  Object.keys(E.NODES).forEach(k => { const g = E.NODES[k].group; (groups[g] = groups[g] || []).push(k); });
  const options = Object.keys(groups).map(g =>
    '<optgroup label="' + g + '">' +
    groups[g].map(k => '<option value="' + k + '">' + esc(E.NODES[k].title) + '</option>').join('') +
    '</optgroup>').join('');

  const root = document.createElement('div');
  root.id = 'nodeView';
  root.hidden = true;
  root.innerHTML =
    '<div class="ng-bar">' +
      '<span class="ng-title" id="ngTitle">NODI</span>' +
      '<select id="ngAdd"><option value="">＋ Aggiungi nodo…</option>' + options + '</select>' +
      '<span class="ng-zoom">' +
        '<button class="btn" id="ngZoomOut" title="Riduci">−</button>' +
        '<button class="btn" id="ngZoomVal" title="Torna al 100%">100%</button>' +
        '<button class="btn" id="ngZoomIn" title="Ingrandisci">＋</button>' +
        '<button class="btn" id="ngFit" title="Inquadra tutti i nodi">⤢</button>' +
      '</span>' +
      '<span class="save-state" id="ngSaved"></span>' +
      '<button class="btn" id="ngReset" title="Ricomincia da un esempio">↺ ESEMPIO</button>' +
      '<button class="btn primary" id="ngBake" title="Sostituisce i frame dell\'animazione con quelli generati">⚙ GENERA FRAME</button>' +
      '<button class="btn" id="ngClose">✕ CHIUDI</button>' +
    '</div>' +
    '<div class="ng-body">' +
      '<div class="ng-stage" id="ngStage"><div id="ngWorld"><svg id="ngWires"></svg></div></div>' +
      '<div class="ng-preview"><canvas id="ngPrev" width="160" height="160"></canvas><div id="ngPrevInfo"></div></div>' +
    '</div>';
  main.appendChild(root);

  const stage = $('ngStage'), world = $('ngWorld'), wires = $('ngWires'), cv = $('ngPrev');

  /* ── Salvataggio del grafo ── */
  function setSaved(s) {
    const el = $('ngSaved');
    el.dataset.state = s;
    el.textContent = ({ dirty: '● modifiche…', saved: '✓ salvato', error: '✗ non salvato' })[s] || '';
  }
  function scheduleSave(quiet) {
    graphDirty = true;
    if (!quiet) setSaved('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveGraph, 800);
  }
  async function saveGraph() {
    clearTimeout(saveTimer);
    if (!graph || loadedFor == null) return;
    const id = loadedFor;
    try {
      const r = await fetch('/api/animations/' + id + '/graph', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: graph })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (id === loadedFor) { graphDirty = false; setSaved('saved'); }
    } catch (e) { setSaved('error'); }
  }
  function changed() { scheduleRender(); scheduleSave(); }

  async function loadGraph(id) {
    const a = animations.find(x => x.id === id);
    if (!a) return;
    let g = null;
    try {
      const r = await fetch('/api/animations/' + id + '/graph');
      if (r.ok) g = (await r.json()).graph;
    } catch (e) {}
    graph = E.normalizeGraph(g, a.width, a.height || 8);
    const v = graph.view;
    if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.s)) { view.x = v.x; view.y = v.y; view.s = clampScale(v.s); }
    else { view.x = 24; view.y = 24; view.s = 1; }
    loadedFor = id;
    graphDirty = false;
    setSaved('');
    $('ngTitle').textContent = 'NODI · ' + a.name;
    rebuild();
    refreshPreview();
  }

  /* ── Anteprima ── */
  const animSize = () => {
    const a = animations.find(x => x.id === loadedFor);
    return { W: a ? a.width : 8, H: a ? (a.height || 8) : 8 };
  };
  function scheduleRender() {
    if (renderRaf) return;
    renderRaf = raf(() => { renderRaf = 0; refreshPreview(); });
  }
  function refreshPreview() {
    if (!graph || root.hidden) return;
    const s = animSize();
    try {
      prev.frames = E.renderGraph(graph, s.W, s.H);
    } catch (e) {
      console.error('NODI: calcolo dell\'anteprima', e);
      $('ngPrevInfo').textContent = 'errore nel calcolo: ' + (e && e.message ? e.message : e);
      return;
    }
    const out = graph.nodes.find(n => n.type === 'out');
    const fps = Math.max(1, Math.min(30, Math.round(parseFloat(out && out.p.fps) || 8)));
    if (fps !== prev.fps || !prev.timer) {
      clearInterval(prev.timer);
      prev.fps = fps;
      prev.timer = setInterval(tick, 1000 / fps);
    }
    if (prev.i >= prev.frames.length) prev.i = 0;
    draw();
  }
  function stopPreview() { clearInterval(prev.timer); prev.timer = 0; prev.fps = 0; }
  function tick() {
    if (!prev.frames.length || document.hidden) return;
    prev.i = (prev.i + 1) % prev.frames.length;
    draw();
  }
  function markInactive() {
    if (typeof E.localTime !== 'function') return;
    try {
      graph.nodes.forEach(n => {
        const el = nodeEl(n.id);
        if (el) el.classList.toggle('off', !E.NODES[n.type].noRange && E.localTime(n, prev.i) === null);
      });
    } catch (e) { console.error('NODI: attenuazione dei nodi', e); }
  }

  function updateConnectedBadges() {
    if (!graph || typeof E.makeEngine !== 'function') return;
    const s = animSize();
    try {
      const totalF = prev.frames.length || 8;
      const eng = E.makeEngine(graph, { W: s.W, H: s.H, totalFrames: totalF });
      
      world.querySelectorAll('.ng-badge-conn').forEach(badge => {
        const nodeId = +badge.dataset.node;
        const portId = badge.dataset.port;
        const n = nodeById(nodeId);
        if (!n) return;
        
        const incomingLinks = graph.links.filter(l => l.to === nodeId && l.port === portId);
        if (incomingLinks.length === 0) return;
        
        const srcId = incomingLinks[0].from;
        const f = eng.layer(srcId, prev.i);
        
        let val = '—';
        if (f && f.isNumericValue) {
          val = f.staticValue;
        } else if (f) {
          val = f(0, 0) || 0;
        }
        badge.textContent = '🔗 ' + val;
      });
    } catch (e) {}
  }

  function draw() {
    if (graph) markInactive();
    updateConnectedBadges();
    $('ngPrevInfo').textContent = 'frame ' + (prev.i + 1) + ' / ' + prev.frames.length + ' · ' + prev.fps + ' fps';
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    const s = animSize(), k = s.W > 8 ? 8 : 20;
    if (cv.width !== s.W * k || cv.height !== s.H * k) { cv.width = s.W * k; cv.height = s.H * k; }
    ctx.fillStyle = '#0b0d13';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const f = prev.frames[prev.i];
    if (!f) return;
    const pal = palette();
    for (let r = 0; r < s.H; r++) {
      for (let c = 0; c < s.W; c++) {
        const on = f[r] && f[r][c], hex = on ? (pal[on] || '#ff6b2b') : null;
        ctx.fillStyle = on ? hex : '#1b2236';
        ctx.shadowBlur = on ? k / 2 : 0;
        ctx.shadowColor = on ? hex : '#000';
        ctx.fillRect(c * k + 1, r * k + 1, k - 2, k - 2);
      }
    }
    ctx.shadowBlur = 0;
  }

  /* ── Nodi ── */
  const nodeById = id => graph.nodes.find(n => n.id === id);
  const nodeEl = id => world.querySelector('.ng-node[data-id="' + id + '"]');

  function updateInfo(el, n) {
    const d = E.NODES[n.type], box = el.querySelector('.ng-info');
    if (box) box.textContent = d.info ? d.info(n.p) : '';
    const tag = el.querySelector('.ng-badge'), r = n.r || {};
    if (tag) tag.textContent = (r.from || r.to) ? '▸ ' + (r.from || 1) + '–' + (r.to || 'fine') : '';
  }

  function buildNode(n) {
    const d = E.NODES[n.type];
    if (!n.r) n.r = { from: null, to: null, fuori: 'spento' };
    const el = document.createElement('div');
    el.className = 'ng-node' + (n.type === 'out' ? ' out' : '');
    el.dataset.id = n.id;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';

    const ports = d.ins.map(p =>
      '<div class="ng-row"' + (p.multi ? ' title="Puoi collegare più livelli: quelli collegati per ultimi stanno sopra"' : '') + '><span class="sock in" data-port="' + p.id + '"></span>' + esc(p.label) + (p.multi ? ' (anche più livelli)' : '') + '</div>'
    ).join('') + (d.noOut ? '' : '<div class="ng-row right">livello<span class="sock out"></span></div>');

    const params = d.params.map(q => {
      const hasInputPort = d.ins.some(p => p.id === q.k);
      const connected = hasInputPort && isPortConnected(n.id, q.k);

      if (connected) {
        return '<div class="ng-p connected-param"><span>' + esc(q.label) + '</span><span class="ng-badge-conn" data-node="' + n.id + '" data-port="' + q.k + '">🔗 ...</span></div>';
      }

      const v = n.p[q.k];
      let inp;
      if (q.type === 'bool') {
        inp = '<input type="checkbox" data-k="' + q.k + '" data-t="bool"' + (v ? ' checked' : '') + '>';
      } else if (q.type === 'sel') {
        inp = '<select data-k="' + q.k + '" data-t="sel">' +
          q.opts.map(o => '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
      } else if (q.type === 'txt') {
        inp = '<input type="text" maxlength="64" data-k="' + q.k + '" data-t="txt" value="' + esc(v) + '">';
      } else if (q.type === 'col') {
        const sw = swatch(v || 0);
        inp = '<button type="button" class="ng-col" data-k="' + q.k + '" data-v="' + (v || 0) + '" style="' + sw.style + '">' + sw.text + '</button>';

      } else if (q.type === 'bitmap') {
        const w = Math.max(1, Math.min(16, Math.round(+n.p.w || 8)));
        const h = Math.max(1, Math.min(16, Math.round(+n.p.h || 8)));
        const pixels = String(v || '').toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(256, '0').slice(0, 256);
        const pal = palette();
        const tool = n._bmTool || 'pen';
        const filled = !!n._bmFill;
        const canUndo = Array.isArray(n._bmUndo) && n._bmUndo.length > 0;
        const canRedo = Array.isArray(n._bmRedo) && n._bmRedo.length > 0;
        let gridHtml =
          '<div class="ng-bm-wrap" tabindex="0">' +
            '<div class="ng-bm-tools">' +
              '<button type="button" class="ng-bm-tool' + (tool === 'pen' ? ' active' : '') + '" data-tool="pen" title="Matita (trascina per disegnare)">✎</button>' +
              '<button type="button" class="ng-bm-tool' + (tool === 'line' ? ' active' : '') + '" data-tool="line" title="Linea">╱</button>' +
              '<button type="button" class="ng-bm-tool' + (tool === 'tri' ? ' active' : '') + '" data-tool="tri" title="Triangolo">△</button>' +
              '<button type="button" class="ng-bm-tool' + (tool === 'circle' ? ' active' : '') + '" data-tool="circle" title="Cerchio">○</button>' +
              '<button type="button" class="ng-bm-fill' + (filled ? ' active' : '') + '" title="Forme piene / vuote">' + (filled ? '■' : '□') + '</button>' +
            '</div>' +
            '<div class="ng-bm-tools">' +
              '<button type="button" class="ng-bm-undo" title="Annulla"' + (canUndo ? '' : ' disabled') + '>↶</button>' +
              '<button type="button" class="ng-bm-redo" title="Ripeti"' + (canRedo ? '' : ' disabled') + '>↷</button>' +
              '<button type="button" class="ng-bm-clear" title="Pulisci griglia">✕</button>' +
            '</div>' +
            '<div class="ng-bitmap-grid" style="--bm-cols:' + w + '">';
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const value = parseInt(pixels[r * 16 + c], 16) || 0;
            const color = value ? (n.p.mode === 'colore' ? (pal[value] || DEFAULT_PAL[value]) : (pal[Math.max(1, Math.min(15, +n.p.col || 1))] || DEFAULT_PAL[1])) : '#1b2236';
            gridHtml += '<button type="button" class="ng-px" data-r="' + r + '" data-c="' + c + '" title="Riga ' + (r + 1) + ', colonna ' + (c + 1) + '" style="background:' + color + '"></button>';
          }
        }
        gridHtml += '</div></div>';
        inp = gridHtml;
      

      
    } else {
        inp = '<input type="number" step="' + (q.step || 1) + '" data-k="' + q.k + '" data-t="num" value="' + esc(v) + '">';
      }
      return '<label class="ng-p"><span>' + esc(q.label) + '</span>' + inp + '</label>';
    }).join('');

    const rg = n.r || {};
    const range = d.noRange ? '' :
      '<div class="ng-range"><span>attivo dal frame</span>' +
      '<input type="number" min="1" step="1" placeholder="tutti" data-r="from" value="' + (rg.from || '') + '">' +
      '<span>al</span>' +
      '<input type="number" min="1" step="1" placeholder="tutti" data-r="to" value="' + (rg.to || '') + '"></div>' +
      (d.timed ? '<label class="ng-p" title="Spento: fuori dall\'intervallo il nodo non ha effetto. Blocca: il movimento resta al valore raggiunto."><span>fuori intervallo</span><select data-r="fuori">' +
        ['spento', 'blocca'].map(o => '<option' + (o === rg.fuori ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>' : '');

    el.innerHTML =
      '<div class="ng-head"><span>' + esc(d.title) + '</span><span class="ng-badge"></span>' +
        (d.single ? '' : '<button class="ng-dup" title="Duplica (Maiusc+clic: mantiene anche i collegamenti in ingresso)">⧉</button>' +
          '<button class="ng-del" title="Elimina nodo">✕</button>') + '</div>' +
      '<div class="ng-ports">' + ports + '</div>' +
      '<div class="ng-params">' + params + range + '</div>' +
      '<div class="ng-info"></div>';
    updateInfo(el, n);

  const onParam = e => {
      const t = e.target, rk = t.dataset && t.dataset.r, k = t.dataset && t.dataset.k;
      if (rk) {
        if (rk === 'fuori') n.r.fuori = t.value === 'blocca' ? 'blocca' : 'spento';
        else { const v = parseFloat(t.value); n.r[rk] = isFinite(v) && v >= 1 ? Math.round(v) : null; }
        updateInfo(el, n);
        changed();
        if (e.type === 'change') rebuild();
        return;
      }
      if (!k) return;
      let v;
      if (t.dataset.t === 'bool') v = t.checked;
      else if (t.dataset.t === 'num') {
        v = parseFloat(t.value); if (!isFinite(v)) v = 0;
        if (n.type === 'bitmap8x8' && (k === 'w' || k === 'h')) {
          v = Math.max(1, Math.min(16, Math.round(v)));
          t.value = v;
        }
      }
      else v = t.value;
      n.p[k] = v;
      updateInfo(el, n);
      changed();
      if (e.type === 'change') rebuild();
    };

    el.addEventListener('input', onParam);
    el.addEventListener('change', onParam);

    // Bitmap 16x16: disegno continuo, forme (vuote/piene) e undo/redo (anche Ctrl+Z / Ctrl+Y)
    el.querySelectorAll('.ng-bm-wrap').forEach(wrap => {
      const grid = wrap.querySelector('.ng-bitmap-grid');
      if (!grid) return;

      n._bmUndo = n._bmUndo || [];
      n._bmRedo = n._bmRedo || [];
      const MAX_HISTORY = 20;

      const normPixels = () => String(n.p.pixels || '').toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(256, '0').slice(0, 256);

      const pushHistory = (prevStr) => {
        if (n._bmUndo[n._bmUndo.length - 1] === prevStr) return;
        n._bmUndo.push(prevStr);
        if (n._bmUndo.length > MAX_HISTORY) n._bmUndo.shift();
        n._bmRedo.length = 0;
      };

      const applyPixels = (nextStr, keepFocus = false) => {
        n.p.pixels = nextStr;
        changed();
        rebuild();
        if (keepFocus) {
          const newWrap = document.querySelector(`.ng-node[data-id="${n.id}"] .ng-bm-wrap`) || el.querySelector('.ng-bm-wrap');
          if (newWrap) newWrap.focus({ preventScroll: true });
        }
      };

      const doUndo = (keepFocus = false) => {
        if (!n._bmUndo.length) return;
        n._bmRedo.push(normPixels());
        applyPixels(n._bmUndo.pop(), keepFocus);
      };

      const doRedo = (keepFocus = false) => {
        if (!n._bmRedo.length) return;
        n._bmUndo.push(normPixels());
        applyPixels(n._bmRedo.pop(), keepFocus);
      };

      // Selezione strumento
      wrap.querySelectorAll('.ng-bm-tool').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          n._bmTool = btn.dataset.tool;
          wrap.querySelectorAll('.ng-bm-tool').forEach(b => b.classList.toggle('active', b === btn));
          wrap.focus({ preventScroll: true });
        });
      });

      // Toggle forme piene / vuote
      const fillBtn = wrap.querySelector('.ng-bm-fill');
      if (fillBtn) {
        fillBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          n._bmFill = !n._bmFill;
          fillBtn.classList.toggle('active', n._bmFill);
          fillBtn.textContent = n._bmFill ? '■' : '□';
          wrap.focus({ preventScroll: true });
        });
      }

      // Undo / Redo / Pulisci
      const undoBtn = wrap.querySelector('.ng-bm-undo');
      if (undoBtn) {
        undoBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          doUndo(true);
        });
      }

      const redoBtn = wrap.querySelector('.ng-bm-redo');
      if (redoBtn) {
        redoBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          doRedo(true);
        });
      }

      const clearBtn = wrap.querySelector('.ng-bm-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const cur = normPixels();
          const empty = '0'.repeat(256);
          if (cur === empty) return;
          pushHistory(cur);
          applyPixels(empty, true);
        });
      }

      // Scorciatoie da tastiera Ctrl+Z / Ctrl+Y (e Ctrl+Shift+Z)
      wrap.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          doUndo(true);
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          doRedo(true);
        }
      });

      const getPaintHex = () => {
        if (n.p.mode === 'colore') {
          return Math.max(1, Math.min(15, Math.round(+n.p.paint || 1))).toString(16).toUpperCase();
        }
        return '1';
      };

      const renderGridCells = (cells) => {
        const pal = palette();
        const monoCol = pal[Math.max(1, Math.min(15, +n.p.col || 1))] || DEFAULT_PAL[1];
        grid.querySelectorAll('.ng-px').forEach(px => {
          const r = +px.dataset.r, c = +px.dataset.c;
          const val = parseInt(cells[r * 16 + c], 16) || 0;
          px.style.background = val ? (n.p.mode === 'colore' ? (pal[val] || DEFAULT_PAL[val]) : monoCol) : '#1b2236';
        });
      };

      // Algoritmo di Bresenham per linee
      const plotLine = (pts, r0, c0, r1, c1) => {
        let dr = Math.abs(r1 - r0), sr = r0 < r1 ? 1 : -1;
        let dc = Math.abs(c1 - c0), sc = c0 < c1 ? 1 : -1;
        let err = (dc > dr ? dc : -dr) / 2, e2;
        while (true) {
          pts.push([r0, c0]);
          if (r0 === r1 && c0 === c1) break;
          e2 = err;
          if (e2 > -dc) { err -= dr; c0 += sc; }
          if (e2 < dr) { err += dc; r0 += sr; }
        }
      };

      // Riempimento scanline riga per riga del triangolo isoscele (vertice r0,topC -> base r1,c0..c1)
      const fillTriangleScanline = (pts, r0, topC, r1, c0, c1) => {
        if (r0 === r1) {
          const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
          for (let c = minC; c <= maxC; c++) pts.push([r0, c]);
          return;
        }
        const step = r1 > r0 ? 1 : -1;
        const totalRows = Math.abs(r1 - r0);
        for (let i = 0; i <= totalRows; i++) {
          const r = r0 + i * step;
          const t = i / totalRows;
          const leftC = topC + (c0 - topC) * t;
          const rightC = topC + (c1 - topC) * t;
          const startC = Math.round(Math.min(leftC, rightC));
          const endC = Math.round(Math.max(leftC, rightC));
          for (let c = startC; c <= endC; c++) {
            pts.push([r, c]);
          }
        }
      };

      // Calcola i pixel per linea, triangolo o cerchio (vuoti o pieni)
      const shapePoints = (tool, r0, c0, r1, c1, filled) => {
        const pts = [];
        if (tool === 'line') {
          plotLine(pts, r0, c0, r1, c1);
        } else if (tool === 'tri') {
          const topC = Math.round((c0 + c1) / 2);
          plotLine(pts, r0, topC, r1, c0);
          plotLine(pts, r0, topC, r1, c1);
          plotLine(pts, r1, c0, r1, c1);
          if (filled) {
            fillTriangleScanline(pts, r0, topC, r1, c0, c1);
          }
        } else if (tool === 'circle') {
          const cr = (r0 + r1) / 2, cc = (c0 + c1) / 2;
          const rr = Math.abs(r1 - r0) / 2, rc = Math.abs(c1 - c0) / 2;
          if (rr < 0.5 && rc < 0.5) {
            pts.push([r0, c0]);
          } else if (filled) {
            const minR = Math.floor(cr - rr), maxR = Math.ceil(cr + rr);
            const minC = Math.floor(cc - rc), maxC = Math.ceil(cc + rc);
            for (let r = minR; r <= maxR; r++) {
              for (let c = minC; c <= maxC; c++) {
                const nr = rr > 0 ? (r - cr) / (rr + 0.25) : 0;
                const nc = rc > 0 ? (c - cc) / (rc + 0.25) : 0;
                if (nr * nr + nc * nc <= 1) pts.push([r, c]);
              }
            }
          } else {
            const steps = Math.max(24, Math.ceil(2 * Math.PI * Math.max(rr, rc) * 2));
            for (let i = 0; i < steps; i++) {
              const a = (i / steps) * 2 * Math.PI;
              pts.push([Math.round(cr + rr * Math.sin(a)), Math.round(cc + rc * Math.cos(a))]);
            }
          }
        }
        return pts;
      };

      const cellFromEvent = (e) => {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const px = target && target.closest('.ng-px');
        if (!px || !grid.contains(px)) return null;
        return { r: +px.dataset.r, c: +px.dataset.c };
      };

      grid.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const start = cellFromEvent(e);
        if (!start) return;
        e.preventDefault();
        e.stopPropagation();
        wrap.focus({ preventScroll: true });

        const tool = n._bmTool || 'pen';
        const filled = !!n._bmFill;
        const beforeStr = normPixels();
        const baseCells = beforeStr.split('');
        const paintHex = getPaintHex();
        const w = Math.max(1, Math.min(16, Math.round(+n.p.w || 8)));
        const h = Math.max(1, Math.min(16, Math.round(+n.p.h || 8)));

        if (tool === 'pen') {
          const startIdx = start.r * 16 + start.c;
          const erase = baseCells[startIdx] === paintHex;
          const drawVal = erase ? '0' : paintHex;
          const working = baseCells.slice();

          const paintAt = (pos) => {
            if (!pos) return;
            working[pos.r * 16 + pos.c] = drawVal;
            renderGridCells(working);
          };

          paintAt(start);

          const onMove = mv => paintAt(cellFromEvent(mv));
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            const afterStr = working.join('');
            if (afterStr !== beforeStr) pushHistory(beforeStr);
            applyPixels(afterStr, true);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        } else {
          let currentWorking = baseCells.slice();
          const updateShape = (pos) => {
            if (!pos) return;
            const working = baseCells.slice();
            const pts = shapePoints(tool, start.r, start.c, pos.r, pos.c, filled);
            pts.forEach(([r, c]) => {
              if (r >= 0 && r < h && c >= 0 && c < w) {
                working[r * 16 + c] = paintHex;
              }
            });
            currentWorking = working;
            renderGridCells(working);
          };

          updateShape(start);

          const onMove = mv => updateShape(cellFromEvent(mv));
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            const afterStr = currentWorking.join('');
            if (afterStr !== beforeStr) pushHistory(beforeStr);
            applyPixels(afterStr, true);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }
      });
    });



    // Gestione della rotellina solo se si è sopra il campo numerico
    el.querySelectorAll('input[type=number]').forEach(input => {
      input.addEventListener('wheel', e => {
        e.stopPropagation(); // Impedisce che l'evento arrivi allo stage e muova lo zoom
        e.preventDefault();
        const step = parseFloat(input.step) || 1;
        let val = parseFloat(input.value) || 0;
        val += (e.deltaY < 0 ? step : -step);
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, { passive: false });

      let startX = 0, startVal = 0;
      input.addEventListener('pointerdown', e => {
        if (e.button === 0) {
          startX = e.clientX;
          startVal = parseFloat(input.value) || 0;
          const onMove = mv => {
            const dx = mv.clientX - startX;
            if (Math.abs(dx) > 3) {
              const step = parseFloat(input.step) || 1;
              input.value = Math.round((startVal + dx * step * 0.2) * 10) / 10;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }
      });
    });

    const del = el.querySelector('.ng-del');
    if (del) del.addEventListener('click', () => removeNode(n.id));
    const dup = el.querySelector('.ng-dup');
    if (dup) dup.addEventListener('click', e => duplicateNode(n.id, e.shiftKey));
    el.querySelectorAll('.ng-col').forEach(b => b.addEventListener('click', () => {
      const q = d.params.find(x => x.k === b.dataset.k);
      openPop(b, n, q);
    }));
    return el;
  }

  /* ── Selettore di colore ── */
  let pop = null, popFor = null;
  function closePop() {
    if (pop) { pop.remove(); pop = null; popFor = null; }
  }
  function openPop(btn, n, q) {
    if (pop && popFor === btn) { closePop(); return; }
    closePop();
    const pal = palette(), cur = Math.round(+n.p[q.k]) || 0;
    pop = document.createElement('div');
    pop.className = 'ng-pop';
    let h = '';
    if (q.none) h += '<button type="button" data-i="0" class="' + (cur === 0 ? 'sel' : '') + '" title="Come l\'originale">—</button>';
    for (let i = 1; i <= 15; i++) {
      const sw = swatch(i);
      h += '<button type="button" data-i="' + i + '" class="' + (cur === i ? 'sel' : '') + '" style="' + sw.style + '" title="Colore ' + i + '">' + i + '</button>';
    }
    pop.innerHTML = h;
    root.appendChild(pop);
    popFor = btn;
    const r = btn.getBoundingClientRect(), ph = pop.offsetHeight || 120, pw = pop.offsetWidth || 170;
    let top = r.bottom + 4;
    if (top + ph > (window.innerHeight || 800)) top = Math.max(4, r.top - ph - 4);
    pop.style.top = top + 'px';
    pop.style.left = Math.max(4, Math.min(r.left, (window.innerWidth || 1000) - pw - 4)) + 'px';
    pop.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const v = +b.dataset.i, sw = swatch(v);
      n.p[q.k] = v;
      popFor.dataset.v = v;
      popFor.setAttribute('style', sw.style);
      popFor.textContent = sw.text;
      closePop();
      changed();
      rebuild();
    });
  }
  function refreshSwatches() {
    world.querySelectorAll('.ng-col').forEach(b => {
      const sw = swatch(+b.dataset.v || 0);
      b.setAttribute('style', sw.style);
      b.textContent = sw.text;
    });
  }
  document.addEventListener('pointerdown', e => {
    if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.ng-col'))) closePop();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
  document.addEventListener('palettechange', () => { refreshSwatches(); if (graph && !root.hidden) draw(); });

  function rebuild() {
    closePop();
    world.querySelectorAll('.ng-node').forEach(x => x.remove());
    graph.nodes.forEach(n => world.appendChild(buildNode(n)));
    applyView();
    raf(drawWires);
  }
  function isPortConnected(nodeId, portId) {
    if (!graph || !graph.links) return false;
    return graph.links.some(l => l.to === nodeId && l.port === portId);
  }
  function removeNode(id) {
    graph.nodes = graph.nodes.filter(n => n.id !== id);
    graph.links = graph.links.filter(l => l.from !== id && l.to !== id);
    const el = nodeEl(id);
    if (el) el.remove();
    drawWires();
    changed();
    rebuild();
  }

  function duplicateNode(id, keepLinks) {
    const n = nodeById(id);
    if (!graph || !n || E.NODES[n.type].single) return null;
    if (graph.nodes.length >= 60) { toast('Troppi nodi', 'err'); return null; }
    const c = {
      id: graph.nextId++, type: n.type, x: n.x + 28, y: n.y + 28,
      p: JSON.parse(JSON.stringify(n.p)), r: JSON.parse(JSON.stringify(n.r || {}))
    };
    graph.nodes.push(c);
    if (keepLinks) {
      graph.links.filter(l => l.to === id).forEach(l => graph.links.push({ from: l.from, to: c.id, port: l.port }));
    }
    world.appendChild(buildNode(c));
    drawWires();
    changed();
    rebuild();
    return c;
  }

  function addNodeOfType(type) {
    if (!graph || !E.NODES[type]) return null;
    if (E.NODES[type].single && graph.nodes.some(n => n.type === type)) { toast('Esiste già un nodo "' + E.NODES[type].title + '"', 'err'); return null; }
    if (graph.nodes.length >= 60) { toast('Troppi nodi', 'err'); return null; }
    const s = animSize(), k = graph.nodes.length % 6 * 18;
    const x = Math.round((stage.clientWidth / 2 - view.x) / view.s - 105 + k), y = Math.round((stage.clientHeight / 3 - view.y) / view.s + k);
    const n = E.addNode(graph, type, x, y, {}, { W: s.W, H: s.H });
    world.appendChild(buildNode(n));
    drawWires();
    changed();
    rebuild();
    return n;
  }

  function connect(fromId, toId, port) {
    const to = nodeById(toId), from = nodeById(fromId);
    if (!to || !from) return false;
    const spec = E.NODES[to.type].ins.find(p => p.id === port);
    if (!spec) return false;
    if (E.wouldCycle(graph, fromId, toId)) { toast('Collegamento non valido: creerebbe un anello', 'err'); return false; }
    if (graph.links.some(l => l.from === fromId && l.to === toId && l.port === port)) return false;
    if (!spec.multi) graph.links = graph.links.filter(l => !(l.to === toId && l.port === port));
    graph.links.push({ from: fromId, to: toId, port: port });
    changed();
    rebuild();
    return true;
  }

  /* ── Cavi ── */
  function pt(e) {
    const r = world.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.s, y: (e.clientY - r.top) / view.s };
  }
  function sockPos(el) {
    const r = el.getBoundingClientRect(), w = world.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - w.left) / view.s, y: (r.top + r.height / 2 - w.top) / view.s };
  }
  function curve(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y;
  }
  function drawWires() {
    if (!graph) return;
    let h = '';
    graph.links.forEach(l => {
      const na = nodeEl(l.from), nb = nodeEl(l.to);
      if (!na || !nb) return;
      const a = na.querySelector('.sock.out'), b = nb.querySelector('.sock.in[data-port="' + l.port + '"]');
      if (a && b) h += '<path class="ng-wire" d="' + curve(sockPos(a), sockPos(b)) + '"/>';
    });
    if (drag && drag.kind === 'wire') {
      const na = nodeEl(drag.from), a = na && na.querySelector('.sock.out');
      if (a) h += '<path class="ng-wire temp" d="' + curve(sockPos(a), drag.pos) + '"/>';
    }
    wires.innerHTML = h;
  }
  function applyView() {
    world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
    const g = 24 * view.s;
    stage.style.backgroundSize = g + 'px ' + g + 'px';
    stage.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    const z = $('ngZoomVal');
    if (z) z.textContent = Math.round(view.s * 100) + '%';
  }

  /* ── Trascinamento: nodi, cavi, vista ── */
  stage.addEventListener('pointerdown', e => {
    if (e.button > 0 || !graph) return;
    closePop();
    const t = e.target;
    if (t.closest('input, select, button, label')) return;
    const sock = t.closest('.sock'), head = t.closest('.ng-head');
    if (sock) {
      const id = +sock.closest('.ng-node').dataset.id;
      if (sock.classList.contains('out')) {
        drag = { kind: 'wire', from: id };
      } else {
        let k = -1;
        graph.links.forEach((l, i) => { if (l.to === id && l.port === sock.dataset.port) k = i; });
        if (k < 0) return;
        drag = { kind: 'wire', from: graph.links.splice(k, 1)[0].from };
        changed();
        rebuild();
      }
      drag.pos = pt(e);
    } else if (head) {
      const el = head.parentElement, n = nodeById(+el.dataset.id), p = pt(e);
      drag = { kind: 'node', n: n, el: el, dx: p.x - n.x, dy: p.y - n.y };
    } else if (!t.closest('.ng-node')) {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      stage.classList.add('panning');
    } else {
      return;
    }
    e.preventDefault();
    if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (x) {} }
    drawWires();
  });

  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'wire') {
      drag.pos = pt(e);
    } else if (drag.kind === 'node') {
      const p = pt(e);
      drag.n.x = Math.round(p.x - drag.dx);
      drag.n.y = Math.round(p.y - drag.dy);
      drag.el.style.left = drag.n.x + 'px';
      drag.el.style.top = drag.n.y + 'px';
    } else {
      view.x = drag.vx + e.clientX - drag.sx;
      view.y = drag.vy + e.clientY - drag.sy;
      applyView();
      return;
    }
    drawWires();
  });

  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    stage.classList.remove('panning');
    if (d.kind === 'wire' && e.type === 'pointerup') {
      const under = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
      const s = under && under.closest && under.closest('.sock.in'), box = under && under.closest && under.closest('.ng-node');
      if (s) {
        connect(d.from, +s.closest('.ng-node').dataset.id, s.dataset.port);
      } else if (box) {
        const n = nodeById(+box.dataset.id), first = n && E.NODES[n.type].ins[0];
        if (first) connect(d.from, n.id, first.id);
      }
    } else if (d.kind === 'node') {
      scheduleSave();
    } else if (d.kind === 'pan') {
      saveView();
    }
    drawWires();
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  /* ── Zoom (rotella, pulsanti, inquadra) ── */
  function clampScale(v) { return Math.max(0.3, Math.min(2.5, v)); }
  function saveView() {
    if (!graph) return;
    graph.view = { x: Math.round(view.x), y: Math.round(view.y), s: Math.round(view.s * 100) / 100 };
    scheduleSave(true);
  }
  function zoomAt(cx, cy, factor) {
    const s2 = clampScale(view.s * factor);
    if (s2 === view.s) return;
    const wx = (cx - view.x) / view.s, wy = (cy - view.y) / view.s;
    view.s = s2;
    view.x = cx - wx * s2;
    view.y = cy - wy * s2;
    applyView();
    saveView();
  }
  const stageCenter = () => ({ x: (stage.clientWidth || 600) / 2, y: (stage.clientHeight || 400) / 2 });
  stage.addEventListener('wheel', e => {
      // Se la rotellina è sopra un input o un nodo, non fare lo zoom dello stage
      if (e.target.closest('input, select, button, label, .ng-node')) return;

      e.preventDefault();
      closePop();
      const r = stage.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * 0.0015));
    }, { passive: false });

  function fit() {
    if (!graph || !graph.nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    graph.nodes.forEach(n => {
      const el = nodeEl(n.id), w = (el && el.offsetWidth) || 214, h = (el && el.offsetHeight) || 160;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
    });
    const sw = stage.clientWidth || 800, sh = stage.clientHeight || 500, m = 40;
    const s = clampScale(Math.min((sw - 2 * m) / (x1 - x0), (sh - 2 * m) / (y1 - y0), 1.5));
    view.s = s;
    view.x = (sw - (x1 - x0) * s) / 2 - x0 * s;
    view.y = (sh - (y1 - y0) * s) / 2 - y0 * s;
    applyView();
    saveView();
  }
  $('ngZoomIn').addEventListener('click', () => { const c = stageCenter(); zoomAt(c.x, c.y, 1.25); });
  $('ngZoomOut').addEventListener('click', () => { const c = stageCenter(); zoomAt(c.x, c.y, 0.8); });
  $('ngZoomVal').addEventListener('click', () => { const c = stageCenter(); zoomAt(c.x, c.y, 1 / view.s); });
  $('ngFit').addEventListener('click', fit);

  /* ── Comandi ── */
  $('ngAdd').addEventListener('change', function () {
    const type = this.value;
    this.value = '';
    if (type) addNodeOfType(type);
  });

  $('ngReset').addEventListener('click', () => {
    if (!graph || !confirm("Ripartire dall'esempio? I nodi attuali andranno persi.")) return;
    const s = animSize();
    graph = E.starterGraph(s.W, s.H);
    rebuild();
    changed();
    rebuild();
  });

  function bake() {
    const a = animations.find(x => x.id === currentAnimId);
    if (!graph || !a) return;
    const px = E.renderGraph(graph, a.width, a.height || 8);
    const hasContent = frames.some(f => f.pixels.some(r => r.some(v => v)));
    if (hasContent && !confirm('Sostituire i ' + frames.length + ' frame di "' + a.name + '" con i ' + px.length +
        ' generati dai nodi?\n(Finché non premi SALVA puoi tornare indietro con SCARTA.)')) return;
    frames = px.map(p => ({ id: 'g' + (++uid) + '_' + Date.now(), pixels: p }));
    currentFrameIndex = 0;
    markDirty();
    renderEditor();
    const colored = px.some(f => f.some(r => r.some(v => v > 1)));
    if (colored && window.Palette && window.Palette.setMode && !window.Palette.mode()) window.Palette.setMode(true);
    toast('Generati ' + px.length + ' frame' + (colored ? ' a colori' : '') + ': premi SALVA per renderli definitivi', 'ok');
  }
  $('ngBake').addEventListener('click', bake);

  async function open() {
    if (!currentAnimId) { toast("Apri prima un'animazione", 'err'); return; }
    root.hidden = false;
    btn.classList.add('active');
    if (typeof E.localTime !== 'function') {
      toast('nodes-engine.js è una versione vecchia (o in cache): copialo e ricarica con Ctrl+Shift+R', 'err');
    }
    await loadGraph(currentAnimId);
  }
  async function close() {
    if (graphDirty) await saveGraph();
    root.hidden = true;
    btn.classList.remove('active');
    stopPreview();
  }
  btn.addEventListener('click', () => { if (root.hidden) open(); else close(); });
  $('ngClose').addEventListener('click', close);

  const _selectAnimation = window.selectAnimation;
  window.selectAnimation = async function (id) {
    if (id === currentAnimId || root.hidden) return _selectAnimation(id);
    if (graphDirty) await saveGraph();
    const r = await _selectAnimation(id);
    if (!root.hidden && currentAnimId) await loadGraph(currentAnimId);
    return r;
  };
  const _deleteAnimation = window.deleteAnimation;
  window.deleteAnimation = async function (id) {
    await _deleteAnimation(id);
    if (!root.hidden && !currentAnimId) { graphDirty = false; close(); }
  };

  window.NodesUI = {
    open: open, close: close, bake: bake, connect: connect, addNode: addNodeOfType, duplicate: duplicateNode, fit: fit,
    get view() { return view; },
    get graph() { return graph; }
  };
})();