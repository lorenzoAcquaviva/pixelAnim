// ── API ──────────────────────────────────────────────────────────────────────
const api = {
  async getAnimations() {
    const r = await fetch('/api/animations');
    return r.json();
  },
  async createAnimation(name, width, height = 8) {
    const r = await fetch('/api/animations', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({name, width: parseInt(width, 10), height: parseInt(height, 10)})
    });
    return r.json();
  },
  async renameAnimation(id, name) {
    return fetch(`/api/animations/${id}`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({name})
    });
  },
  async deleteAnimation(id) {
    return fetch(`/api/animations/${id}`, {method: 'DELETE'});
  },
  async getFrames(animId) {
    const r = await fetch(`/api/animations/${animId}/frames`);
    return r.json();
  },
  async addFrame(animId, copyFrom = null) {
    const url = copyFrom !== null
      ? `/api/animations/${animId}/frames?copy_from=${copyFrom}`
      : `/api/animations/${animId}/frames`;
    const r = await fetch(url, {method: 'POST'});
    return r.json();
  },
  async saveFrame(animId, frameIndex, pixels) {
    return fetch(`/api/animations/${animId}/frames/${frameIndex}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({pixels})
    });
  },
  async deleteFrame(animId, frameIndex) {
    return fetch(`/api/animations/${animId}/frames/${frameIndex}`, {method:'DELETE'});
  }
};
