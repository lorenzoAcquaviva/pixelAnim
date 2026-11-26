// ── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  animations = await api.getAnimations();
  renderSidebar();
}
init();
