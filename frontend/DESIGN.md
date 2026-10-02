---
name: "PrivaTools — Air and Play"
description: "Two distinct consumer experiences sharing one functional application."
updated: "2026-10-02"
experiences:
  air:
    light: "Morning Mist"
    dark: "Graphite"
    background-light: "#edf3f9"
    background-dark: "#151619"
    action-light: "#285cc7"
    action-dark: "#91b5ff"
    font: "Manrope"
  play:
    light: "Blush"
    dark: "Charcoal"
    background-light: "#fae7eb"
    background-dark: "#181818"
    action-light: "#a32749"
    action-dark: "#ff9677"
    body-font: "Outfit"
    heading-font: "Bricolage Grotesque"
---

# PrivaTools design system

The user selected Air and Play and their four appearance palettes on 13 September 2026. This document describes the shipped implementation, live since v2.2.0; previous visual directions are superseded.

## Shared behavior

The same stable application owns routing, processing, files, account state and the local password vault. `ExperienceShell` changes navigation presentation without changing the mounted workspace ancestry. Never key the application or processor by experience or appearance. Processor keys use the tool slug only.

A tool page shows the tool first and its guide (`ToolGuide`) directly below: numbered "How to use" steps, every FAQ answer written out rather than folded away, and links to the guides that mention the tool. It is the same text the server renders for crawlers, loaded per tool.

`useExperience()` stores Air/Play independently of light/dark/system. It synchronizes same-tab, cross-tab and operating-system changes, supports blocked storage, and coordinates the prepaint theme. Root attributes are `data-experience`, `data-appearance` and `data-theme`.

## Navigation

Both experiences use a sticky top navbar. Air is full-width with a quiet bottom rule; Play is a floating rounded bar. Desktop links expose All tools, Pipeline, Batch, AI Studio, Vault and Dev API, followed by My Stuff. The header actions are tool search (⌘K), the Air/Play switch, the light/dark toggle and an Account button that opens account settings (Sign in when signed out). On narrower screens the links move to a second header row that scrolls sideways; on phones All tools, AI Studio, Vault and Dev API come first. The footer holds the remaining destinations (About, Support, Guides, Compare, Account settings and the trust pages), the install/offline controls, the quick tour and keyboard shortcuts. There is no overflow menu, global sidebar or bottom navigation.

## Air

An open studio with content up to 1240px and 40px desktop gutters. Manrope handles headings and body text. Morning Mist is cool and soft; Graphite is neutral with blue actions. Headers reach 58px, reducing to 38px on phones. Tool page headings carry the tool's full search title, so they stop at 52px and drop to 28px on phones. Panels use 22px radii and fine borders; form fields and search boxes use the firmer field edge (`--pt-field-line`) described below. A compact category index sits beside the tool library. Tool settings sit beside the canvas; Pipeline uses an orderly chain; account and API pages pair focused controls with useful context. The policy reader has a sticky left contents column.

Air enters with a 9px upward fade over 420ms. Progress follows actual work; there are no fake completion timers.

## Play

A personal workshop with Bricolage Grotesque headings and Outfit body text. Blush uses raspberry actions; Charcoal uses warm coral actions. Colored papers carry paired foregrounds, including in dark mode: an ink (`--pt-pdf-ink` and its siblings) and a muted ink (`--pt-pdf-muted` …) for secondary copy such as category blurbs and recipe numbers, each at least 4.5:1 on its paper. Secondary copy on a paper is never dimmed with opacity, which put it at 2.9–4.4:1. Headers reach 66px; tool page headings stop at 65px and drop to 33px on phones; panels use 24–30px radii, tactile shadows and pill actions.

Layouts change as well as colors: categories become a horizontal shelf and the library uses three columns; tool settings move to a horizontal work shelf; Batch uses job cards; the Vault form moves to the left; AI uses a horizontal studio navigation; API connection and example panels swap positions. Support puts its contact note beside the answer shelf; documents become a broad rounded reading sheet below chapter navigation. Advanced editors preserve their specialized controls inside the new workspace composition.

