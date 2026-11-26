// ── EDITOR ───────────────────────────────────────────────────────────────────
function renderEditor() {
  const anim = animations.find(a => a.id === currentAnimId);
  const hasAnim = !!anim;
  const hasFrames = frames.length > 0;

  document.getElementById('emptyState').style.display = hasAnim ? 'none' : '';
  document.getElementById('btnSave').disabled = !hasAnim;
  document.getElementById('btnSendEsp').disabled = !hasAnim;
  document.getElementById('btnAddFrame').disabled = !hasAnim;
  document.getElementById('btnDupFrame').disabled = !hasAnim;
  document.getElementById('btnDelFrame').disabled = !hasAnim || frames.length <= 1;
  document.getElementById('btnPreview').disabled = !hasAnim || frames.length < 1;
  document.getElementById('btnPrev').disabled = !hasAnim || currentFrameIndex <= 0;
  document.getElementById('btnNext').disabled = !hasAnim || currentFrameIndex >= frames.length - 1;

  if (!hasAnim) {
    document.getElementById('editorTitle').textContent = '—';
    document.getElementById('frameCounter').textContent = '—';
    document.getElementById('canvasArea').querySelector('.grid-wrapper')?.remove();
    renderFrameStrip();
    return;
  }

  document.getElementById('editorTitle').textContent = anim.name;
  document.getElementById('frameCounter').textContent = `${currentFrameIndex + 1} / ${frames.length}`;

  renderGrid();
  renderFrameStrip();
}

function renderGrid() {
  const anim = animations.find(a => a.id === currentAnimId);
  if (!anim || !frames[currentFrameIndex]) return;

  const frame = frames[currentFrameIndex];
  const W = anim.width, H = anim.height || 8;
  const CELL = calcCell(W, H);

  const area = document.getElementById('canvasArea');
  let wrapper = area.querySelector('.grid-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'grid-wrapper';
    area.appendChild(wrapper);
  }

  let grid = wrapper.querySelector('.pixel-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'pixel-grid';
    wrapper.appendChild(grid);
  }

  // Onion canvas overlay (sopra la griglia, sotto il pointer)
  let onionCv = wrapper.querySelector('#onionCanvas');
  if (!onionCv) {
    onionCv = document.createElement('canvas');
    onionCv.id = 'onionCanvas';
    wrapper.appendChild(onionCv);
  }

  grid.style.gridTemplateColumns = `repeat(${W}, ${CELL}px)`;
  grid.style.gridTemplateRows = `repeat(${H}, ${CELL}px)`;

  // Build or update cells
  const existing = grid.querySelectorAll('.pixel');
  const total = W * H;

  if (existing.length !== total) {
    grid.innerHTML = '';
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const px = document.createElement('div');
        px.className = 'pixel';
        px.dataset.r = r; px.dataset.c = c;
        grid.appendChild(px);
      }
    }
  }

  syncPixels(frame.pixels);
  drawOnionCanvas();

  // Drag support
}

function syncPixels(pixels) {
  const grid = document.querySelector('.pixel-grid');
  if (!grid) return;
  grid.querySelectorAll('.pixel').forEach(px => {
    const r = +px.dataset.r, c = +px.dataset.c;
    const on = pixels[r]?.[c] === 1;
    px.classList.toggle('on', on);
  });
}

// ── PIXEL INTERACTIONS ───────────────────────────────────────────────────────
function onPixelDown(e) {
  e.preventDefault();
  isPainting = true;
  const r = +e.target.dataset.r, c = +e.target.dataset.c;
  const frame = frames[currentFrameIndex];
  if (tool === 'fill') { floodFill(r, c, frame.pixels[r][c]); return; }
  paintValue = tool === 'erase' ? 0 : (frame.pixels[r][c] ? 0 : 1);
  setPixel(r, c, paintValue);
}

function onPixelEnter(e) {
  if (!isPainting || tool === 'fill') return;
  const r = +e.target.dataset.r, c = +e.target.dataset.c;
  setPixel(r, c, paintValue);
}

function setPixel(r, c, val) {
  const frame = frames[currentFrameIndex];
  if (!frame || frame.pixels[r][c] === val) return;
  frame.pixels[r][c] = val;
  markDirty();
  const px = document.querySelector(`.pixel[data-r="${r}"][data-c="${c}"]`);
  if (px) px.classList.toggle('on', val === 1);
}

