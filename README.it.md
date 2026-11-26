# PixelAnim

PixelAnim è un editor di animazioni pixel via browser e backend di streaming verso matrici LED ESPHome. Include editor a frame, palette a 16 colori (4 bit per pixel), editor a nodi e streaming live.

## Formati matrice

Backend ed editor supportano queste dimensioni logiche:

| Matrice | Payload monocromatico | Payload colore 4 bit |
|---|---:|---:|
| 8×8 | 8 byte / 16 caratteri hex | 32 byte / 64 caratteri hex |
| 32×8 | 32 byte / 64 caratteri hex | 128 byte / 256 caratteri hex |
| 16×16 | 32 byte / 64 caratteri hex | 128 byte / 256 caratteri hex |

I pixel sono serializzati per righe, dall'angolo in alto a sinistra. Il monocromatico usa un bit per pixel (bit più significativo per primo in ogni byte); il colore usa un nibble esadecimale per pixel e una palette RGB separata da 16 voci. 32×8 e 16×16 hanno la stessa lunghezza del payload, ma geometria diversa.

**Nota firmware:** il percorso backend/editor 16×16 è predisposto, ma non è ancora inclusa una configurazione firmware ESPHome 16×16. Il firmware dovrà esporre i servizi configurati e interpretare il payload nello stesso ordine row-major. Il firmware 8×8 esistente è il riferimento per nomi dei servizi e convenzioni dei payload; non bisogna presumere che pin, mappatura LED o configurazione hardware siano riutilizzabili su una board 16×16.

## Avvio con Docker Compose

1. Copiare il file di esempio per le variabili d'ambiente:

   ```sh
   cp .env.example .env
   ```

2. Avviare l'applicazione:

   ```sh
   docker compose -f docker-compose.example.yml up -d --build
   ```

3. Aprire [http://localhost:9900](http://localhost:9900).

Il database SQLite viene conservato nel volume Docker `pixelanim_data`. Il compose di esempio è volutamente generico: adattare porte, volumi, UID/GID, etichette reverse proxy e reti al proprio ambiente. Non sostituire alla cieca un compose personale già esistente.

## Servizi ESPHome

Nomi predefiniti (configurabili tramite variabili d'ambiente):

- `mostra_frame`: frame monocromatico live
- `mostra_frame_colore`: frame live con indici colore e palette
- `ferma_stream`: arresta lo streaming live e ripristina lo stato precedente del firmware
- `carica_animazione_colore`: caricamento opzionale di un'animazione colore salvata
- `carica_animazione`: caricamento opzionale di un'animazione monocromatica

Il backend mantiene sia le animazioni salvate sia gli endpoint di streaming. Lo streaming non richiede di caricare un'animazione sulla scheda. I limiti di riferimento dei buffer sono 2048 byte per le animazioni monocromatiche salvate e 8192 byte per quelle a colori; i limiti effettivi devono corrispondere al firmware.

## Sicurezza e pubblicazione

L'applicazione attualmente **non include autenticazione o autorizzazione utenti**. Le chiavi API ESPHome sono credenziali sensibili che consentono di controllare i dispositivi. Mantenere il servizio su una LAN fidata oppure proteggerlo con reverse proxy autenticato/VPN prima di consentire accessi remoti. Non esporre direttamente la porta 9900 su Internet.

Non pubblicare mai `.env`, database, log, backup o configurazioni personali di deployment. Nel repository pubblico devono esserci `.env.example` e `docker-compose.example.yml`, non segreti o dettagli dell'infrastruttura privata. Prima di rendere pubblico un repository Git già esistente, controllare tutta la cronologia: rimuovere un segreto dai file correnti non lo elimina dai commit precedenti.

## Sviluppo

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
DB_PATH=./data/pixelanim.db uvicorn main:app --host 127.0.0.1 --port 9900
```

Se non esiste, creare la directory `data` prima dell'avvio.

## Licenza

Non è ancora stata scelta una licenza. Fino all'aggiunta di una licenza, la pubblicazione del codice non implica automaticamente il permesso di riutilizzarlo o ridistribuirlo.
