// layout.js: la griglia riempie lo spazio disponibile, escluso il pannello anteprima
(function () {
  'use strict';

  window.calcCell = function (W, H) {
    H = H || 8;
    const area = document.getElementById('canvasArea');
    const panel = document.getElementById('previewPanel');
    const panelW = panel && getComputedStyle(panel).display !== 'none' ? panel.offsetWidth + 20 : 0;
    const gap = 3, pad = 44;
    const availW = area.clientWidth - pad - panelW - (W - 1) * gap;
    const availH = area.clientHeight - pad - (H - 1) * gap;
    const max = Math.max(W, H) >= 32 ? 56 : 112;
    return Math.max(10, Math.min(Math.floor(availW / W), Math.floor(availH / H), max));
  };

  let raf = 0;
  const refit = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (currentAnimId) renderGrid(); });
  };
  new ResizeObserver(refit).observe(document.getElementById('canvasArea'));
})();
