// stream.js: streaming verso la board
//   LIVE   = la board specchia il frame che stai modificando
//   STREAM = il server riproduce l'animazione sulla board in loop, senza caricarla
//   TEST   = mostra quattro pixel colorati agli angoli per controllare l'orientamento (solo colore multiplo)
// Colore "singolo": tutti i pixel accesi hanno il colore scelto in "INVIA A ESP" (come prima).
// Colore "multiplo": ogni pixel usa il suo colore della palette.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const sendBtn = $('btnSendEsp');
  if (!sendBtn) return;

  let ws = null, ready = false, mode = null, linkColor = false;
  let pingTimer = 0, playTimer = 0, palTimer = 0, lastKey = '', sentCount = 0;

  /* ── Interfaccia ── */
  function mkBtn(id, text, title) {
    const b = document.createElement('button');
    b.id = id; b.className = 'btn'; b.textContent = text; b.title = title;
    b.style.borderColor = '#39a86b'; b.style.color = '#39a86b';
    return b;
  }
  const liveBtn = mkBtn('btnLive', '📡 LIVE', 'Specchia sulla board il frame che stai modificando');
  const strmBtn = mkBtn('btnStream', '▶ STREAM', "Riproduce l'animazione sulla board dal server, senza caricarla");
  const testBtn = mkBtn('btnTest', '🧭 TEST', 'Quattro pixel colorati agli angoli (con la rotazione scelta): rosso in alto a sinistra, verde in alto a destra, blu in basso a sinistra, bianco in basso a destra');

  const colorSel = document.createElement('select');
  colorSel.id = 'streamColor';
  colorSel.className = 'stream-color';
  colorSel.title = 'Colore nello streaming';
  colorSel.innerHTML = '<option value="single">Colore: singolo</option><option value="multi">Colore: multiplo</option>';
  try { colorSel.value = localStorage.getItem('pixelanim.streamcolor') === 'multi' ? 'multi' : 'single'; } catch (e) {}

  const fpsBox = document.createElement('input');
  fpsBox.type = 'number'; fpsBox.id = 'streamFps'; fpsBox.className = 'stream-fps';
  fpsBox.min = 1; fpsBox.max = 30; fpsBox.title = 'FPS dello streaming';
  try { fpsBox.value = localStorage.getItem('pixelanim.streamfps') || 8; } catch (e) { fpsBox.value = 8; }

  const info = document.createElement('span');
  info.id = 'streamInfo'; info.className = 'save-state';
  sendBtn.after(liveBtn, strmBtn, colorSel, testBtn, fpsBox, info);

  const isMulti = () => colorSel.value === 'multi';
  function paint() {
    const on = 'rgba(57,168,107,0.25)';
    liveBtn.style.background = mode === 'live' ? on : '';
    strmBtn.style.background = mode === 'play' ? on : '';
    testBtn.style.background = mode === 'test' ? on : '';
    info.textContent = mode ? '● ' + (mode === 'test' ? 'test' : mode === 'live' ? 'live' : 'stream') +
      (linkColor ? ' (multiplo)' : '') + ' → ' + $('espIp').value.trim() +
      (sentCount ? ' · ' + sentCount + ' inviati' : ' · in attesa…') : '';
    info.dataset.state = mode ? 'saved' : '';
  }

  /* ── Conversione ── */
  const is8x8 = () => (animations.find(a => a.id === currentAnimId) || {}).width === 8;
  const fps = () => Math.max(1, Math.min(30, parseInt(fpsBox.value, 10) || 8));
  const bright = () => Math.max(1, Math.min(100, parseInt($('espBright').value, 10) || 100));

  function colorRGB() {
    const hex = $('espColor').value, k = bright() / 100;
    return [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k));
  }
  function frameHex(f) {
    const anim = animations.find(a => a.id === currentAnimId);
    const width = Number(anim?.width) || 8;
    const height = Number(anim?.height) || 8;
    const bytesPerRow = width / 8;

    let out = '';

    for (let r = 0; r < height; r++) {
      for (let block = 0; block < bytesPerRow; block++) {
        let byte = 0;

        for (let bit = 0; bit < 8; bit++) {
          const c = block * 8 + bit;

          if (f.pixels[r] && f.pixels[r][c]) {
            byte |= 1 << (7 - bit);
          }
        }

        out += byte.toString(16).padStart(2, '0');
      }
    }

    return $('espRotate').checked ? rotateHex180(out) : out;
  }
  const TEST_PAL = '000000' + 'ff0000' + '00ff00' + '0000ff' + 'ffffff' + '000000'.repeat(11);
  function makeTestPixels() {
    const anim = animations.find(a => a.id === currentAnimId);
    const width = Number(anim?.width) || 8;
    const height = Number(anim?.height) || 8;

    const g = Array(width * height).fill('0');

    g[0] = '1';
    g[width - 1] = '2';
    g[(height - 1) * width] = '3';
    g[height * width - 1] = '4';

    return g.join('');
  }
  /* ── Connessione ── */
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function connect(multi) {
    return new Promise(function (resolve, reject) {
      const ip = $('espIp').value.trim();
      if (!ip) { openSendModal(); reject(new Error("Inserisci l'IP della board e riprova")); return; }
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const sock = new WebSocket(proto + location.host + '/api/esp/stream');
      let settled = false;
      ws = sock;
      sock.onopen = function () {
        sock.send(JSON.stringify({
          type: 'open', ip: ip, color: multi,
          width: (animations.find(a => a.id === currentAnimId) || {}).width || 8,
          height: (animations.find(a => a.id === currentAnimId) || {}).height || 8,
          port: parseInt($('espPort').value, 10) || 6053,
          key: $('espApiKey').value.trim()
        }));
        pingTimer = setInterval(function () { send({ type: 'ping' }); }, 25000);
      };
      sock.onmessage = function (ev) {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'ready') {
          if (multi && m.color !== true) {         // il server non conosce il colore (versione vecchia)
            settled = true;
            reject(new Error('Il server è una versione vecchia e non supporta il colore: ricostruisci il container (docker compose up -d --build)'));
            sock.close();
            return;
          }
          ready = true; linkColor = multi; settled = true; sentCount = 0; resolve();
        }
        else if (m.type === 'sent') { sentCount = m.n; if (mode) paint(); }
        else if (m.type === 'error') {
          if (!settled) { settled = true; reject(new Error(m.detail || 'Errore')); sock.close(); }
          else toast(m.detail || 'Errore streaming', 'err');
        }
      };
      sock.onclose = function () {
        clearInterval(pingTimer);
        ready = false;
        if (ws === sock) ws = null;
        if (!settled) { settled = true; reject(new Error('Connessione chiusa')); }
        if (mode) { mode = null; paint(); toast('Streaming interrotto', 'err'); }
      };
    });
  }

  /* ── Invio ── */
  function push() {
    if (!ready || !mode) return;
    const rot = $('espRotate').checked;
    if (linkColor) {
      if (mode === 'test') {                    // come lo vedresti in live, con la rotazione scelta
        const key = 'test' + rot;
        if (lastKey !== key) {
          lastKey = key;
          send({ type: 'cframe', pix: rot
          ? makeTestPixels().split('').reverse().join('')
          : makeTestPixels(), pal: TEST_PAL });
        }
        return;
      }
      const P = window.Palette;
      if (!P) { toast('Modulo colore non caricato', 'err'); return; }
      const pal = P.palHex(bright());
      if (mode === 'live') {
        const f = frames[currentFrameIndex];
        if (!f) return;
        const pix = P.pixHex(f.pixels, rot), key = pix + pal;
        if (key === lastKey) return;
        lastKey = key;
        send({ type: 'cframe', pix: pix, pal: pal });
      } else {
        send({ type: 'cplay', frames: frames.map(f => P.pixHex(f.pixels, rot)), fps: fps(), pal: pal, loop: true });
      }
      return;
    }
    const c = colorRGB();
    if (mode === 'live') {
      const f = frames[currentFrameIndex];
      if (!f) return;
      const hex = frameHex(f);
      if (hex === lastKey) return;
      lastKey = hex;
      send({ type: 'frame', hex: hex, r: c[0], g: c[1], b: c[2] });
    } else {
      send({ type: 'play', frames: frames.map(frameHex), fps: fps(), r: c[0], g: c[1], b: c[2], loop: true });
    }
  }

  async function start(m) {
    if (mode === m) { stop(); return; }
    //if (m !== 'test') {
    //  if (!currentAnimId) { toast("Apri prima un'animazione", 'err'); return; }
    //  if (!is8x8()) { toast('Solo matrici 8×8 supportate dal firmware', 'err'); return; }
    //}
    const multi = m === 'test' || isMulti();
    if (mode && linkColor !== multi) {          // cambia il tipo di collegamento: si chiude e si riapre
      stop();
      setTimeout(function () { start(m); }, 700);
      return;
    }
    if (!ready) {
      info.textContent = 'connessione…';
      info.dataset.state = 'saving';
      try { await connect(multi); }
      catch (e) { info.textContent = ''; toast(e.message, 'err'); return; }
    }
    mode = m;
    lastKey = '';
    sentCount = 0;
    paint();
    push();
  }

  function stop() {
    clearTimeout(playTimer);
    mode = null;
    lastKey = '';
    sentCount = 0;
    if (ws) { try { send({ type: 'stop' }); ws.close(); } catch (e) {} }
    paint();
  }

  liveBtn.onclick = function () { start('live'); };
  strmBtn.onclick = function () { start('play'); };
  testBtn.onclick = function () { start('test'); };

  colorSel.addEventListener('change', function () {
    try { localStorage.setItem('pixelanim.streamcolor', colorSel.value); } catch (e) {}
    const m = mode;
    if (m && m !== 'test') { stop(); setTimeout(function () { start(m); }, 700); }
  });

  /* ── Segue le modifiche ── */
  function onChange() {
    if (!mode || mode === 'test') return;
   // if (!is8x8()) { stop(); toast('Streaming fermato: solo matrici 8×8', 'err'); return; }
    if (mode === 'live') push();
    else { clearTimeout(playTimer); playTimer = setTimeout(push, 400); }
  }
  const _markDirty = window.markDirty;
  window.markDirty = function () { _markDirty(); onChange(); };
  const _renderEditor = window.renderEditor;
  window.renderEditor = function () { _renderEditor(); onChange(); };

  // cambio di colori della palette: si rimanda tutto con la palette nuova
  document.addEventListener('palettechange', function () {
    lastKey = '';
    if (mode && mode !== 'test' && linkColor) { clearTimeout(palTimer); palTimer = setTimeout(push, 150); }
  });

  ['espColor', 'espBright', 'espRotate'].forEach(function (id) {
    $(id).addEventListener('change', function () { lastKey = ''; if (mode) push(); });
  });
  fpsBox.addEventListener('change', function () {
    try { localStorage.setItem('pixelanim.streamfps', fpsBox.value); } catch (e) {}
    if (mode === 'play') push();
  });
})();
