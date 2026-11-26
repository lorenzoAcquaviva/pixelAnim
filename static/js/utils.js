// ── UTILS ─────────────────────────────────────────────────────────────────────
function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// Prevent context menu on grid
document.addEventListener('contextmenu', e => {
  if (e.target.classList.contains('pixel')) e.preventDefault();
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') prevFrame();
  if (e.key === 'ArrowRight') nextFrame();
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveCurrentFrame(); }
  if (e.key === 'd') setTool('draw');
  if (e.key === 'e') setTool('erase');
  if (e.key === 'f') setTool('fill');
});
