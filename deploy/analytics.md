# Google Analytics integration

The frontend uses the Google browser tag for sessions, first visits and foreground engagement. It sends one manually controlled page view for each canonical public route, including every React Router navigation, one `tool_run` event per tool use, and the older `tool_success` signal from Merge PDF, Compress PDF, Image to PDF and JSON/XML Formatter. Manual pageviews exclude fragments and query strings, with one exception: the first page view of each page load says where the visit came from (next section). Account, settings and personal-workspace routes are excluded. Automated browsers are not measured at all. The owner explicitly retained automatic scroll, outbound-click and video-engagement measurement. Those automatic events may include external link destinations and video metadata, so this is not a manual-events-only integration. The app does not deliberately send file/form contents, error messages or account identity. Ads storage, ads personalization, ad user data and Google Signals are disabled.

## Where visits come from

Google Analytics attributes a session to the traffic source on its first hit. Before this change the beacon stripped every external referrer and every query parameter, so almost all sessions reported as Direct (186 of 190 for 18 to 24 September 2026) even though Search Console showed Google search clicks; compare acquisition reports only from the deploy date onward. The first page view of a page load, and only that one, now carries:

- **The external referrer's origin** as `page_referrer` (`dr`): scheme, host and port, such as `https://www.google.com/`, never its path or query. Only `http` and `https` referrers are used, plus Android app referrers (`android-app://<package>/`, which the Google app sends). A host that can only name someone's own network is never sent: an IP literal, `localhost`, a name without a dot, or a name under `.localhost`, `.local`, `.internal` or `.home.arpa`. A referrer on this site keeps today's behaviour: its canonical public route (so a page opened in a new tab from another public page, or a reload of it, records that page), or nothing.
- **Campaign tags** from the landing URL, appended to `page_location` (`dl`): `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content`, lowercase keys only, the first value of each. A value is kept only if it is 1 to 64 characters of letters and digits (any script), spaces, `.`, `_`, `~` and `-`, has at most 8 digits in total, and has no unbroken run of 16 or more letters and digits that mixes both; otherwise that tag is dropped. The digit limit drops most phone and account numbers (a literal `+` in a query decodes to a space, so `+15551234567` arrives as eleven digits); the run rule drops typical hashes, random tokens and JWT segments. `spring-sale`, `newsletter 2026-09` and `launch_20260924` pass. Every other parameter (`gclid`, `utm_id`, `ref`, `email`, ...) and the fragment are still stripped.

"Page load" means every time a document loads: arriving from elsewhere, opening a page in a new tab, or reloading. The beacon reads the landing URL when its module loads, before the router can rewrite it, and spends it on the first page view it sends. When the landing route is private and sends nothing, the first public page view of that page load carries it instead. The global `gtag("set")` defaults never contain either value: automatic events (scroll, outbound click, engagement), `tool_run`, `tool_success` and every later page view use the canonical URL, and in-app navigations report the previous public route as their referrer. A browser check on 24 September 2026, with every collection request intercepted, confirmed that a scroll on the landing page is sent with the clean URL and an empty `dr` (the tag does not fall back to `document.referrer`).

## Automated browsers

The tag is not loaded and nothing is sent when `navigator.webdriver` is `true` (WebDriver, Playwright, Puppeteer and similar tools set it) or when the user agent contains `HeadlessChrome` or `PhantomJS`. The check sits in the beacon's `allowed()`, beside the opt-out, so an automated session never boots the tag or queues an event. There are deliberately no screen-size, language or location heuristics, so a crawler that hides both signals is still counted; Google's own known-bot filtering applies on top. Lighthouse and PageSpeed Insights report their own user agent and are not in the list.

Playwright sets `navigator.webdriver`, and headless Chromium says `HeadlessChrome`, so a Playwright session now sends nothing at all. To check analytics in a browser, launch Chromium with `--disable-blink-features=AutomationControlled` and give the context an ordinary user agent, and intercept every collection request as described below; otherwise the tag never loads and the check proves nothing.

