// ── PREVIEW ──────────────────────────────────────────────────────────────────
function openPreview() {
  if (!frames.length) return;
  document.getElementById('previewModal').classList.add('open');
  previewFrame = 0;
  previewPlaying = true;
  document.getElementById('btnPlayPause').textContent = '⏸ PAUSA';
  startPreview();
}

function closePreview() {
  document.getElementById('previewModal').classList.remove('open');
  clearInterval(previewTimer);
}

function startPreview() {
  clearInterval(previewTimer);
  const fps = parseInt(document.getElementById('fpsSlider').value);
  document.getElementById('fpsVal').textContent = fps;
  if (!previewPlaying) return;
  previewTimer = setInterval(() => {
    drawPreviewFrame();
    previewFrame = (previewFrame + 1) % frames.length;
  }, 1000 / fps);
}

function drawPreviewFrame() {
  const anim = animations.find(a => a.id === currentAnimId);
  if (!anim) return;
  const W = anim.width, H = anim.height || 8;
  const canvas = document.getElementById('previewCanvas');
  const scale = Math.max(1, Math.floor(320 / Math.max(W, H)));
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#10131c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const f = frames[previewFrame];
  if (!f) return;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (f.pixels[r]?.[c]) {
        ctx.fillStyle = '#ff6b2b';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ff6b2b';
        ctx.fillRect(c*scale+1, r*scale+1, scale-2, scale-2);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#28314d';
        ctx.fillRect(c*scale+1, r*scale+1, scale-2, scale-2);
      }
    }
  }
}

function togglePlay() {
  previewPlaying = !previewPlaying;
  document.getElementById('btnPlayPause').textContent = previewPlaying ? '⏸ PAUSA' : '▶ PLAY';
  startPreview();
}

document.getElementById('fpsSlider').addEventListener('input', () => {
  document.getElementById('fpsVal').textContent = document.getElementById('fpsSlider').value;
  startPreview();
});

// Close modal on overlay click
document.getElementById('previewModal').addEventListener('click', function(e) {
  if (e.target === this) closePreview();
});
