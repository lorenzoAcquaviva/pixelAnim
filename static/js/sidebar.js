// ── SIDEBAR ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('animList');
  document.getElementById('animCount').textContent = animations.length;
  if (!animations.length) {
    list.innerHTML = `<div class="empty-state" style="padding:24px;font-size:0.75rem">Nessuna animazione.<br>Creane una!</div>`;
    return;
  }
  list.innerHTML = animations.map(a => `
    <div class="anim-card ${a.id === currentAnimId ? 'active' : ''}" onclick="selectAnimation(${a.id})">
      <div class="anim-name">${esc(a.name)}</div>
      <div class="anim-meta">
        <span class="tag ${a.width === 32 ? 'w32' : (a.width === 16 ? 'w16' : 'w8')}">${a.width}×${a.height}</span>
        <span>${a.frame_count} frame${a.frame_count !== 1 ? 's' : ''}</span>
      </div>
      <button class="anim-del" onclick="event.stopPropagation();deleteAnimation(${a.id})" title="Elimina">✕</button>
    </div>
  `).join('');
}

// ── ANIMATION CRUD ───────────────────────────────────────────────────────────
async function createAnimation() {
  const name = document.getElementById('newAnimName').value.trim();
  const [width, height] = document.getElementById('newAnimWidth').value.split('x').map(Number);
  if (!name) { toast('Inserisci un nome', 'err'); return; }
  const anim = await api.createAnimation(name, width, height);
  document.getElementById('newAnimName').value = '';
  animations = await api.getAnimations();
  renderSidebar();
  await selectAnimation(anim.id);
  toast('Animazione creata', 'ok');
}

async function deleteAnimation(id) {
  if (!confirm('Eliminare questa animazione?')) return;
  await api.deleteAnimation(id);
  if (currentAnimId === id) {
    currentAnimId = null;
    frames = [];
    renderEditor();
  }
  animations = await api.getAnimations();
  renderSidebar();
  toast('Animazione eliminata', 'ok');
}

async function promptRename() {
  if (!currentAnimId) return;
  const anim = animations.find(a => a.id === currentAnimId);
  const name = prompt('Nuovo nome:', anim?.name || '');
  if (!name || !name.trim()) return;
  await api.renameAnimation(currentAnimId, name.trim());
  animations = await api.getAnimations();
  renderSidebar();
  document.getElementById('editorTitle').textContent = name.trim();
  toast('Rinominata', 'ok');
}

// ── SELECT ANIMATION ─────────────────────────────────────────────────────────
async function selectAnimation(id) {
  if (isDirty) {
    await saveAllDirtyFrames();
  }
  currentAnimId = id;
  currentFrameIndex = 0;
  dirtyFrames.clear();
  isDirty = false;
  frames = await api.getFrames(id);
  renderEditor();
  renderSidebar();
}
