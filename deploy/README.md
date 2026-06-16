# PrivaTools Production Deploy

Target: Oracle VM, `140.245.15.140`, domain `privatools.me`.

This directory contains the production-side artifacts. Everything here is checked into git so the VM is fully reproducible from `origin/main`.

## Current Docker VM Auto-Deploy

The live Oracle VM checkout is `/home/ubuntu/privatools` and runs with Docker Compose. Install the GitHub polling deploy timer once from that checkout:

```bash
cd /home/ubuntu/privatools
sudo bash deploy/oracle-vm/install-auto-deploy.sh
```

That installs:

- `/usr/local/bin/privatools-auto-deploy`
- `privatools-auto-deploy.service`
- `privatools-auto-deploy.timer`

The timer checks `origin/main` every minute. If a new commit exists, it resets the checkout to that commit, runs `docker compose up -d --build`, prunes dangling images, and waits for `http://127.0.0.1:8000/api/health`.

Useful commands:

```bash
systemctl list-timers --all | grep privatools-auto-deploy
sudo systemctl status privatools-auto-deploy.service
sudo journalctl -u privatools-auto-deploy.service -n 120 --no-pager
```

## Layout on the VM

```
/opt/privatool/                 # git clone of this repo (origin/main)
  .env                          # secrets — never committed, copied from .env.example
  .venv/                        # Python venv with requirements.txt installed
  backend/                      # FastAPI app
  frontend/                     # Vite SPA (with node_modules and dist/)
  tmp/                          # upload scratch (ReadWritePaths in systemd unit)
  deploy/deploy.sh              # day-2 deploy script (this folder, after git pull)
```

## One-time setup

Run these as a sudoer once per fresh VM.

### 1. System packages

```bash
sudo apt update
sudo apt install -y \
    python3.12 python3.12-venv python3.12-dev \
    nginx certbot python3-certbot-nginx \
    ffmpeg libreoffice tesseract-ocr ghostscript poppler-utils \
    fonts-dejavu fonts-liberation \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 libffi-dev shared-mime-info \
    nodejs npm \
    git curl
```

Notes:
- `ffmpeg` from Ubuntu 22.04/24.04 is fine (>= 4.4) — the audio/video tools rely on this.
- `libreoffice` is required for Office <-> PDF conversion. ~1.5 GB install.
- `tesseract-ocr` provides English data; install `tesseract-ocr-*` packages for additional languages on demand.
- For Brotli at the nginx layer install `libnginx-mod-brotli` (optional — see `nginx.conf`).

### 2. App user + directory layout

```bash
sudo useradd --system --create-home --home-dir /opt/privatool --shell /usr/sbin/nologin privatool
sudo chown -R privatool:privatool /opt/privatool
sudo -u privatool mkdir -p /opt/privatool/tmp
```

### 3. Clone + venv

```bash
sudo -u privatool git clone https://github.com/<owner>/priva-tool.git /opt/privatool
cd /opt/privatool
sudo -u privatool python3.12 -m venv .venv
sudo -u privatool .venv/bin/pip install --upgrade pip wheel
sudo -u privatool .venv/bin/pip install -r requirements.txt
```

### 4. Env file

```bash
sudo cp /opt/privatool/.env.example /opt/privatool/.env
sudo chown privatool:privatool /opt/privatool/.env
sudo chmod 0600 /opt/privatool/.env
sudoedit /opt/privatool/.env   # populate real values
```

### 5. Frontend build

```bash
cd /opt/privatool/frontend
sudo -u privatool npm ci
sudo -u privatool npm run build
```

### 6. Systemd unit

```bash
sudo cp /opt/privatool/deploy/privatool-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now privatool-backend
sudo systemctl status privatool-backend
```

### 7. TLS + nginx

```bash
# Issue cert first (use --nginx if nginx is already serving, --standalone if not).
sudo certbot certonly --nginx -d privatools.com -d www.privatools.com

# Drop our config in place.
sudo cp /opt/privatool/deploy/nginx.conf /etc/nginx/sites-available/privatool
sudo ln -sf /etc/nginx/sites-available/privatool /etc/nginx/sites-enabled/privatool
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Deploy script permission

```bash
sudo chmod +x /opt/privatool/deploy/deploy.sh
```

Add `privatool` (and your operator account) to a sudoers drop-in so `deploy.sh` can `systemctl restart privatool-backend` and `systemctl reload nginx` without an interactive password prompt — see `/etc/sudoers.d/privatool-deploy` for the recommended limited rule.

## Day-2 operations

A normal deploy after a code merge:

```bash
ssh oracle-vm
cd /opt/privatool
sudo -u privatool ./deploy/deploy.sh
```

The script:
1. `git fetch && git reset --hard origin/main`
2. Builds the frontend (`npm run build`) — does **not** run `npm ci`. If `package.json` changed, run `npm ci` manually first.
3. Restarts the backend systemd unit.
4. Reloads nginx.
5. Hits `/healthz` to confirm the backend is up.

If `requirements.txt` changed, run `/opt/privatool/.venv/bin/pip install -r requirements.txt` before invoking `deploy.sh`.

## Rollback

The app is stateless — rolling back is "check out the previous SHA and redeploy":

```bash
cd /opt/privatool
PREV=$(git log --format=%h -n 2 origin/main | tail -1)
git reset --hard "$PREV"
./deploy/deploy.sh
```

To pin to a specific known-good tag:

```bash
git reset --hard v1.5.1
./deploy/deploy.sh
```

## Verification

After every deploy:

```bash
# Process is up
sudo systemctl status privatool-backend