Play entrances use a small rotation, scale and overshoot over 550ms. Hover details lift or gently rotate paper objects. The same input nodes stay mounted through Air/Play changes.

## Components and accessibility

Self-host fonts. Keep semantic Tailwind tokens as HSL triplets in `tokens.css`; experience surfaces and color pairs live in `experience.css`. Secondary-page and workflow styling are isolated in their own stylesheets.

Use visible keyboard focus, proper labels, real disabled states and accessible progress. Respect reduced motion for all entrances, transitions, connectors and scroll navigation. Top navigation stays accessible on mobile; panels stack and long code/chapters scroll within their own containers. Labels wrap inside narrow provider controls. Native dialogs manage focus and dismissal.

Keyboard and focus: the first Tab stop is the skip link, a solid action-colour tab styled in `index.html` itself (Tailwind does not scan that file). The root's `scroll-padding-top` follows the sticky header's real bottom edge (`--pt-header-clearance`, measured by `useStickyHeaderClearance`), so focused controls never sit under it at 200% zoom or on short screens. When a run finishes, focus moves to the result heading. The ⌘K results count is announced once typing settles, and its placeholder uses the muted ink.

Colour roles added in this pass, all in four palettes: `--warning` / `--warning-soft` (tokens.css) for "needs attention, not destructive": refused files, failed runs, read-this-first notes, at least 4.5:1 on cards, the page and its own tint. `--pt-field-line` (and `--input` for Tailwind fields) is the edge of text fields, selects and search boxes, at least 3:1 on the page, cards and panels, because a field's edge is often its only cue; panel and divider lines stay fine. Smart Redact's category chips use the paper pairs and semantic tones instead of dark-only Tailwind inks.

Failure grammar, shared by Air and Play and by every intake:
- A file an intake cannot take is never dropped silently. `FileIntake` and `MediaUpload` show a notice beside the intake that names the file, says what the tool takes and links a registry tool that takes it (`lib/file-acceptance.ts`); drop zones that hand files straight to `useMultiFileProcessor.addFiles` get the same words in a toast. `FileIntake`'s one real button is its visible call to action, and its accessible name starts with that text ("Choose files: …").
- `StudioResult` has three outcomes. Success keeps the check and "Ready for what’s next". Partial shows both parts: the receipt for what worked, a warning badge and the per-file reason for what didn't. Failure carries the warning mark, no eyebrow and no receipt, leads with "Choose a different file" (which opens the chooser directly) and offers "Try again" only for failures another attempt could fix: a dropped connection, a time limit, the rate limit or a server fault (`isTransientFailure` in `lib/toolRun.ts`).
- Merge leaves out a file the browser can't read as a PDF ("This doesn’t look like a valid PDF") or one locked with a password, keeps it listed with the reason and merges the rest.

Status, file counts and percentages come from real state. No simulated success, invented uptime or certification claims. Local tools, temporary server processing and user-selected AI providers have different disclosures. A saved password is encrypted locally; a server operation may receive the password needed for that job.

## PWA

One compact install/offline entry opens the PWA controls. Native installation is offered when available; other browsers receive platform instructions. Updates wait for an explicit reload decision. Only static assets enter the app cache; private API/account/file responses are excluded. Production build hashes version the worker. The manifest includes real Air/Play desktop and mobile screenshots.

## Source and verification

- `src/skins/experience/ExperienceShell.tsx` and `ExperienceHome.tsx`
- `src/skins/experience/Studio.tsx`, `ToolWorkspace.tsx`, `ToolGuide.tsx`, `ToolStudio.tsx`, `ContentStudio.tsx`, `GuidesStudio.tsx`, `DocumentStudio.tsx`, `TrustCenter.tsx`
- `src/skins/experience/navigation.css`, `footer.css`, `studio.css`, `content.css`, `comparison-studio.css`, `documents.css`, `tool-workspace.css`, `tool-studio.css`, `workflows.css`, `secondary-pages.css`
- `src/lib/experience.ts`
- `src/components/pwa/`, `public/sw.js`, `public/manifest.json`

Keep browser checks, screenshots and backend-output evidence in local release records. Do not publish account-specific audit artifacts.
