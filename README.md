# PixelAnim

PixelAnim is a browser-based pixel-animation editor and ESPHome streaming backend for LED matrices. It includes a frame editor, palette-based 4-bit color, a node-graph editor and live streaming.

## Matrix formats

The backend and editor support these logical matrix sizes:

| Matrix | Monochrome payload | 4-bit color payload |
|---|---:|---:|
| 8×8 | 8 bytes / 16 hex chars | 32 bytes / 64 hex chars |
| 32×8 | 32 bytes / 64 hex chars | 128 bytes / 256 hex chars |
| 16×16 | 32 bytes / 64 hex chars | 128 bytes / 256 hex chars |

Pixels are serialized row-major, from the top-left, row by row. Monochrome uses one bit per pixel (most-significant bit first within each byte); color uses one hexadecimal nibble per pixel and a separate 16-entry RGB palette. The 32×8 and 16×16 formats have the same payload length but different geometry.

**Firmware note:** the 16×16 backend/editor path is prepared, but a matching 16×16 ESPHome firmware configuration is not included yet. The target firmware must expose the configured services and interpret the payload in the same row-major order. The existing 8×8 firmware remains the reference for service names and payload conventions; do not assume its pins, LED mapping, or hardware setup apply to a 16×16 board.

## Run with Docker Compose

1. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

2. Start the application:

   ```sh
   docker compose -f docker-compose.example.yml up -d --build
   ```

3. Open [http://localhost:9900](http://localhost:9900).

The SQLite database is stored in the named `pixelanim_data` volume. The example compose file is intentionally generic; adapt ports, volumes, user IDs, reverse-proxy labels, and networks to your own deployment. Do not replace an existing personal compose file blindly.

## ESPHome services

Default service names (configurable with environment variables):

- `mostra_frame`: monochrome live frame
- `mostra_frame_colore`: indexed-color live frame and palette
- `ferma_stream`: stop live streaming / restore previous firmware state
- `carica_animazione_colore`: optional upload of a stored color animation
- `carica_animazione`: optional monochrome animation upload

The backend keeps both saved animations and streaming endpoints. Streaming does not require uploading an animation to the board. The reference buffer limits are 2048 bytes for monochrome saved animations and 8192 bytes for color saved animations; actual limits must match the firmware.

## Security and public deployment

The application currently has **no built-in user authentication or authorization**. ESPHome API keys are powerful device credentials. Keep the service on a trusted LAN or protect it with an authenticated reverse proxy/VPN before allowing remote access. Do not expose port 9900 directly to the public Internet.

Never commit `.env`, database files, logs, backups, or personal deployment configuration. The public repository should contain `.env.example` and `docker-compose.example.yml`, not local secrets or private infrastructure details. Check the full Git history before making an existing repository public: removing a secret from the latest files does not remove it from earlier commits.

## Development

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
DB_PATH=./data/pixelanim.db uvicorn main:app --host 127.0.0.1 --port 9900
```

Create the `data` directory before starting if it does not exist.

## License

No license has been selected yet. Until a license is added, do not assume that public availability grants permission to reuse or redistribute the code.
