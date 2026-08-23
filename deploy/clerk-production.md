# Turning Clerk on in production

Everything in the codebase is ready. What remains needs a Clerk **production**
instance, which cannot be created from the CLI — it is a dashboard flow, and it
needs DNS records on `privatools.me`.

Until it is done, production behaves exactly as it does today: no publishable
key, so the SDK is never downloaded, the provider is never mounted, and accounts
use the local scrypt path. There is no half-configured state.

## What the code already does

| | |
|---|---|
| `Dockerfile` | takes `VITE_CLERK_PUBLISHABLE_KEY` as a build arg, empty by default |
| `release.yml` | passes it from the repo **variable** `CLERK_PUBLISHABLE_KEY` |
| `docker-compose.yml` | passes `CLERK_PUBLISHABLE_KEY` and `CLERK_WEBHOOK_SECRET` at runtime |
| `app/main.py` | derives the Frontend API host from the key for the CSP |
| `app/auth/clerk_session.py` | verifies tokens against that host's JWKS |
| `app/routes/clerk_webhook.py` | verifies `user.deleted` and removes the user's API keys |

`CLERK_SECRET_KEY` is deliberately not plumbed anywhere. Verification uses
Clerk's public JWKS and nothing here calls their Backend API, so shipping the
secret into the container would put a real credential where nothing reads it.

## 1. Create the production instance

In the Clerk dashboard, on application `app_3IJ3f9WdU1NrlrWGuKA1FjPxsO3`, use
**Create production instance**. It will ask for the domain: `privatools.me`.

Clerk then issues DNS records to add — typically CNAMEs for `clerk`,
`accounts`, `clkmail`, and two DKIM names. Add them in **Cloudflare**, and set
each to **DNS only (grey cloud)**. Proxying them breaks the ACME challenge and
Clerk's certificate issuance, and the failure is slow and unhelpful.

Wait for Clerk to report the domain verified before continuing.

## 2. Copy the settings across from development

The development instance is already configured the way we want, and a
production instance starts from defaults:

```bash
npx clerk@latest config pull --instance dev  --output /tmp/clerk-dev.json
npx clerk@latest config patch --instance prod --file /tmp/clerk-dev.json --yes
```

Check afterwards that these survived, because they are the ones that matter:

- `connection_oauth_google.enabled`, `connection_oauth_github.enabled`,
  `connection_oauth_apple.enabled` — all `true`
- `auth_attack_protection.bot_protection.captcha_enabled` — `true`. This is the
  Turnstile check, and it is the only thing standing between a free API and
  someone scripting accounts to farm quota.
- `auth_email.verify_at_sign_up` — `true`
- `auth_password.min_length` — 15, which `MIN_PASSWORD_LENGTH` mirrors

**OAuth credentials do not carry over.** Development uses Clerk's shared
credentials; production requires your own OAuth apps for Google, GitHub and
Apple, each with the callback URL Clerk shows on the provider's settings page.
Apple additionally needs a paid Apple Developer account.

## 3. Point the build at it

Add the publishable key as a repository **variable** (not a secret — it is
public and appears in the bundle of every Clerk site):

```bash
gh variable set CLERK_PUBLISHABLE_KEY --body "pk_live_…"
```

The next release tag bakes it in. Nothing before that tag changes.

## 4. Set the webhook secret on the VM

In Clerk, add an endpoint pointing at `https://privatools.me/api/clerk/webhook`
subscribed to **`user.deleted`**, then put its signing secret in the VM's
`.env` beside the compose file:

```bash
CLERK_PUBLISHABLE_KEY=pk_live_…
CLERK_WEBHOOK_SECRET=whsec_…
```

Then `docker compose up -d` to pick them up.

This one is not optional. Clerk owns the identity and the API keys live here,
with nothing linking them at rest — so without the webhook, deleting an account
in Clerk leaves its keys authenticating and spending quota for a user who no
longer exists. The account page offers a delete button, so it is reachable by
design.

## 5. Check it

```bash
# the CSP should name the production FAPI host on /account, and nowhere else
curl -sI https://privatools.me/account     | grep -o 'clerk[^ ;]*' | sort -u
curl -sI https://privatools.me/tool/merge-pdf | grep -c clerk   # expect 0

# the webhook must refuse an unsigned call
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://privatools.me/api/clerk/webhook   # expect 400
```

Then sign up once with Google, issue an API key, delete the account in Clerk,
and confirm the key is gone.

## Backups first

`app-data` holds every account and every API key. The nightly backup
(`privatools-backup.timer`) exists and is verified, but it writes to
`/home/ubuntu/backups/privatools` on the same VM — it survives a lost container,
not a lost VM. Sort out an off-host copy before inviting anyone to sign up.