function floodFill(r, c, target) {
  const frame = frames[currentFrameIndex];
  const replacement = target ? 0 : 1;
  if (target === replacement) return;
  const anim = animations.find(a => a.id === currentAnimId);
  const W = anim.width, H = anim.height || 8;
  const stack = [[r, c]];
  while (stack.length) {
    const [cr, cc] = stack.pop();
    if (cr < 0 || cr >= H || cc < 0 || cc >= W) continue;
    if (frame.pixels[cr][cc] !== target) continue;
    frame.pixels[cr][cc] = replacement;
    stack.push([cr+1,cc],[cr-1,cc],[cr,cc+1],[cr,cc-1]);
  }
  markDirty();
  syncPixels(frame.pixels);
  drawOnionCanvas();
}

// ── ONION SKIN ────────────────────────────────────────────────────────────────
function setOnion(n) {
  onionLayers = n;
  for (let i = 0; i <= 3; i++) {
    document.getElementById(`onion${i}`)?.classList.toggle('active', i === n);
  }
  drawOnionCanvas();
}

// Opacità decrescente per i layer ghost: layer 1 è il più vicino (più visibile)
const ONION_ALPHAS = [0, 0.55, 0.34, 0.20]; // indice = distanza dal frame corrente

function drawOnionCanvas() {
  const canvas = document.getElementById('onionCanvas');
  if (!canvas) return;
  const anim = animations.find(a => a.id === currentAnimId);
  if (!anim || !frames[currentFrameIndex]) { canvas.style.display = 'none'; return; }

  if (onionLayers === 0 || currentFrameIndex === 0) {
    canvas.style.display = 'none';
    return;
  }

  const W = anim.width, H = anim.height || 8;
  const CELL = calcCell(W, H);
  const PAD = 13; // padding della .pixel-grid

  // Dimensioni esatte del contenitore grid-wrapper (include padding + gap)
  // Gap=3, cell=CELL, padding=PAD su ogni lato
  const gridW = PAD * 2 + W * CELL + (W - 1) * 3;
  const gridH = PAD * 2 + H * CELL + (H - 1) * 3;

  canvas.width  = gridW;
  canvas.height = gridH;
  canvas.style.width  = gridW + 'px';
  canvas.style.height = gridH + 'px';
  canvas.style.display = 'block';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, gridW, gridH);

  // Disegna i ghost dal più lontano al più vicino (così quello vicino sta sopra)
  const maxLayers = Math.min(onionLayers, currentFrameIndex);
  for (let dist = maxLayers; dist >= 1; dist--) {
    const fi = currentFrameIndex - dist;
    const f = frames[fi];
    if (!f) continue;
    ctx.globalAlpha = ONION_ALPHAS[dist] ?? 0.10;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (!f.pixels[r]?.[c]) continue;
        const x = PAD + c * (CELL + 3);
        const y = PAD + r * (CELL + 3);
        // Colore blu-viola per distinguerli dai pixel reali arancioni
        ctx.fillStyle = '#ff6b2b';
        ctx.shadowBlur = 0;
        ctx.shadowColor = '#ff6b2b';
        ctx.beginPath();
        ctx.roundRect(x, y, CELL, CELL, 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }
  ctx.globalAlpha = 1;
}


function setTool(t) {
  tool = t;
  ['draw','erase','fill'].forEach(id => {
    document.getElementById('tool'+id.charAt(0).toUpperCase()+id.slice(1))
      ?.classList.toggle('active', id === t);
  });
}

function clearFrame() {
  const frame = frames[currentFrameIndex];
  if (!frame) return;
  frame.pixels = frame.pixels.map(row => row.map(() => 0));
  markDirty();
  syncPixels(frame.pixels);
  drawOnionCanvas();
}

function invertFrame() {
  const frame = frames[currentFrameIndex];
  if (!frame) return;
  frame.pixels = frame.pixels.map(row => row.map(v => v ? 0 : (window.paintColor ? window.paintColor() : 1)));
  markDirty();
  syncPixels(frame.pixels);
  drawOnionCanvas();
}

function shiftLeft() {
  const frame = frames[currentFrameIndex];
  if (!frame) return;
  frame.pixels = frame.pixels.map(row => { const r=[...row]; r.push(r.shift()); return r; });
  markDirty();
  syncPixels(frame.pixels);
  drawOnionCanvas();
}

function shiftRight() {
  const frame = frames[currentFrameIndex];
  if (!frame) return;
  frame.pixels = frame.pixels.map(row => { const r=[...row]; r.unshift(r.pop()); return r; });
  markDirty();
  syncPixels(frame.pixels);
  drawOnionCanvas();
}
