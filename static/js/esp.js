// ── ESPHOME SEND ──────────────────────────────────────────────────────────────

/**
 * Converte l'animazione corrente nel formato hex stream per ESPHome.
 * Un bit per pixel, righe in ordine top-to-bottom e bit MSB per primo.
 */

/**
 * Converte l'animazione nel formato hex stream per ESPHome.
 * Ogni riga occupa width / 8 byte, con bit MSB = colonna 0.
 * 8×8 = 8 byte; 32×8 e 16×16 = 32 byte per frame.
 */
function animToHex() {
  const hexBytes = [];
  const anim = animations.find(a => a.id === currentAnimId);
  const width = Number(anim?.width) || 8;
  const height = Number(anim?.height) || 8;
  const bytesPerRow = width / 8;
  console.log('[PixelAnim DEBUG]', {
    currentAnimId,
    anim,
    animWidth: anim?.width,
    widthUsata: width,
    numeroFrame: frames.length,
    pixelRiga0: frames[0]?.pixels?.[0]?.length,
    pixelRiga0Dati: frames[0]?.pixels?.[0]
  });

  for (const f of frames) {
    for (let r = 0; r < height; r++) {
      for (let block = 0; block < bytesPerRow; block++) {
        let byte = 0;

        for (let bit = 0; bit < 8; bit++) {
          const c = block * 8 + bit;

          if (f.pixels[r]?.[c]) {
            byte |= (1 << (7 - bit));
          }
        }

        hexBytes.push(byte.toString(16).padStart(2, '0'));
      }
    }
  }
  console.log('[PixelAnim HEX]', {
    caratteri: hexBytes.join('').length,
    bytePerFrame: hexBytes.length / frames.length,
    hex: hexBytes.join('')
  });
  return hexBytes.join('');
}


/**
 * Ruota l'animazione di 180°:
 * - inverte l'ordine delle righe dentro ogni frame (flip verticale)
 * - inverte i bit di ogni byte (flip orizzontale)
 * Equivale a una rotazione di 180° della matrice.
 */

/**
 * Ruota ogni frame di 180°.
 * Supporta matrici 8×8, 32×8 e 16×16 (firmware compatibile richiesto).
 */
function rotateHex180(hex) {
  const anim = animations.find(a => a.id === currentAnimId);
  const width = Number(anim?.width) || 8;
  const height = Number(anim?.height) || 8;
  const bytesPerRow = width / 8;
  const bytesPerFrame = height * bytesPerRow;
  const result = [];

  for (let offset = 0; offset < hex.length; offset += bytesPerFrame * 2) {
    const rows = [];

    for (let r = 0; r < height; r++) {
      const row = [];

      for (let b = 0; b < bytesPerRow; b++) {
        const pos = offset + (r * bytesPerRow + b) * 2;
        row.push(parseInt(hex.slice(pos, pos + 2), 16));
      }

      rows.push(row);
    }

    // Inverti righe e byte, quindi inverti i bit di ogni byte.
    rows.reverse();

    for (const row of rows) {
      row.reverse();

      for (const value of row) {
        let mirrored = 0;

        for (let bit = 0; bit < 8; bit++) {
          if (value & (1 << bit)) {
            mirrored |= (1 << (7 - bit));
          }
        }

        result.push(mirrored.toString(16).padStart(2, '0'));
      }
    }
  }

  return result.join('');
}


function openSendModal() {
  if (!currentAnimId) return;
  const anim = animations.find(a => a.id === currentAnimId);
  //if (anim?.width !== 8) {
  //  toast('Solo matrici 8×8 supportate dal firmware', 'err');
  //  return;
  //}
  // Ripristina stato
  document.getElementById('espStatus').textContent = '';
  document.getElementById('espHexPreview').textContent = '—';
  document.getElementById('espHexInfo').textContent = '';
  document.getElementById('espModal').classList.add('open');
}

function closeEspModal() {
  document.getElementById('espModal').classList.remove('open');
}

function previewEspHex() {
  const rotate = document.getElementById('espRotate').checked;
  const hex = rotate ? rotateHex180(animToHex()) : animToHex();
  const frameCount = frames.length;
  const byteCount = hex.length / 2;
  document.getElementById('espHexPreview').textContent = hex;

  const anim = animations.find(a => a.id === currentAnimId);
  const width = Number(anim?.width) || 8;
  const height = Number(anim?.height) || 8;
  const bytesPerFrame = width * height / 8;
  document.getElementById('espHexInfo').textContent =
    `— ${frameCount} frame × ${bytesPerFrame} byte = ${byteCount} byte totali${rotate ? ' [ruotato 180°]' : ''}`;
}

async function sendToEsp() {
  const anim = animations.find(a => a.id === currentAnimId);
  const ip = document.getElementById('espIp').value.trim();
  const port = parseInt(document.getElementById('espPort').value) || 6053;
  const api_key = document.getElementById('espApiKey').value.trim();
  if (!ip) { setEspStatus('Inserisci l\'IP del dispositivo', 'err'); return; }

  // Calcola colore moltiplicato per luminosità
  const colorHex = document.getElementById('espColor').value;
  const bright = Math.max(1, Math.min(100, parseInt(document.getElementById('espBright').value) || 100)) / 100;
  const r = Math.round(parseInt(colorHex.slice(1,3), 16) * bright);
  const g = Math.round(parseInt(colorHex.slice(3,5), 16) * bright);
  const b = Math.round(parseInt(colorHex.slice(5,7), 16) * bright);

  const rotate = document.getElementById('espRotate').checked;
  const hex = rotate ? rotateHex180(animToHex()) : animToHex();
  if (hex.length / 2 > 2048) {
    setEspStatus('Animazione troppo grande: il buffer monocromatico è limitato a 2048 byte', 'err');
    return;
  }
  if (!hex || hex === '0'.repeat(hex.length)) {
    setEspStatus('Animazione vuota — nessun pixel acceso', 'err');
    return;
  }

  setEspStatus('⏳ Invio in corso…', 'info');
  document.getElementById('btnEspSend').disabled = true;

  try {
    const resp = await fetch('/api/esp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port, api_key, width: anim?.width || 8, height: anim?.height || 8, hex_stream: hex, color_r: r, color_g: g, color_b: b }),
    });

    const data = await resp.json();

    if (resp.ok && data.ok) {
      setEspStatus(`✓ Inviato! ${frames.length} frame · ${hex.length/2} byte → ${ip}:${port}`, 'ok');      toast('Animazione inviata al dispositivo ✓', 'ok');
    } else {
      const detail = data.detail || `HTTP ${resp.status}`;
      setEspStatus(`✗ ${detail}`, 'err');
    }
  } catch (err) {
    setEspStatus(`✗ Errore imprevisto: ${err.message}`, 'err');
  } finally {
    document.getElementById('btnEspSend').disabled = false;
  }
}

function setEspStatus(msg, type) {
  const el = document.getElementById('espStatus');
  const colors = { ok: '#39a86b', err: '#ff3a6e', info: '#7aaae8' };
  el.style.color = colors[type] || 'var(--text-dim)';
  el.textContent = msg;
}

// Chiudi modal ESP su overlay click
document.getElementById('espModal').addEventListener('click', function(e) {
  if (e.target === this) closeEspModal();
});
