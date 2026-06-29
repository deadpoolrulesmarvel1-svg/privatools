# api-subdomain split — activation runbook

**Goal:** put `privatools.me` + `www` behind Cloudflare's proxy (edge cache,
Brotli, DDoS protection — makes the "edge CDN" claim true) **without** breaking
large uploads. Cloudflare's free/pro plans cap a proxied request body at
**100 MB**, but PrivaTools accepts **500 MB**. So the SPA's `/api` traffic is
moved to `api.privatools.me`, a **grey-clouded** (DNS-only) host that goes
straight to the VM — uncapped, and never transiting a third party (good for a
privacy-first tool). Static/SSR stays on the proxied apex.

```
browser ──▶ privatools.me        (orange/proxied) ──▶ Cloudflare edge ──▶ VM nginx ──▶ FastAPI   (HTML + assets, cached)
browser ──▶ api.privatools.me     (grey/DNS-only)  ─────────────────────▶ VM nginx ──▶ FastAPI   (/api uploads, direct)
```

## What's in the repo (flag-gated, default off)

The whole split is gated on one backend env var, **`PUBLIC_API_BASE_URL`**.
Empty (default) = same-origin, identical to today. Set to
`https://api.privatools.me` and the backend:

- injects `<meta name="privatools:api-base" content="https://api.privatools.me">`
  into `index.html` at serve time — the already-built SPA reads it
  (`frontend/src/lib/api.ts` → `resolveApiOrigin()`) and sends `/api` there.
  **No frontend rebuild needed.**
- widens the CSP `connect-src` to allow the cross-origin fetches
  (`backend/app/main.py` → `_content_security_policy`).
- auto-adds `api.privatools.me` to `TRUSTED_HOSTS` so the proxied Host header
  isn't rejected.

nginx gets a dedicated `api.privatools.me` vhost
(`deploy/oracle-vm/nginx-privatools.conf`) that proxies **only** `/api/*` to the
same FastAPI upstream (everything else 404s — no duplicate SPA on the api host).

## Activation order (no upload-breaking window)

Do these **in order**. The apex is only proxied *after* the SPA is already
talking to the grey api host, so there's never a moment where a proxied apex
`/api` upload could hit the 100 MB cap.

1. **Cloudflare DNS — add the api record (grey).** Dashboard → DNS → Add record:
   `A · api · 140.245.15.140 · Proxy status: DNS only (grey)`. Leave apex/`www`
   grey for now. Confirm: `dig +short api.privatools.me` → `140.245.15.140`.

2. **Issue the cert on the VM** (api resolves directly, so HTTP-01 works):
   ```bash
   ssh -i "<key>" ubuntu@140.245.15.140
   sudo certbot certonly --nginx -d api.privatools.me
   ```
   **Do not continue until the cert exists** — the nginx vhost references
   `/etc/letsencrypt/live/api.privatools.me/`, so a missing cert makes
   `nginx -t` (step 3) fail. Verify before proceeding:
   ```bash
   sudo ls -l /etc/letsencrypt/live/api.privatools.me/fullchain.pem \
              /etc/letsencrypt/live/api.privatools.me/privkey.pem
   ```
   If certbot failed, it's almost always DNS not yet propagated (the `api`
   record from step 1) or an HTTP-01 challenge timeout — re-check
   `dig +short api.privatools.me`, wait, and re-run certbot. Don't touch nginx
   until both files are listed.

3. **Deploy the nginx config** (now contains the api vhost) and reload. The
   `&&` chain only reloads if `nginx -t` passes, so a config error leaves the
   *running* nginx untouched; the backup lets you restore the sites file:
   ```bash
   scp deploy/oracle-vm/nginx-privatools.conf ubuntu@140.245.15.140:/tmp/
   ssh ubuntu@140.245.15.140 'sudo cp /etc/nginx/sites-enabled/privatools \
       /home/ubuntu/nginx-backups/privatools.$(date +%s).bak && \
     sudo cp /tmp/nginx-privatools.conf /etc/nginx/sites-enabled/privatools && \
     sudo nginx -t && sudo systemctl reload nginx'
   ```
   Verify: `curl -s https://api.privatools.me/api/health` → JSON health;
   `curl -so /dev/null -w '%{http_code}\n' https://api.privatools.me/` → `404`.

4. **Flip the backend flag.** Set `PUBLIC_API_BASE_URL=https://api.privatools.me`
   in the VM's container env (compose `.env` / systemd `Environment=`) and
   restart the container. Verify:
   - `curl -s https://privatools.me/ | grep -o 'privatools:api-base'` → present.
   - `curl -sI https://privatools.me/ | tr ';' '\n' | grep api.privatools.me`
     → CSP `connect-src` lists the api origin.
   - In a browser, run a tool and watch DevTools → Network: the upload goes to
     `api.privatools.me`, returns 200, and a **>100 MB** file still succeeds.

5. **Orange-cloud the apex + www.** Cloudflare → DNS → set `privatools.me` and
   `www` to **Proxied**. SSL/TLS → **Full (strict)**. Add a cache rule to cache
   `*/assets/*` and **bypass `/api/*`**. Leave `api` **grey**. Verify after
   warm-up: `curl -sI https://privatools.me/assets/<hashed>.js | grep -i cf-cache-status`
   → `HIT`, and uploads still work (they go to the grey api host).

   > Note: the apex **still serves `/api`** after the split — it's the same
   > FastAPI app behind nginx — the SPA just no longer sends *uploads* there.
   > `curl https://privatools.me/api/health` returns `200`, not 404. The apex
   > `/api` surface that's still used is the small `og-image` GET (social-card
   > URLs stay on the apex). The bypass rule keeps any apex `/api` response off
   > the edge cache; it isn't load-bearing for the SPA but is correct hygiene
   > (and harmless to og-image, which already sets its own cache headers).

## Rollback

- **Fastest (code path):** unset `PUBLIC_API_BASE_URL`, restart the container →
  the SPA is served with no meta tag and reverts to same-origin `/api`. If the
  apex is orange-clouded, also **grey-cloud apex + www** in Cloudflare in the
  same pass, or >100 MB uploads (now back on the apex) would hit the cap.
- **Network only:** grey-cloud apex + www in Cloudflare → all traffic direct to
  the VM again; the api host can stay or go.

## Notes / gotchas

- **Cert renewal.** `certbot --nginx` manages the HTTP-01 challenge during
  renewal even though the `:80` blocks `return 301` (it injects a temporary
  challenge location). `api.privatools.me` is grey, so its renewal is direct and
  unaffected by Cloudflare. For the **apex/www** cert once orange-clouded:
  HTTP-01 still passes through Cloudflare unless *Always Use HTTPS* rewrites the
  challenge — if a renewal fails, add a config rule excluding
  `/.well-known/acme-challenge/*` or switch those domains to DNS-01.
- **One var, not two.** `TRUSTED_HOSTS` does **not** need `api.privatools.me`
  added by hand — the backend derives it from `PUBLIC_API_BASE_URL`.
- **CORS is cookieless.** `allow_credentials=False`; uploads send no cookies, so
  the cross-origin split needs no `SameSite`/credential changes.
- **og:image stays on the apex.** Social-card URLs remain `https://privatools.me/...`
  (small, GET, edge-cacheable) — they are not moved to the api host.