# Liveness
curl -sf http://127.0.0.1:8000/healthz

# Readiness (verifies temp dir is writable)
curl -sf http://127.0.0.1:8000/readyz

# End-to-end through nginx + TLS
curl -sfI https://privatools.com/ | head -5
curl -sfI https://privatools.com/api/health | head -5
```

## Troubleshooting

| Symptom | Where to look |
|---|---|
| 502 Bad Gateway | `sudo journalctl -u privatool-backend -n 200` |
| 504 timeout | Backend is up but slow — same journalctl, look for `Request timed out` |
| TLS errors | `sudo certbot certificates` then `sudo nginx -t` |
| `nginx -t` fails | Re-check `/etc/nginx/sites-enabled/privatool`, fix, reload |
| Backend won't start | `sudo systemctl status privatool-backend` + journalctl. Often a missing env var or .venv path drift after a Python minor upgrade. |
| OCR returns gibberish | Confirm `TESSDATA_PREFIX` resolves (`ls /usr/share/tesseract-ocr/4.00/tessdata/`); on Ubuntu 24.04 the path may be `/usr/share/tesseract-ocr/5/tessdata/` — update `.env` |
| LibreOffice conversions hang | `pkill -f soffice` then retry; LibreOffice can leave zombie headless processes |
| Disk filling up | Check `/opt/privatool/tmp` — janitor sweep failure leaves uploads behind. `find /opt/privatool/tmp -mmin +30 -type f -delete` |

Backend logs are JSON (one object per line) via `AccessLogMiddleware`; pipe through `jq` for readability:

```bash
sudo journalctl -u privatool-backend -f | jq 'select(.msg)'

# Just slow requests:
sudo journalctl -u privatool-backend -f | jq 'select(.duration_ms > 5000)'

# Filter by request_id (paste from a user-facing error):
sudo journalctl -u privatool-backend -f | jq 'select(.request_id == "9c96161ca938")'
```

Every record carries `ts`, `level`, `logger`, `msg`, `request_id`. Request-lifecycle records (one INFO per request, WARNING for >5s) also include `endpoint`, `method`, `status`, `duration_ms`. Slow-request threshold is `SLOW_REQUEST_MS` in `.env`. Set `LOG_FORMAT=text` to switch to grep-friendly plain text (helpful when SSH'd in without `jq`).

The systemd unit invokes uvicorn without `--access-log` overrides. We disable uvicorn's default access log internally (`logging.getLogger("uvicorn.access").setLevel(WARNING)`) because our own access log is richer (request ID, structured fields). If you ever pass a custom `--log-config` flag, make sure it doesn't re-enable uvicorn's `uvicorn.access` logger or you'll get duplicate lines.

nginx access log is at `/var/log/nginx/access.log`, error log at `/var/log/nginx/error.log`.

## Backups

**None required.** PrivaTools is fully stateless:
- All uploaded files live in `/opt/privatool/tmp/` and are deleted within ~10 minutes by the janitor.
- No database, no user accounts, no persisted artifacts.
- Configuration (`.env`) should be backed up out-of-band — keep an offline copy in your password manager.

The source of truth is `origin/main`. Losing the VM means re-running the one-time setup above against a fresh box.

## Security follow-ups

These are known gaps tracked for future hardening:

1. **CSP `'unsafe-inline'` on `script-src`** — Vite's hydration bootstrap is inline. Move to a nonce-based CSP via a small middleware that injects `nonce=<random>` into the script tag.
2. **Per-route rate limits** — global limit is set via `RATE_LIMIT` env. The expensive AI tools (Summarize PDF, Smart Redact) should have tighter limits.
3. **HSTS preload submission** — preload-ready header is shipped but we haven't submitted to `hstspreload.org`. Confirm long-term HTTPS commitment first.