**Post-deploy check: the Singapore crawler.** On 18 to 24 September 2026, 101 of 174 users were one crawler: country Singapore, Chrome on Windows, screen resolution 1280x1200, one page view per user and zero engagement. For the seven days after the release that ships this skip, query GA4 (an Exploration, or the Data API's `runReport`) with dimensions `country`, `browser`, `operatingSystem` and `screenResolution` and metrics `activeUsers`, `screenPageViews` and `userEngagementDuration`, filtered to that combination, and compare with the baseline. If it disappears, the crawler identified itself as automated. If it persists, it hides both signals and is still counted by design; exclude it in reporting with a GA4 comparison or segment rather than adding a screen-size or country rule to the beacon.

## Usage events

`tool_run` fires once per run from the shared engines (`GenericUI`, `SimpleConvertUI`, `useMultiFileProcessor`, `useMediaJob`), once per Batch page run and once per Pipeline step, plus a direct `emitToolRun` call in tools that keep their own processing loop. Tool code dispatches the `privatools:tool-run` DOM event through `frontend/src/lib/toolRun.ts`; the beacon in `frontend/src/lib/analyticsBeacon.ts` decides whether anything is sent.

| Parameter | Values |
| --- | --- |
| `tool_slug` | Registry slug; read from the `/tool/<slug>` or `/tools/<slug>` route when the caller omits it. Unknown slugs are dropped. |
| `tool_category` | The registry category of that slug (`organize`, `optimize`, `image`, `developer`, ...). |
| `run_mode` | `single`, `batch` or `pipeline`. |
| `outcome` | `success`, `partial` (some files failed) or `error`. A file a tool hands back unchanged because it could not do its job on it counts as failed: the Gemini Watermark Remover's images with no sparkle found (`bad_input`) or with one it could not remove cleanly (`browser`), so its miss rate shows. |
| `file_count` | Files the run handled, when the caller knows it. Never names, sizes or contents. |
| `error_kind` | On `error` and `partial` runs only: why the run (or its first failed file) failed, as one value from the fixed list below. Never a message. |

Register `tool_slug`, `tool_category`, `run_mode`, `outcome` and `error_kind` as event-scoped custom dimensions and `file_count` as an event-scoped custom metric in the GA4 property; standard reports only show registered parameters. The first five were registered on 18 September 2026. `error_kind` needs registering once: Admin > Data display > Custom definitions > Create custom dimension, dimension name `Error kind`, scope **Event**, event parameter `error_kind`. GA4 shows it only for events received after registration.

### Failure categories

| `error_kind` | Meaning |
| --- | --- |
| `too_large` | The server answered 413, or the browser refused a file or input over a size limit (the 500 MB upload cap, Text Diff's comparison limit). |
| `rate_limited` | The server answered 429. |
| `bad_input` | The server answered 400, 415 or 422, or the browser rejected the input itself (for example invalid JSON, an unreadable subtitle file, a PDF with no text to translate, an image with no Gemini sparkle found). |
| `timeout` | The server answered 408 or 504, Cloudflare answered 524 (it stops waiting for the origin after 100 seconds, while nginx allows 300), or the request passed the browser's deadline. |
| `server` | Any other HTTP error from PrivaTools: other 5xx, and 4xx outside the groups above (a 404 or 405 means the deployment is out of step), or a response the tool could not read (a body that is not valid JSON, or Merge's empty PDF). |
| `network` | The request never completed: offline, DNS, a dropped or blocked connection. |
| `provider` | The visitor's own AI provider (BYOK) refused or failed the request, or its setup is incomplete. |
| `browser` | Anything else raised in the browser: on-device processing (including a Gemini sparkle found but not removed cleanly), an on-device model or browser storage. |

Until the release that carries PR #282, some failures reached the page, which reads api.privatools.me cross-origin, with no CORS headers. The page could not see their status, so it counted them as `network`: nginx's own 413, 502, 503 and 504 on the API host, and the app's answers from its catch-all exception handler (a 500, and the 413, 400 and 501 it maps some exceptions to). From that release, the app's answers count by their status: `server`, `too_large` or `bad_input`. Once nginx's [runbook](api-subdomain-split.md#nginxs-own-error-answers-on-the-api-host-added-24-september-2026) has run, so do nginx's 413 (`too_large`) and 504 (`timeout`). nginx's 502 and 503 mostly stay `network` for uploads. Every upload is preflighted, and while the app is down nginx refuses the preflight itself, as a limit's 503 can, so the page never sees the status. It sees a 502 only when the browser still holds a preflight for that endpoint, up to 600 s after one succeeded, and a limit's 503 whenever the limit refuses the upload itself rather than its preflight. So expect `network` to fall by the 413s, 504s and the app's own errors, `too_large`, `timeout` and `bad_input` to rise, and `server` to rise mainly by the app's 500s. An outage still counts mostly as `network`.

The category is derived centrally. `frontend/src/lib/api.ts` already tags HTTP errors with `__status`; it now also tags the failures that have no status with `__kind` (client deadline, request that never completed, file over the upload cap, empty or oversized file list, a JSON body that does not parse through `readJson`), and exports `withErrorKind` for tools that throw their own classified errors. `toolErrorKind()` in `frontend/src/lib/toolRun.ts` maps a caught error to the list above from those tags, error names, BYOK error kinds and the browser's standard fetch-failure wording. Callers pass what they caught as `emitToolRun`'s second argument: the shared engines (`GenericUI`, `SimpleConvertUI`, `useMultiFileProcessor`, `useMediaJob`) and the Batch page pass their run's first failure, the Pipeline page passes the failing step's error, and direct call sites pass their caught error or name the category when they know it (`errorKind`). Only the category leaves `toolRun.ts`; the beacon sends `error_kind` only on `error` and `partial` runs and drops any value outside the list while still counting the run. `src/test/tool-run-coverage.test.ts` fails when a failure report under `components/tool-ui`, the engines or the workflow pages has neither a cause nor an `errorKind`. Image to PDF is exempt there until in-flight work on it lands; its failures arrive without `error_kind` meanwhile, which is why the Privacy page says a failed run "can" carry a category.

A cancel is not a failure. The engines leave cancelled files out of the count, so a run cancelled before any file finished sends nothing and one cancelled midway reports only the files that finished; direct call sites return before reporting; and `emitToolRun` drops an `error` whose cause is a cancel (an `AbortError`, or a BYOK request the visitor stopped). There is therefore no `cancelled` category, and `outcome=error` counts real failures only.

The previous first-party Measurement Protocol browser sender is removed. Its backend endpoint remains for cached older clients; reserved `user_engagement` is translated to `foreground_time`, unknown events are dropped, and no time/session values are invented. Do not run a second browser pageview sender alongside the tag.

## Google settings the tag depends on

The following changes were saved on September 14, 2026 in the existing PrivaTools property `530357002`, web stream `14273376292`, measurement ID `G-B3VWQ44MX1`. They preserve the owner's latest choices:

1. Enhanced measurement remains enabled with **scrolls, outbound clicks and video engagement unchanged**. Site search, file downloads and form interactions are off. Under Page views > advanced settings, **Page changes based on browser history events** is off. Automatic history pageviews operate independently of `send_page_view:false` and would duplicate our route events.
2. Under Google tag > Configure tag settings > **Allow user-provided data capabilities**, **Automatically detect user-provided data** is off. The broader capability remains unchanged and enabled; no email, phone, address, CSS-selector or JavaScript-variable collection was configured by this work. Do not enable automatic detection or add a user-data snippet.
3. Keep advertising/Google Signals features off. Do not mark pageviews or timing events as key events to manipulate engagement or bounce metrics.
4. Run `python3 scripts/analytics/check-public-google-tag.py`. This makes one public script GET, does not execute it, does not access a dashboard and sends no collection events. Inspect its redacted report, then verify a fresh browser with every Google collection request intercepted. An automated browser now loads no tag (see Automated browsers): a Playwright check must launch Chromium with `--disable-blink-features=AutomationControlled` and an ordinary user agent. Unknown script formats or any unsafe flag must leave the switch off.

The public script verifier reports the three retained automatic features separately. The actual SDK was also checked in isolated browser contexts with collection intercepted. Keep network captures and account-specific evidence private. The verifier is an inspection aid, not a supported Google configuration API or an automatic guarantee. Inspect actual SDK payloads, then verify the deployed network/CSP path. Recheck after Google tag settings change.

## Runtime switches and visitor choices

`GA_BROWSER_TAG_ENABLED=true` is the operator's explicit attestation that the above configuration and actual SDK behavior have been reviewed. It defaults off and is on in production. The backend then permits the narrow Google script/collection origins only on public documents and provides a runtime meta flag. No frontend build flag or second measurement ID is needed. Development builds never load the tag.

Collection is on by default for every visitor. There is no consent prompt, no regional exception, and the app does not read Do Not Track or Global Privacy Control for this setting. The **Allow Google Analytics** switch on the Privacy page is the only visitor control: turning it off stores `pt-analytics-opt-out` in the browser and disables the tag immediately; turning it back on removes the key and resumes collection. Clearing site data resets the choice. Analytics cookies and identifiers are pseudonymous, not anonymous. The consent record written by the 14 to 17 September opt-in bundle is ignored.

`GET /api/analytics/policy` answers `mode: default_on` whenever the tag is enabled and `mode: opt_in` otherwise, with `Cache-Control: private, no-store`. Current bundles never request it. It stays so that browsers still holding the opt-in bundle switch on without a redeploy. The application no longer reads `X-PrivaTools-Country`; the nginx boundary in [analytics-country-proxy.md](analytics-country-proxy.md) is historical.

## Reading the existing report

This section describes reports from before 17 September 2026, when the browser tag was opt-in and almost nothing was collected.

The supplied Tag diagnostics screenshot says the browser tag has not been detected for 48 hours. This is compatible with an older Measurement Protocol-only sender: server events can arrive without the browser tag being detected. It does not by itself identify the deployed fault. A public script-configuration pass or local mocked test cannot clear that warning; verify actual network delivery and GA Realtime/Tag Assistant with the correct property, then allow diagnostics time to refresh.

Views count page-view events; Event count includes all event types. A row with equal views and events is consistent with collecting only pageviews for that row, but the screenshot alone does not show active event filters. Active users are users, whereas bounce rate is the share of sessions that were not engaged. They have different denominators. Average engagement time does not prove the bounce rate is correct or incorrect.

The former MP-only implementation did not generate Google's browser `first_visit` lifecycle. Zero New users despite Active users is consistent with that limitation. Duplicate senders also used separate anonymous IDs, and foreground time was attributed to the destination route. Existing screenshots are therefore insufficient to judge acquisition quality. The fix cannot reconstruct historic first visits, merge duplicate historical identities, recover unreported time or retroactively repair past reports. The new Google cookie identity may introduce another reporting discontinuity; inspect trends from the deployment date onward.

Official references:

- [Measurement Protocol overview](https://developers.google.com/analytics/devguides/collection/protocol/ga4)
- [Reserved Measurement Protocol names](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)
- [Manual pageviews and enhanced history measurement](https://developers.google.com/analytics/devguides/collection/ga4/views)
- [Enhanced measurement fields](https://support.google.com/analytics/answer/9216061)
- [User-provided data collection](https://support.google.com/analytics/answer/14078702)
- [Engagement and bounce rate](https://support.google.com/analytics/answer/12195621)
- [EU user consent policy](https://www.google.com/about/company/user-consent-policy/)
- [Consent mode behavior](https://developers.google.com/tag-platform/security/concepts/consent-mode)
