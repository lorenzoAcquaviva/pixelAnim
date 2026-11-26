// ux.js: migliorie di usabilità. Si carica dopo gli altri script e prima di main.js.
(function () {
  'use strict';

  /* ── Indicatore e salvataggio automatico ───────────────── */
  const badge = document.createElement('span');
  badge.id = 'saveState';
  badge.className = 'save-state';
  document.getElementById('btnSave').after(badge);

  function setSaveState(s) {
    badge.dataset.state = s;
    badge.textContent = ({
      dirty: '● non salvato', saving: '⏳ salvo…', saved: '✓ salvato', error: '✗ errore'
    })[s] || '';
  }

  async function autosave() {
    if (!currentAnimId || dirtyFrames.size === 0) return;
    const animId = currentAnimId;
    const batch = [...dirtyFrames]
      .filter(i => frames[i])
      .map(i => ({ i, fi: frames[i].frame_index, json: JSON.stringify(frames[i].pixels) }));
    setSaveState('saving');
    try {
      const res = await Promise.all(
        batch.map(x => api.saveFrame(animId, x.fi, JSON.parse(x.json)))
      );
      if (!res.every(r => r && r.ok)) throw new Error('save failed');
      if (animId !== currentAnimId) return;
      // toglie dai "sporchi" solo i frame rimasti uguali a quelli inviati
      batch.forEach(x => {
        if (frames[x.i] && JSON.stringify(frames[x.i].pixels) === x.json) dirtyFrames.delete(x.i);
      });
      isDirty = dirtyFrames.size > 0;
      setSaveState(isDirty ? 'dirty' : 'saved');
    } catch (err) {
      setSaveState('error');
    }
  }

  function updateActiveThumb() {
    const cv = document.getElementById('miniCanvas_' + currentFrameIndex);
    const f = frames[currentFrameIndex];
    if (!cv || !f) return;
    const W = (animations.find(a => a.id === currentAnimId) || {}).width || 8;
    drawMini(cv, f.pixels, W);
  }

  let saveTimer;
  const _markDirty = window.markDirty;
  window.markDirty = function () {
    _markDirty();
    setSaveState('dirty');
    updateActiveThumb();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { if (window.saveDraft) window.saveDraft(); }, 2000);
  };

  const _saveCurrentFrame = window.saveCurrentFrame;
  window.saveCurrentFrame = async function () {
    await _saveCurrentFrame();
    setSaveState(dirtyFrames.size ? 'dirty' : 'saved');
  };

  const _renderEditor = window.renderEditor;
  window.renderEditor = function () {
    _renderEditor();
    if (!dirtyFrames.size && badge.dataset.state === 'dirty') setSaveState('saved');
  };

  const _renderFrameStrip = window.renderFrameStrip;
  window.renderFrameStrip = function () {
    _renderFrameStrip();
    const active = document.querySelector('.frame-thumb.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  };

  window.addEventListener('beforeunload', e => {
    if (dirtyFrames.size) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && window.saveDraft) window.saveDraft(); });

  /* ── Annulla / Ripeti ──────────────────────────────────── */
  const undoStack = [], redoStack = [], LIMIT = 100;
  const copy = p => p.map(r => r.slice());

  function snapOf(id) {
    const f = frames.find(x => x.id === id);
    return f ? { anim: currentAnimId, id: id, pixels: copy(f.pixels) } : null;
  }
  function pushUndo() {
    const f = frames[currentFrameIndex];
    if (!f) return;
    undoStack.push(snapOf(f.id));
    if (undoStack.length > LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(s) {
    if (s.anim !== currentAnimId) return false;
    const i = frames.findIndex(f => f.id === s.id);
    if (i < 0) return false;
    currentFrameIndex = i;
    frames[i].pixels = copy(s.pixels);
    markDirty();
    renderEditor();
    return true;
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) return;
    const now = snapOf(s.id);
    if (restore(s) && now) redoStack.push(now);
  }
  function redo() {
    const s = redoStack.pop();
    if (!s) return;
    const now = snapOf(s.id);
    if (restore(s) && now) undoStack.push(now);
  }

  ['clearFrame', 'invertFrame', 'shiftLeft', 'shiftRight'].forEach(name => {
    const orig = window[name];
    window[name] = function () { pushUndo(); return orig.apply(this, arguments); };
  });

  const _selectAnimation = window.selectAnimation;
  window.selectAnimation = function (id) {
    undoStack.length = 0; redoStack.length = 0;
    return _selectAnimation(id);
  };

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
  });

  const tools = document.querySelector('.tools-row');
  const spacer = tools.querySelector('.spacer');
  [['↶ ANNULLA', 'Ctrl+Z', undo], ['↷ RIPETI', 'Ctrl+Y', redo]].forEach(([label, title, fn]) => {
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.textContent = label;
    b.title = title;
    b.onclick = fn;
    tools.insertBefore(b, spacer);
  });

  /* ── Disegno con mouse, touch e penna (tasto destro = cancella) ── */
  const area = document.getElementById('canvasArea');
  let last = null;

  function cellOf(el) {
    return el && el.classList && el.classList.contains('pixel') ? [+el.dataset.r, +el.dataset.c] : null;
  }

  function line(r0, c0, r1, c1) {
    const pts = [];
    const dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
    const sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
    let err = dc - dr;
    for (;;) {
      pts.push([r0, c0]);
      if (r0 === r1 && c0 === c1) break;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c0 += sc; }
      if (e2 < dc) { err += dc; r0 += sr; }
    }
    return pts;
  }

  area.addEventListener('pointerdown', e => {
    const cell = cellOf(e.target);
    if (!cell) return;
    e.preventDefault();
    const r = cell[0], c = cell[1];
    const frame = frames[currentFrameIndex];
    pushUndo();
    if (tool === 'fill' && e.button !== 2) { floodFill(r, c, frame.pixels[r][c]); return; }
    isPainting = true;
    paintValue = (e.button === 2 || tool === 'erase') ? 0 : (window.pickPaint ? window.pickPaint(frame.pixels[r][c]) : (frame.pixels[r][c] ? 0 : 1));
    last = cell;
    setPixel(r, c, paintValue);
  });

  window.addEventListener('pointermove', e => {
    if (!isPainting) return;
    const cell = cellOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!cell) return;
    const from = last || cell;
    line(from[0], from[1], cell[0], cell[1]).forEach(p => setPixel(p[0], p[1], paintValue));
    last = cell;
  });

  const stop = () => { isPainting = false; last = null; };
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);

  /* ── Ricorda le impostazioni ESP ───────────────────────── */
  const ESP_FIELDS = ['espIp', 'espPort', 'espColor', 'espBright', 'espRotate'];
  const KEY = 'pixelanim.esp';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    ESP_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || !(id in saved)) return;
      if (el.type === 'checkbox') el.checked = !!saved[id]; else el.value = saved[id];
    });
  } catch (err) {}
  ESP_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        saved[id] = el.type === 'checkbox' ? el.checked : el.value;
        localStorage.setItem(KEY, JSON.stringify(saved));
      } catch (err) {}
    });
  });
})();
