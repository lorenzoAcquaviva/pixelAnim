// send-color.js: "INVIA A ESP" con colore singolo o multiplo.
//   singolo  = come prima (animazione monocolore, un solo colore per tutti i pixel accesi)
//   multiplo = animazione con la palette: ogni pixel ha il suo colore (fino a 256 frame, 16 colori)
// Il menu del colore è lo stesso dello streaming (#streamColor): cambiandone uno cambia anche l'altro.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const modal = $('espModal'), preview = $('espHexPreview');
  // Buffer firmware configurato a 8192 byte; 4 bit per pixel.
  function dimensions() {
    const a = animations.find(x => x.id === currentAnimId) || {};
    return { width: Number(a.width) || 8, height: Number(a.height) || 8 };
  }
  function bytesPerFrame() { const d = dimensions(); return d.width * d.height / 2; }
  function maxFrames() { return Math.floor(8192 / bytesPerFrame()); }
  /* ── Campi nella finestra ESP ── */
  const row = document.createElement('div');
  row.className = 'esp-color-row';
  row.innerHTML =
    '<div><label>COLORE</label>' +
      '<select id="espColorMode"><option value="single">singolo</option><option value="multi">multiplo (palette)</option></select></div>' +
    '<div class="esp-multi-only"><label>FPS</label><input type="number" id="espAnimFps" min="1" max="30" value="8"></div>' +
    '<div class="esp-multi-only esp-save"><input type="checkbox" id="espSave" checked>' +
      '<label for="espSave" title="Spento: l\'animazione resta solo in RAM e sparisce al riavvio della scheda">salva nella memoria della scheda</label></div>';
  preview.parentElement.before(row);

  const sel = $('espColorMode'), fpsIn = $('espAnimFps'), saveIn = $('espSave'), streamSel = $('streamColor');
  const isMulti = () => sel.value === 'multi';

  try {
    fpsIn.value = localStorage.getItem('pixelanim.animfps') || 8;
    saveIn.checked = localStorage.getItem('pixelanim.animsave') !== '0';
  } catch (e) {}
  fpsIn.addEventListener('change', () => { try { localStorage.setItem('pixelanim.animfps', fpsIn.value); } catch (e) {} });
  saveIn.addEventListener('change', () => { try { localStorage.setItem('pixelanim.animsave', saveIn.checked ? '1' : '0'); } catch (e) {} });

  function refresh() {
    if (streamSel) sel.value = streamSel.value;
    row.classList.toggle('multi', isMulti());
    $('btnEspSend').textContent = isMulti() ? '⬆ INVIA (colore)' : '⬆ INVIA';
  }
  sel.addEventListener('change', function () {
    row.classList.toggle('multi', isMulti());
    $('btnEspSend').textContent = isMulti() ? '⬆ INVIA (colore)' : '⬆ INVIA';
    if (streamSel) {                       // stesso menu dello streaming
      streamSel.value = sel.value;
      streamSel.dispatchEvent(new Event('change'));
    }
    $('espHexPreview').textContent = '—';
    $('espHexInfo').textContent = '';
  });
  if (streamSel) streamSel.addEventListener('change', refresh);
  refresh();

  /* ── Costruzione dell'animazione a colori ── */
  function build() {
    const P = window.Palette, rot = $('espRotate').checked;
    const bright = Math.max(1, Math.min(100, parseInt($('espBright').value, 10) || 100));
    if (!frames.length) { setEspStatus('Animazione vuota', 'err'); return null; }
    if (frames.length > maxFrames()) {
      setEspStatus('Troppi frame per la scheda: ' + frames.length + ' (massimo ' + maxFrames() + ' per ' + dimensions().width + '×' + dimensions().height + ')', 'err');
      return null;
    }
    const list = frames.map(f => P.pixHex(f.pixels, rot));
    if (list.every(h => /^0+$/.test(h))) { setEspStatus('Animazione vuota — nessun pixel acceso', 'err'); return null; }
    return { frames: list, pal: P.palHex(bright), fps: Math.max(1, Math.min(30, parseInt(fpsIn.value, 10) || 8)) };
  }

  /* ── Anteprima dei dati e invio ── */
  const _preview = window.previewEspHex, _send = window.sendToEsp, _open = window.openSendModal;

  window.previewEspHex = function () {
    if (!isMulti()) return _preview();
    const b = build();
    if (!b) return;
    const shown = b.frames.slice(0, 4).join('\n');
    $('espHexPreview').textContent = shown + (b.frames.length > 4 ? '\n… (' + (b.frames.length - 4) + ' altri)' : '') + '\npalette: ' + b.pal;
    $('espHexInfo').textContent = '— ' + b.frames.length + ' frame × ' + bytesPerFrame() + ' byte = ' + (b.frames.length * bytesPerFrame()) + ' byte, ' + b.fps + ' fps';  };

  async function sendColor() {
    const ip = $('espIp').value.trim();
    if (!ip) { setEspStatus("Inserisci l'IP del dispositivo", 'err'); return; }
    const b = build();
    if (!b) return;
    const port = parseInt($('espPort').value, 10) || 6053;
    setEspStatus('⏳ Invio in corso…', 'info');
    $('btnEspSend').disabled = true;
    try {
      const resp = await fetch('/api/esp/send_color', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ip, port: port, api_key: $('espApiKey').value.trim(), width: dimensions().width, height: dimensions().height, frames: b.frames, palette: b.pal, fps: b.fps, save: saveIn.checked })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setEspStatus('✓ Inviato! ' + data.frames + ' frame a colori · ' + data.bytes + ' byte → ' + ip + (saveIn.checked ? ' (salvata sulla scheda)' : ' (solo in RAM)'), 'ok');
        toast('Animazione a colori inviata ✓', 'ok');
      } else {
        setEspStatus('✗ ' + (data.detail || 'HTTP ' + resp.status), 'err');
      }
    } catch (e) {
      setEspStatus('✗ Errore imprevisto: ' + e.message, 'err');
    } finally {
      $('btnEspSend').disabled = false;
    }
  }

  window.sendToEsp = function () { return isMulti() ? sendColor() : _send(); };
  window.openSendModal = function () { refresh(); return _open(); };
})();
