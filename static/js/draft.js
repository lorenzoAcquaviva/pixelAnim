// draft.js: bozza automatica sul server; il database si aggiorna solo con SALVA
(function () {
  'use strict';

  const badge = document.getElementById('saveState');
  if (!badge) { console.error('draft.js: ux.js deve essere caricato prima'); return; }

  /* ── Stato ── */
  let pending = false;      // modifiche non ancora scritte nella bozza
  let uncommitted = false;  // il contenuto differisce dalla versione salvata
  let hadError = false;
  let draftTimer = 0;
  let inflight = null;
  let uid = 0;

  const HEAD = { 'Content-Type': 'application/json' };
  const newId = () => 'c' + (++uid);
  const pixelsOf = () => frames.map(f => f.pixels);
  const dimensionsOf = () => { const a = animations.find(a => a.id === currentAnimId) || {}; return { width: a.width || 8, height: a.height || 8 }; };
  const emptyFrame = (W, H) => Array.from({ length: H }, () => Array(W).fill(0));
  const payload = snap => '{"frames":' + snap + '}';

  /* ── Indicatore e bottone SCARTA ── */
  const TEXT = {
    dirty: '● modifiche…', saving: '⏳ salvo bozza…',
    draft: '◐ bozza (premi SALVA)', saved: '✓ salvato', error: '✗ errore di salvataggio'
  };
  const discardBtn = document.createElement('button');
  discardBtn.className = 'btn danger';
  discardBtn.textContent = '↺ SCARTA';
  discardBtn.title = "Scarta le modifiche non salvate e torna all'ultima versione salvata";
  discardBtn.style.display = 'none';
  badge.after(discardBtn);

  function setState(s) { badge.dataset.state = s; badge.textContent = TEXT[s] || ''; }
  function refreshBadge() {
    const active = !!currentAnimId;
    discardBtn.style.display = active && uncommitted ? '' : 'none';
    const save = document.getElementById('btnSave');
    if (save) save.classList.toggle('attention', active && uncommitted);
    if (!active) return setState('');
    if (hadError) return setState('error');
    setState(pending ? 'dirty' : (uncommitted ? 'draft' : 'saved'));
  }

  /* ── Elenco animazioni: aggiunge has_draft ── */
  const _getAnimations = api.getAnimations;
  api.getAnimations = async function () {
    const res = await Promise.all([
      _getAnimations(),
      fetch('/api/drafts').then(r => (r.ok ? r.json() : [])).catch(() => [])
    ]);
    res[0].forEach(a => { a.has_draft = res[1].indexOf(a.id) !== -1; });
    return res[0];
  };

  const _renderSidebar = window.renderSidebar;
  window.renderSidebar = function () {
    _renderSidebar();
    const cards = document.querySelectorAll('#animList .anim-card');
    animations.forEach((a, i) => {
      const flag = a.id === currentAnimId ? uncommitted : a.has_draft;
      const meta = cards[i] && cards[i].querySelector('.anim-meta');
      if (flag && meta) {
        meta.insertAdjacentHTML('beforeend',
          '<span class="draft-dot" title="Modifiche non salvate (bozza)">◐ bozza</span>');
      }
    });
  };

  /* ── Scrittura della bozza ── */
  function scheduleDraft(ms) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, ms || 2000);
  }

  async function writeDraft() {
    if (!currentAnimId || !pending) return;
    const animId = currentAnimId;
    const snap = JSON.stringify(pixelsOf());
    setState('saving');
    try {
      const r = await fetch('/api/animations/' + animId + '/draft',
        { method: 'PUT', headers: HEAD, body: payload(snap) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      hadError = false;
      const a = animations.find(x => x.id === animId);
      if (a && !a.has_draft) { a.has_draft = true; renderSidebar(); }
      if (animId === currentAnimId && JSON.stringify(pixelsOf()) === snap) {
        pending = false; dirtyFrames.clear(); isDirty = false;
      }
    } catch (e) {
      hadError = true;
    }
    refreshBadge();
    if (pending) scheduleDraft(hadError ? 5000 : 2000);   // modifiche arrivate durante la scrittura, o nuovo tentativo
  }

  function saveDraft() {
    clearTimeout(draftTimer);
    if (inflight) return inflight;
    inflight = writeDraft().finally(() => { inflight = null; });
    return inflight;
  }
  window.saveDraft = saveDraft;

  async function flushDraft() {
    for (let i = 0; i < 3 && (pending || inflight); i++) await saveDraft();
  }

  /* ── Ogni modifica finisce nella bozza ── */
  const _markDirty = window.markDirty;
  window.markDirty = function () {
    _markDirty();
    pending = true;
    uncommitted = true;
    refreshBadge();
    scheduleDraft();
  };

  const _renderEditor = window.renderEditor;
  window.renderEditor = function () { _renderEditor(); refreshBadge(); };

  /* ── SALVA = scrittura definitiva ── */
  window.saveCurrentFrame = async function () {
    if (!currentAnimId) return;
    const animId = currentAnimId;
    clearTimeout(draftTimer);
    if (inflight) { try { await inflight; } catch (e) {} }
    const snap = JSON.stringify(pixelsOf());
    setState('saving');
    try {
      const r = await fetch('/api/animations/' + animId + '/frames',
        { method: 'PUT', headers: HEAD, body: payload(snap) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      hadError = true;
      refreshBadge();
      toast('Salvataggio non riuscito', 'err');
      return;
    }
    hadError = false;
    animations = await api.getAnimations();
    if (animId === currentAnimId) {
      if (JSON.stringify(pixelsOf()) === snap) {
        pending = false; uncommitted = false; dirtyFrames.clear(); isDirty = false;
      } else {                       // modificato mentre salvavo: resta in bozza
        pending = true; uncommitted = true; scheduleDraft();
      }
    }
    renderSidebar();
    refreshBadge();
    toast('Salvato: ' + snap.length && frames.length + ' frame', 'ok');
  };

  /* ── Frame: solo in memoria, finiscono nella bozza ── */
  window.addFrame = async function (duplicate) {
    if (!currentAnimId) return;
    const src = frames[currentFrameIndex];
    const pixels = duplicate && src ? src.pixels.map(r => r.slice()) : emptyFrame(dimensionsOf().width, dimensionsOf().height);
    const at = currentFrameIndex + 1;
    frames.splice(at, 0, { id: newId(), pixels: pixels });
    currentFrameIndex = at;
    markDirty();
    renderEditor();
    toast(duplicate ? 'Frame duplicato' : 'Frame aggiunto', 'ok');
  };

  function removeFrame(idx) {
    frames.splice(idx, 1);
    if (idx < currentFrameIndex) currentFrameIndex--;
    if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
    markDirty();
    renderEditor();
    toast('Frame eliminato', 'ok');
  }
  window.deleteCurrentFrame = async function () {
    if (!currentAnimId || frames.length <= 1) return;
    if (!confirm('Eliminare frame ' + (currentFrameIndex + 1) + '?')) return;
    removeFrame(currentFrameIndex);
  };
  window.deleteFrameByIndex = async function (idx) {
    if (frames.length <= 1) return;
    if (!confirm('Eliminare frame ' + (idx + 1) + '?')) return;
    removeFrame(idx);
  };

  // le vecchie funzioni non devono più scrivere nel database
  window.saveAllDirtyFrames = async function () {};
  window.saveCurrentFrameSilent = async function () {};

  /* ── Apertura animazione: ripristina la bozza se esiste ── */
  const _selectAnimation = window.selectAnimation;
  window.selectAnimation = async function (id) {
    if (id === currentAnimId) return;
    await flushDraft();
    if (pending && !confirm('Non riesco a salvare la bozza. Cambiare animazione e perdere le modifiche?')) return;
    clearTimeout(draftTimer);
    await _selectAnimation(id);
    pending = false;
    uncommitted = false;
    hadError = false;
    const a = animations.find(x => x.id === id);
    if (a && a.has_draft) {
      try {
        const r = await fetch('/api/animations/' + id + '/draft');
        if (r.ok) {
          const d = await r.json();
          frames = d.frames.map(p => ({ id: newId(), pixels: p }));
          currentFrameIndex = 0;
          uncommitted = true;
          renderEditor();
        }
      } catch (e) {}
    }
    try { localStorage.setItem('pixelanim.last', String(id)); } catch (e) {}
    renderSidebar();
    refreshBadge();
  };

  const _deleteAnimation = window.deleteAnimation;
  window.deleteAnimation = async function (id) {
    await _deleteAnimation(id);
    if (!currentAnimId) {
      clearTimeout(draftTimer);
      pending = false; uncommitted = false; dirtyFrames.clear(); isDirty = false;
      refreshBadge();
    }
  };

  /* ── SCARTA: torna all'ultima versione salvata ── */
  discardBtn.onclick = async function () {
    if (!currentAnimId) return;
    if (!confirm('Scartare tutte le modifiche non salvate di questa animazione?')) return;
    const id = currentAnimId;
    clearTimeout(draftTimer);
    if (inflight) { try { await inflight; } catch (e) {} }
    try {
      const r = await fetch('/api/animations/' + id + '/draft', { method: 'DELETE' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) { toast('Impossibile scartare la bozza', 'err'); return; }
    pending = false; uncommitted = false; hadError = false;
    dirtyFrames.clear(); isDirty = false;
    frames = await api.getFrames(id);
    if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
    animations = await api.getAnimations();
    renderEditor();
    renderSidebar();
    toast('Bozza scartata', 'ok');
  };

  /* ── All'avvio riapre l'ultima animazione ── */
  (async function () {
    try {
      const id = parseInt(localStorage.getItem('pixelanim.last'), 10);
      if (!id) return;
      const list = await api.getAnimations();
      if (!currentAnimId && list.some(a => a.id === id)) {
        animations = list;
        await window.selectAnimation(id);
      }
    } catch (e) {}
  })();
})();
