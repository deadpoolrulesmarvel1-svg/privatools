# Local-First Personalization — Design

*Date: 2026-08-21 · Sub-project 0.5 of 4 · Status: approved, building*

---

## 1. Context

PrivaTools' headline differentiator is **"no account, ever"** — asserted in `LandingPage`, `AboutPage`, `AllToolsPage`, `README` (×3), and most pointedly in `ComparePage`, where *"No account required: Yes"* is the row PrivaTools wins against all 11 benchmarked competitors.

The features users actually want from an account — remembered passwords, saved signatures, default settings, continuing counters — do **not** require an account. They require *storage*, and the browser already provides it.

This sub-project delivers that value with **zero server involvement, zero accounts, and zero privacy-policy change**.

### Where this sits

| # | Sub-project | Accounts? | Status |
|---|---|---|---|
| 0 | API foundation (`/api/v1`) | no | spec'd (`b8f5c42`) |
| **0.5** | **Local-first personalization** — *this spec* | **no** | building |
| 1 | Developer identity | yes | not spec'd |
| 2 | Quota/abuse UI | yes | not spec'd |
| 3 | Developer DX | yes | not spec'd |

0.5 has **no dependency on 0** and can ship independently, in either order.

### What already exists

The building blocks are present and under-used:

- `src/lib/persistence.ts` — a well-built versioned-envelope localStorage layer (schema version, namespaced keys, never throws, migration-ready).
- `src/hooks/useFormPersist.ts` — a `useState` replacement that auto-saves. **Used by 6 of 104 tool UIs.**
- `src/components/tool-ui/ESignUI.tsx:68` — *already* saves a signature to `localStorage` and auto-applies it on mount. The exact pattern this spec generalizes — but via a raw `SIG_STORAGE_KEY`, bypassing `persistence.ts`. That drift gets consolidated here.
- `pdfjs-dist` — already a dependency, already loaded in `SummarizePdfUI`, `EditPdfUI`, `SmartRedactUI`. Client-side PDF parsing is proven in this codebase.

So this is mostly **generalizing infrastructure that exists**, plus three genuinely new capabilities.

### Goal

Ship four device-local capabilities — password vault, named Bates counters, asset library, per-tool defaults — behind one shared encrypted store, with a management page that makes what's stored visible and erasable.

### Non-goals

- **No accounts, no server, no sync.** Nothing in this sub-project sends a byte to the backend that wasn't already being sent.
- **No privacy-policy change.** Device-local storage is disclosed on the management page; no server-retention claim is affected.
- No change to any backend route.

---

## 2. Decisions

| Decision | Choice | Consequence |
|---|---|---|
| Vault at rest | AES-GCM under a **non-extractable** WebCrypto key in IndexedDB | Resists localStorage dumping, console snippets, profile sync. **Does not stop XSS.** |
| Password trial | **Client-side via pdf.js** | The vault never increases what crosses the wire — only a matching password is sent, exactly as if typed |
| Vault UX | **Visible attempt**, then prompt | User always sees that stored credentials were used |
| Bates counters | **Named, one active** | Matches real discovery workflows (continuous per matter, never shared across matters) |
| Per-tool defaults | **All 104 tool UIs** | Broadest reach; delivered in waves (§7) |
| Control surface | **`/my-stuff` page + inline affordances** | Makes the privacy claim demonstrable, not merely stated |

### Recorded consequence: cross-device password sync is foreclosed

A non-extractable key cannot leave the device. If sub-project 1 later wants synced passwords, it must add a passphrase-derived wrapping key at that time and re-encrypt. This is an accepted trade — passwords are the item least worth syncing — but it is a deliberate decision, not an oversight.

Everything *except* the vault is exportable as JSON (§6.3), which gives users a manual cross-device path today.

---

## 3. Architecture

```
src/lib/localStore/
├── db.ts          IndexedDB wrapper — no new dependency, ~80 lines
├── crypto.ts      non-extractable key lifecycle; encrypt/decrypt
├── vault.ts       password entries
├── assets.ts      binary assets (Blob)
├── counters.ts    named Bates counters
├── defaults.ts    per-tool default settings
├── migrate.ts     one-way import of existing localStorage keys
├── inventory.ts   what's stored + sizes, for /my-stuff
└── index.ts       public API

src/hooks/
├── useToolDefaults.ts       drop-in useState replacement, per tool slug
├── usePdfPasswordTrial.ts   pdf.js trial against the vault
└── useAsset.ts              read/write a named asset

src/pages/MyStuffPage.tsx    route: /my-stuff
```

### Why a hand-rolled IndexedDB wrapper

`idb` is excellent but this needs perhaps six operations (get/put/delete/list/clear/estimate). The repo runs a bundle-size gate (`npm run check:bundle`) and has a hashed SRI step (`inject-sri.mjs`); adding a dependency for six operations is not worth the supply-chain and bundle cost. ~80 lines, fully tested.

