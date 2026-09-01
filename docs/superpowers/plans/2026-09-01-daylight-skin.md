# Daylight Skin Implementation Plan

> **For agentic workers:** executed inline this session (superpowers:executing-plans), single engineer.

**Goal:** Land the approved Daylight design as a fifth registered skin, wired to the real
seams (real catalogue, real per-tool execution via `ToolUI`, real accounts via
`withAccounts`, real AES-GCM vault via `withVault`, real path→hash bridging via
`withPathRoutes`), with `DEFAULT_SKIN` unchanged. The default flip is a staged
one-line follow-up once the skin has been seen live.

**Architecture:** Hand-written class-component `SkinApp` (the codebase's ported-skin
shape: one monolith per skin) that routes on `location.hash` exactly like Aurora, so the
existing `withPathRoutes` bridge covers every site URL. The battle-tested account and
vault flows are NOT reimplemented: the extension composes the real mixins over the
hand-written base, and the base's markup consumes `this.state.acct` / `this.state.vlt`
and the mixins' handlers directly. Real tool processing comes from composing
`withRealTools`, whose `realToolUI` binding mounts the same 112 tool components the
house design runs.

**Scope cuts vs the prototype (deliberate, honest):**
- The prototype's simulated tool runner, editor, account and vault are replaced by the
  real seams (that is the point).
- The 4-palette variant system is out of v1 (Daylight ships its light/dark pair; skins
  are the product's variant axis).
- Drive/Dropbox/URL source buttons are out until a real picker integration exists.
- Pipeline and Batch ship as Daylight's native designed surfaces at the same fidelity
  bar as the other three ported skins.

**Files:**
- Create `frontend/src/skins/daylight/SkinApp.tsx` — base component + injected styles.
- Create `frontend/src/skins/extensions/daylight.tsx` — mixin composition.
- Modify `frontend/src/lib/skins.ts` — register id + meta.
- Modify `frontend/src/skins/SkinAppHost.tsx` — lazy entry.
- Modify `frontend/src/skins/features.ts` — NATIVE/EXTENSION/PENDING rows.
- Modify `frontend/src/test/skin-parity.test.ts` — capability-source resolution for a
  hand-written skin (extensions/<id>.html for generator skins, SkinApp.tsx for daylight).
- Modify `frontend/index.html` — pre-hydration skin list + background.
- Modify `frontend/src/test/skins.test.ts` if any assertion assumes generator artifacts.
- Create `frontend/src/skins/daylight/route.test.ts` — pure route-parser unit tests.

**Verification:** `vitest run` (parity + new tests), `tsc -p tsconfig.app.json`,
`eslint` on touched files, then a live dev-server pass switching `?skin=daylight`
through home / catalogue / a real tool page (ToolUI mounted) / vault / account /
every nav destination, with screenshots.

**Rollout:** PR `feat/daylight-skin` (default untouched) → user eyeballs on a deploy →
staged commit flips `DEFAULT_SKIN` + index.html default block.
