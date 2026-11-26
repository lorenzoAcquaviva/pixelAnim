// preview-panel.js: anteprima animata sempre visibile accanto alla griglia
(function () {
  'use strict';

  const area = document.getElementById('canvasArea');
  const panel = document.createElement('div');
  panel.id = 'previewPanel';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="pv-title">ANTEPRIMA</div>' +
    '<canvas id="pvCanvas" width="224" height="224"></canvas>' +
    '<div class="pv-info" id="pvInfo">—</div>' +
    '<div class="pv-controls">' +
      '<button class="btn" id="pvPlay">⏸ PAUSA</button>' +
      '<div class="pv-fps"><span>FPS</span><span id="pvFpsVal">8</span></div>' +
      '<input type="range" id="pvFps" min="1" max="30" value="8">' +
    '</div>';
  area.appendChild(panel);

  const cv = document.getElementById('pvCanvas');
  const ctx = cv.getContext('2d');
  const btn = document.getElementById('pvPlay');
  const slider = document.getElementById('pvFps');
  const fpsVal = document.getElementById('pvFpsVal');
  const info = document.getElementById('pvInfo');

  let playing = true, fps = 8, idx = 0, lastStep = 0, lastAnim = null;
  try { fps = Math.min(30, Math.max(1, parseInt(localStorage.getItem('pixelanim.fps'), 10) || 8)); } catch (e) {}
  slider.value = fps;
  fpsVal.textContent = fps;

  slider.addEventListener('input', () => {
    fps = +slider.value;
    fpsVal.textContent = fps;
    try { localStorage.setItem('pixelanim.fps', fps); } catch (e) {}
  });
  btn.addEventListener('click', () => {
    playing = !playing;
    btn.textContent = playing ? '⏸ PAUSA' : '▶ PLAY';
  });

  function draw(i, W, H) {
    const scale = Math.max(1, Math.floor(224 / Math.max(W, H)));
    if (cv.width !== W * scale || cv.height !== H * scale) { cv.width = W * scale; cv.height = H * scale; }
    ctx.fillStyle = '#0b0d13';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const f = frames[i];
    if (!f) return;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const on = f.pixels[r] && f.pixels[r][c];
        ctx.fillStyle = on ? (window.pxColor ? window.pxColor(on) : '#ff6b2b') : '#1b2236';
        ctx.shadowBlur = on ? scale / 2 : 0;
        ctx.shadowColor = (on && window.pxColor) ? window.pxColor(on) : '#ff6b2b';
        ctx.fillRect(c * scale + 1, r * scale + 1, scale - 2, scale - 2);
      }
    }
    ctx.shadowBlur = 0;
  }

  function tick(ts) {
    requestAnimationFrame(tick);
    if (panel.style.display === 'none' || panel.offsetParent === null || document.hidden || !frames.length) return;
    if (currentAnimId !== lastAnim) { lastAnim = currentAnimId; idx = 0; }
    if (playing && ts - lastStep >= 1000 / fps) {
      lastStep = ts;
      idx = (idx + 1) % frames.length;
    }
    const i = playing ? idx % frames.length : currentFrameIndex;
    const anim = animations.find(a => a.id === currentAnimId) || {};
    const W = anim.width || 8, H = anim.height || 8;
    draw(i, W, H);
    info.textContent = (playing ? 'riproduzione ' : 'frame ') + (i + 1) + ' / ' + frames.length;
  }
  requestAnimationFrame(tick);

  // il pannello compare solo con un'animazione aperta; va deciso PRIMA di ridisegnare la griglia
  const _renderEditor = window.renderEditor;
  window.renderEditor = function () {
    panel.style.display = currentAnimId ? '' : 'none';
    _renderEditor();
  };
})();