### Storage schema

IndexedDB database `privatools`, version 1:

| Store | Key | Value |
|---|---|---|
| `secrets` | `"vault-key"` | non-extractable `CryptoKey` (structured-clone preserves non-extractability) |
| `vault` | `id` (uuid) | `{ id, label, iv, ciphertext, createdAt, lastUsedAt, useCount }` |
| `assets` | `id` (uuid) | `{ id, kind, name, blob, mime, bytes, createdAt }` |
| `kv` | string | counters, active-counter id, customized-slug index, schema version |

Passwords live **only** as `ciphertext`. `label` is user-supplied and stored in plaintext (it is a nickname like "work docs", not a secret) — the UI warns against putting the password in the label.

### Why IndexedDB and not localStorage

Binary assets (a letterhead PNG, a logo) routinely exceed the ~5 MB localStorage budget, `localStorage` is synchronous and blocks the main thread, and it cannot hold a `CryptoKey` object at all. IndexedDB solves all three. `persistence.ts` stays for the trivial form-restore cases it already serves.

---

## 4. The password vault

### Flow

```
user uploads an encrypted PDF
  └─ pdf.js getDocument({data}) throws PasswordException(NEED_PASSWORD)
       └─ UI: "Encrypted PDF — trying 3 saved passwords…"     ← visible
            ├─ for each vault entry, ordered by lastUsedAt desc:
            │    decrypt locally → pdf.js getDocument({data, password})
            │    success → bump lastUsedAt/useCount → proceed
            └─ none match → prompt for a password
                 └─ on success → "Save this password?" → encrypt → store
```

Only the **matching** password is ever sent to `/api/unlock` — identical to the user typing it. Wrong candidates never leave the browser.

### Trial ordering

Most-recently-used first. No document fingerprint is stored or computed — that would be a privacy regression for a marginal speed gain.

### Known limitation: owner passwords cannot be trialled

PDFs have two passwords. A **user password** blocks opening; pdf.js detects a wrong one, so trial works. An **owner password** only restricts permissions — pdf.js opens such a file with an empty user password and cannot verify an owner password at all.

Therefore:

| Tool | Password kind | Vault behavior |
|---|---|---|
| `unlock` | user | **full auto-trial** |
| `protect` | sets both | autofill suggestion only |
| `set-permissions` | owner | autofill suggestion only |

For owner passwords the vault offers a pick-from-list dropdown; it cannot verify before submitting. This is documented in the UI, not silently degraded.

### Failure modes

| Condition | Behavior |
|---|---|
| No WebCrypto (ancient browser) | Vault disabled; everything else works; UI states why |
| No IndexedDB (private mode, some embedded webviews) | Whole store degrades to in-memory for the session; no errors surfaced |
| Key present but decrypt fails (corrupt entry) | That entry is skipped, flagged in `/my-stuff` as unreadable, offered for deletion |
| Key missing but vault entries exist | All entries unreadable → `/my-stuff` offers a one-click purge |

---

## 5. Named Bates counters

The backend takes `prefix`, `start_number`, `digits`, `position` ([`bates_numbering.py:38-41`](../../../backend/app/routes/bates_numbering.py)). Nothing else is required.

```ts
interface BatesCounter {
  id: string;
  name: string;        // "Smith v. Acme"
  prefix: string;      // "SMITH-"
  digits: number;      // 6
  position: string;    // "bottom-right"
  next: number;        // 412
  updatedAt: number;
}
```

After a successful stamp of *n* pages, `next += n`. The page count comes from the pdf.js document already opened for the upload preview — no extra server call.

**Advance only on confirmed success.** A failed or cancelled request must not burn numbers: gaps in a Bates sequence are a real problem in discovery. The counter is written after the response resolves, never optimistically.

`/my-stuff` shows each counter's next value and allows manual correction — because sometimes the authoritative number comes from outside the tool.

---

## 6. Assets, defaults, and management

### 6.1 Asset library

Generalizes `ESignUI`'s signature into typed, shared assets:

| Kind | Consumed by |
|---|---|
| `signature` | e-sign |
| `logo` | watermark, header-footer, stamp |
| `watermark` | watermark |
| `letterhead` | header-footer, overlay |
| `stamp` | stamp |

Stored as `Blob`, capped at 5 MB each and 25 MB total, with a clear over-quota message rather than a silent failure. `ESignUI`'s existing `SIG_STORAGE_KEY` value is migrated on first load and the raw key removed.

### 6.2 Per-tool defaults

```ts
const [state, setState] = useToolDefaults("compress-pdf", DEFAULTS);
```

Tool defaults remain on the existing synchronous `localStorage` layer rather than IndexedDB. `useFormPersist` hydrates synchronously by design so a tool never renders defaults and then flickers into restored values; IndexedDB is async-only and would reintroduce that flicker across all 104 tools. Only the *index* of which slugs are customized lives in IndexedDB, for `/my-stuff`.

