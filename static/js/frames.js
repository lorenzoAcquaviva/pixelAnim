// ── FRAMES ───────────────────────────────────────────────────────────────────

// ── SAVE ─────────────────────────────────────────────────────────────────────

// Mappa dei frame modificati: frame_index → pixels
// Tracciamo ogni modifica individualmente invece di un singolo isDirty
const dirtyFrames = new Set();

function markDirty() {
  isDirty = true;
  dirtyFrames.add(currentFrameIndex);
}

async function saveAllDirtyFrames() {
  if (!currentAnimId || dirtyFrames.size === 0) return;
  const saves = [...dirtyFrames].map(idx => {
    const f = frames[idx];
    if (!f) return Promise.resolve();
    return api.saveFrame(currentAnimId, f.frame_index, f.pixels);
  });
  await Promise.all(saves);
  dirtyFrames.clear();
  isDirty = false;
}

async function saveCurrentFrame() {
  if (!currentAnimId) return;
  const frame = frames[currentFrameIndex];
  await api.saveFrame(currentAnimId, frame.frame_index, frame.pixels);
  dirtyFrames.delete(currentFrameIndex);
  isDirty = dirtyFrames.size > 0;
  renderFrameStrip();
  toast(`Frame ${currentFrameIndex + 1} salvato ✓`, 'ok');
}

async function saveCurrentFrameSilent() {
  if (!currentAnimId || !dirtyFrames.has(currentFrameIndex)) return;
  const frame = frames[currentFrameIndex];
  await api.saveFrame(currentAnimId, frame.frame_index, frame.pixels);
  dirtyFrames.delete(currentFrameIndex);
  isDirty = dirtyFrames.size > 0;
}

function prevFrame() {
  if (currentFrameIndex > 0) { currentFrameIndex--; renderEditor(); }
}
function nextFrame() {
  if (currentFrameIndex < frames.length - 1) { currentFrameIndex++; renderEditor(); }
}

async function addFrame(duplicate) {
  if (!currentAnimId) return;
  await saveAllDirtyFrames();  // salva TUTTI i frame modificati prima di ricaricare
  const copyFrom = duplicate ? currentFrameIndex : null;
  const newFrame = await api.addFrame(currentAnimId, copyFrom);
  frames = await api.getFrames(currentAnimId);
  currentFrameIndex = frames.findIndex(f => f.id === newFrame.id);
  animations = await api.getAnimations();
  dirtyFrames.clear();
  isDirty = false;
  renderEditor();
  renderSidebar();
  toast('Frame aggiunto', 'ok');
}

async function deleteCurrentFrame() {
  if (!currentAnimId || frames.length <= 1) return;
  if (!confirm(`Eliminare frame ${currentFrameIndex + 1}?`)) return;
  await saveAllDirtyFrames();  // salva prima di eliminare
  await api.deleteFrame(currentAnimId, currentFrameIndex);
  frames = await api.getFrames(currentAnimId);
  if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
  animations = await api.getAnimations();
  dirtyFrames.clear();
  isDirty = false;
  renderEditor();
  renderSidebar();
  toast('Frame eliminato', 'ok');
}

async function selectFrame(idx) {
  await saveCurrentFrameSilent();
  currentFrameIndex = idx;
  renderEditor();
}

// ── FRAME STRIP ──────────────────────────────────────────────────────────────
function renderFrameStrip() {
  const strip = document.getElementById('frameStrip');
  if (!currentAnimId || !frames.length) { strip.innerHTML = ''; return; }
  const anim = animations.find(a => a.id === currentAnimId);
  const W = anim?.width || 8, H = anim?.height || 8;

  strip.innerHTML = frames.map((f, i) => {
    const id = `fthumb_${i}`;
    return `
      <div class="frame-thumb ${i === currentFrameIndex ? 'active' : ''}" onclick="selectFrame(${i})" id="${id}">
        <canvas class="mini" id="miniCanvas_${i}" width="${W}" height="${H}"
          style="width:${Math.round(96*W/Math.max(W,H))}px;height:${Math.round(96*H/Math.max(W,H))}px"></canvas>
        <div class="frame-num">${i+1}</div>
        ${frames.length > 1 ? `<button class="fdel" onclick="event.stopPropagation();deleteFrameByIndex(${i})">✕</button>` : ''}
      </div>`;
  }).join('');

  // Draw thumbnails
  requestAnimationFrame(() => {
    frames.forEach((f, i) => {
      const cv = document.getElementById(`miniCanvas_${i}`);
      if (!cv) return;
      drawMini(cv, f.pixels, W, H);
    });
  });
}

function drawMini(canvas, pixels, W, H) {
  H = H || pixels.length;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      ctx.fillStyle = pixels[r]?.[c] ? '#ff6b2b' : '#28314d';
      ctx.fillRect(c, r, 1, 1);
    }
  }
}

async function deleteFrameByIndex(idx) {
  if (frames.length <= 1) return;
  if (!confirm(`Eliminare frame ${idx + 1}?`)) return;
  await saveCurrentFrameSilent();
  await api.deleteFrame(currentAnimId, frames[idx].frame_index);
  frames = await api.getFrames(currentAnimId);
  if (currentFrameIndex >= frames.length) currentFrameIndex = frames.length - 1;
  animations = await api.getAnimations();
  isDirty = false;
  renderEditor();
  renderSidebar();
}
