// mobile.js: cassetto per l'elenco animazioni e modalità "sposta vista" per le griglie larghe
(function () {
  'use strict';

  const mq = window.matchMedia('(max-width: 700px)');
  const header = document.querySelector('header');
  const area = document.getElementById('canvasArea');

  /* ── Cassetto ── */
  const menuBtn = document.createElement('button');
  menuBtn.id = 'menuBtn';
  menuBtn.className = 'btn icon';
  menuBtn.textContent = '☰';
  menuBtn.title = 'Animazioni';
  header.prepend(menuBtn);

  const backdrop = document.createElement('div');
  backdrop.id = 'drawerBackdrop';
  document.body.appendChild(backdrop);

  const setDrawer = open => document.body.classList.toggle('drawer-open', open);
  menuBtn.onclick = () => setDrawer(!document.body.classList.contains('drawer-open'));
  backdrop.onclick = () => setDrawer(false);
  mq.addEventListener('change', () => setDrawer(false));

  const _selectAnimation = window.selectAnimation;
  window.selectAnimation = async function (id) {
    try { return await _selectAnimation(id); } finally { setDrawer(false); }
  };

  /* ── Celle abbastanza grandi per le dita ── */
  const _calcCell = window.calcCell;
  window.calcCell = function (W, H) {
    const c = _calcCell(W, H);
    return mq.matches ? Math.max(c, W > 8 ? 22 : 26) : c;
  };

  /* ── Modalità "vista": il tocco scorre invece di disegnare ── */
  const panBtn = document.createElement('button');
  panBtn.className = 'tool-btn pan-btn';
  panBtn.textContent = '✋ VISTA';
  panBtn.title = 'Sposta la vista (la griglia è più grande dello schermo)';
  panBtn.style.display = 'none';
  document.getElementById('toolFill').after(panBtn);

  function setPan(on) {
    document.body.classList.toggle('pan-mode', on);
    panBtn.classList.toggle('active', on);
  }
  panBtn.onclick = () => setPan(!document.body.classList.contains('pan-mode'));

  // in fase di cattura, così ux.js non vede il tocco
  area.addEventListener('pointerdown', e => {
    if (document.body.classList.contains('pan-mode')) e.stopPropagation();
  }, true);

  function updatePan() {
    const overflow = mq.matches &&
      (area.scrollWidth > area.clientWidth + 1 || area.scrollHeight > area.clientHeight + 1);
    panBtn.style.display = overflow ? 'inline-block' : 'none';
    if (!overflow) setPan(false);
  }
  const _renderGrid = window.renderGrid;
  window.renderGrid = function () { _renderGrid.apply(this, arguments); updatePan(); };
  mq.addEventListener('change', updatePan);
})();