A drop-in `useState` replacement — same signature as the existing `useFormPersist`, so adoption is a one-line change per tool. Values are namespaced by tool slug in the `kv` store, debounced, and never persisted when they equal the defaults (keeping the store clean, matching `useFormPersist`'s existing behavior).

Every tool gets a "Reset to defaults" affordance, and `/my-stuff` lists which tools have been customized.

**All 104 tool UIs are in scope.** Delivered in waves (§7) because it is a large mechanical sweep with real regression risk; the hook lands first with exemplars, then the sweep proceeds tool-group by tool-group with the full test suite green between waves.

### 6.3 `/my-stuff`

```
My Stuff                          Stored on this device only

Vault        3 passwords          encrypted  [view] [clear]
Assets       signature, logo      1.2 MB     [manage] [clear]
Bates        SMITH-000412 next    —          [manage]
Defaults     6 tools customized   —          [manage] [clear]
Pipelines    2 saved              —          [manage] [clear]

[ Export my setup (excludes vault) ]   [ Erase everything ]
```

- **View** on the vault lists labels and last-used dates. Revealing a password requires an explicit per-entry click.
- **Export** produces a JSON file of counters, defaults, and asset metadata. **The vault is excluded** — its key is non-extractable by design. The export states this plainly.
- **Erase everything** deletes the IndexedDB database *and* all `privatools_*` localStorage keys, then reloads.
- The page is `noindex` and linked from the footer plus the Privacy page.

---

## 7. Delivery waves

Each wave leaves the suite green and is independently revertible.

| Wave | Contents |
|---|---|
| **1** | `localStore` foundation — `db`, `crypto`, `inventory`, `migrate`, tests |
| **2** | Vault + `usePdfPasswordTrial`, wired into `unlock` / `protect` / `set-permissions` |
| **3** | Named Bates counters + `BatesUI` |
| **4** | Asset library + `useAsset`; migrate `ESignUI`; wire watermark / stamp / header-footer |
| **5** | `useToolDefaults` + `/my-stuff` + exemplar tools |
| **6+** | The 104-tool defaults sweep, by tool group |

---

## 8. Testing

TDD throughout. Test-only setup work required first:

- **jsdom has no IndexedDB** → add `fake-indexeddb` as a dev dependency and import it in `src/test/setup.ts`.
- **jsdom shadows `crypto.subtle`** → bind Node's `webcrypto` onto `globalThis.crypto` in setup.

| Area | Test |
|---|---|
| `db` | put/get/delete/list/clear round-trip; missing store; version upgrade |
| `crypto` | key is non-extractable (`exportKey` **rejects**); encrypt→decrypt round-trip; wrong-key decrypt fails cleanly |
| `vault` | add/list/delete; ciphertext ≠ plaintext at rest; trial order is lastUsedAt desc; `lastUsedAt` bumps only on success |
| trial | correct password resolves; wrong passwords are exhausted then prompt; **assert no network call is made during trial** |
| counters | advance by page count; **do not advance on failure**; multiple counters stay independent; manual correction |
| assets | Blob round-trip; per-item and total quota rejection; `ESignUI` migration preserves the existing signature |
| defaults | round-trip; not persisted when equal to defaults; reset clears |
| inventory | reports counts and byte sizes; erase-everything leaves nothing behind |
| degraded | no IndexedDB → in-memory, no thrown errors; no WebCrypto → vault disabled, rest functional |

The "no network call during trial" assertion is the important one — it is the security property the whole design rests on, and it should fail loudly if anyone ever refactors the trial to hit the server.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **XSS reads the vault.** Non-extractable keys do not prevent this. | Existing nonce-based CSP with no `unsafe-inline` for scripts is the real control. `/my-stuff` states plainly that the vault is device-local and protects against casual access, not against a compromised page. No overclaiming. |
| 104-tool sweep regresses the tool surface | Waves, suite green between each, hook is a drop-in with the same signature as the existing `useFormPersist` |
| Users assume the vault syncs or is backed up | Export explicitly excludes it and says why; clearing browser data destroys it; stated on `/my-stuff` |
| Bates numbers skip on failure | Counter advances only after confirmed success; manual correction available |
| Storage quota exhausted | Explicit caps with clear messaging, never a silent write failure |
| Feature drift toward "this is basically an account" | Non-goal stated: no server, no sync, no identity. `ComparePage`'s claim must remain true and unedited. |

---

## 10. Deferred

- Cross-device sync of counters/defaults/assets (sub-project 1; the JSON export is the manual path meanwhile).
- Zero-knowledge vault sync — requires replacing the non-extractable key with a passphrase-derived wrapping key.
- Redaction dictionaries for the already-client-side `SmartRedact`, and auto-chain-on-upload. Both fit this architecture cleanly; cut from v1 to keep the sweep tractable.
