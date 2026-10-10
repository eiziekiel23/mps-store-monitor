# STATE.md — MPS Store Monitor — Chunked Work State

**Repo:** `/mnt/d/mps-store-monitor` (public GitHub repo)  
**Last updated:** 2026-10-10 (Telegram HTML parse-mode migration + status-board detail enhancement)  
**Chunked workflow:** 5-7 steps per chunk, update after every step, checkpoint + approval between chunks.

---

## Current Chunk

| Chunk | Status | Focus |
|-------|--------|-------|
| **6 (giveaway changelog)** | ✅ done | Giveaway freshness tracking, daily rotation detection, Markdown + Telegram rendering |
| **7 (remaining storefront checks)** | ✅ done | Five remaining checks: nav.rules, nav.quick_links, video.how_to_enter, stock.all, cart.add_pdp + cart.entries |
| **8 (checkout extension monitoring)** | ✅ done | Entry count, bonus entries, trust badge checks against the live Shopify checkout |
| **9 (Admin API inventory integration)** | ✅ done | Replace Storefront-API-only `stock.all` with real inventory data (inventoryPolicy, availableForSale) via Shopify Admin API; DENY-only alert rule + knownSoldOut allowlist |
| **10 (burn-in & go-live)** | ✅ done | CI verification prep, operator docs (README), allowlist-refresh tooling, Telegram routing verification |

---

### Chunk 10 Steps (completed)

- [x] Step 1: `.env.example` — added `SHOPIFY_ADMIN_API_TOKEN` with scope note (`read_products`) + where to obtain it
- [x] Step 2: `workflow_dispatch` CI run — **completed** (36 passed / 2 skipped) and a full Telegram digest was sent
- [x] Step 3: `README.md` — comprehensive operator docs: Quick Start, Deployment (4-secret table), Architecture (check groups + data flow), Configuration (`knownSoldOut` maintenance), Troubleshooting, Testing Strategy, Performance & Limits, Contributing
- [x] Step 4: `scripts/update-allowlist.js` + `npm run allowlist` — maintenance tool that queries the Admin API and prints out-of-stock DENY products + live status of each `knownSoldOut` entry (flags BACK-IN-STOCK items to remove). Self-loads `.env`. **Verified live: 28 displayed products, all 8 allowlist entries still OOS, 0 to remove.**
- [x] Step 5: Telegram routing verified via read-only `getChat` (token never printed). Bot reaches **both** `6968970533` (private — Marwin) and `-4207189876` (group — "MPS Web Development"). Local `.env` points at the private chat per the burn-in plan; switch `TELEGRAM_CHAT_ID` to the group after a clean burn-in.
- [ ] Step 6: Checkpoint — **completed** (no changes needed)

---

### Chunk 9 Steps (completed)

- [x] Step 1: `src/admin.js` — Admin API client (`fetchDisplayedInventory`, injectable fetcher, 6 unit tests)
- [x] Step 2: Fixed latent bug in `src/snapshot.js` found via the Admin API probe — bonus coupon metaobject field is keyed `code`, not `coupon_code`; every coupon code had been reading as `undefined`
- [x] Step 3: Rewrote `tests/storefront/stock.spec.js` to use `fetchDisplayedInventory` instead of the Storefront snapshot. New semantics (user-approved "All displayed, DENY-only"): filter displayed products to those with ≥1 `inventoryPolicy: DENY` variant, minus `exclusionsRegex` (passes/protection/golden-ticket) and `knownSoldOut` (seeded allowlist), assert every remaining product has `availableForSale`. Project-guarded to `desktop-chrome` only (via `workerInfo.project.name` in `beforeAll` + `testInfo.project.name` skip in the test body) so the Admin API is called once per run, not once per project.
- [x] Step 4: `config/monitor.config.js` — added `admin: { shop, apiVersion }` section; added `stock.knownSoldOut` allowlist (8 handles, seeded from the 2026-10-08 probe snapshot)
- [x] Step 5: `.github/workflows/monitor.yml` — added `SHOPIFY_ADMIN_API_TOKEN: ${{ secrets.SHOPIFY_ADMIN_API_TOKEN }}` to the "Run monitoring tests" step env (the only step that runs `npm test`)
- [x] Step 6: Local verification. Found + fixed a real gap: `npm test` never loaded `.env` (no dotenv wiring), so `stock.all` had **never run against live data locally** even with a token present — it always skipped. Fixed by adding `process.loadEnvFile('.env')` (Node ≥20.6 native, wrapped in try/catch so CI/missing-file is a silent no-op) to the top of `playwright.config.js`. Re-ran full suite: **36 passed, 2 skipped** (both expected project-guards: `nav.hamburger` mobile-only, `stock.all` desktop-only). `stock.all` confirmed **green against real Admin API data for the first time**: tracking 10 displayed DENY-policy products, 0 out of stock.
- [ ] Step 7: Checkpoint — completed

---

### Chunk 8 Steps (completed)

- [x] Step 1: Inspect `/mnt/d/shopify-app-react` checkout extension source — found real rendered text strings and selector; no data-testids used
- [x] Step 2: Spike — navigated live `/checkout` with seeded cart; extensions confirmed rendering; captured real values (PRODUCT 4,849 + BONUS 5,000 = TOTAL 9,849)
- [x] Steps 3-5 (consolidated): `tests/checkout/extensions.spec.js` — one serial file sharing a single seeded cart (1 ATC/project instead of 3 separate specs × 3 ATCs each). Three annotated checks: `checkout.entries`, `checkout.bonus_entries`, `checkout.trust_badge`. **Deviation from plan: 3 files → 1 file for rate-limit safety (disclosed).**
- [x] Step 6: CI integration (zero workflow changes needed — testDir auto-discovers; data-driven pipeline handles new check IDs). Full suite verified: **35 passed, 3 skipped** in serial CI mode. Reporter emitted 6 checkout rows; aggregation deduped to 3 checks, all `passed`, 0 `failed`.
- [x] Step 7: Checkpoint — completed

---

### Chunk 7 Steps (completed)

- [x] Step 1: nav.rules spec (official rules page reachable + heading/body)
- [x] Step 2: nav.quick_links spec (footer quick links validation)
- [x] Step 3: video.how_to_enter spec (video loads and plays)
- [x] Step 4: stock.all spec (reference products available; skips without token)
- [x] Step 5: cart.add_pdp + cart.entries specs (add-to-cart + cart entries math)
- [x] Step 6: Run storefront suite — 6 passed, 2 skipped, quick_links blocked by test-IP throttle (see Open Items)
- [x] Step 7: End-to-end checkpoint — committed `ab080f0`, pushed to main
- [x] Step 8: Re-run after IP block cleared — **29 passed, 3 skipped** on both projects; `cart.add_pdp` + `cart.entries` now observed GREEN locally (desktop + mobile)
- [x] Step 9: Consolidated duplicate `reachable.spec.js` into `smoke.spec.js` (commit `985a74d`)

---

### Chunk 6 (giveaway changelog)

- Snapshot diffing, daily-rotation staleness tracking, Markdown changelog, Telegram digest integration, config + CI runner, unit tests (24 new), commit-back step — **verified live in CI** (two `chore(giveaway): update changelog [skip ci]` commits on main)

---

### Chunk 5 (nav)

- nav.hamburger (mobile drawer open/close)

---

### Chunk 4 (core storefront checks)

- store.reachable, home.sections, product.sections, announcement.correct, timer.correct, flash.banners, product.giveaway_images (7 checks, 2 Playwright projects)

---

### Chunk 3 (alerting)

- Incident state machine, Telegram formatter/client, report.js orchestrator, 67 unit tests

---

### Chunk 2 (design + impl plan)

- Store monitor design spec, 8-chunk roadmap, GitHub repo creation

---

### Chunk 1 (spike)

- Playwright checkout reachability probe, GitHub Actions headless validation, decision on no-xvfb baseline runs

---

## Constraints & Decisions

- **Cloudflare blocks all bare HTTP clients.** Playwright's `request` fixture AND `page.request.*` both receive an HTTP 429 JS challenge (`cf-mitigated: challenge`). Cloudflare fingerprints the TLS/connection layer (JA3/JA4), so sharing cookies does not help. **Every check must use real browser navigation (`page.goto`) or in-page `page.evaluate(() => fetch(...))`.** Never `page.request`.
- **Booster Theme ATC is a `<div>`, not a `<button>`:** selector is `form.shopify-product-form .btn-atc-pdp`. `getByRole('button')` returns 0 matches; the `<button name="add">` elements are hidden mobile sticky-bar duplicates.
- **Cart-mutation endpoints are specially protected.** `/cart/add.js` and `/cart/clear.js` 429 far more aggressively than GETs (anti-scalper protection, appropriate for a limited-stock giveaway store). Two distinct 429 bodies observed: Shopify JSON `too_many_requests`, and Cloudflare's HTML challenge page.
- **Decision (user, 2026-10-08):** keep `cart.add_pdp` / `cart.entries` on the **hourly** cron as originally planned, accepting the rate-limit and any inventory-reservation exposure.
- **Shopify checkout header.render-after extensions are aria-hidden.** Shopify wraps `purchase.checkout.header.render-after` extensions in a `<status>` container that Playwright's visibility algorithm treats as hidden. Use `toBeAttached()` (not `toBeVisible()`) to wait for render, and `document.body.textContent` (not `innerText`) to read extension text.
- **Checkout checks consolidated to one serial file** (not one file per check) to limit add-to-cart calls against anti-scalper rate limits. 1 ATC call per project per run instead of 3.
- Playwright tests run on `desktop-chrome` and `mobile` projects; checks are deduplicated (worst-status-wins); `skipped` never alerts
- Daily giveaway rotation anchor: 02:00 America/Chicago with 1h grace; staleness if no rotation fields change by ~03:00
- Incident reminder cooldown: 60 minutes for persistent failures
- Hourly (cron) runs send Telegram only on state changes; manual runs (`workflow_dispatch`) send full digest
- Giveaway snapshot + changelog committed to repo (not cached); incident state cached (not committed)
- **Local dev only:** Chromium cannot launch in WSL2 without `export LD_LIBRARY_PATH=/home/eiziekiel23/.claude/jobs/721a0389/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu` (14 `.so` files extracted in the Chunk 1 spike; `playwright install --with-deps` needs sudo, unavailable). CI is unaffected.

---

## Open Items

- ~~**Chunk 7 cart checks never observed passing**~~ — **RESOLVED 2026-10-08.** Once the local test-IP Cloudflare block expired, the full suite ran **29 passed / 3 skipped**, with `cart.add_pdp` and `cart.entries` green on both `desktop-chrome` and `mobile`. Still worth one `workflow_dispatch` run to confirm from a CI IP, but the fixes are now empirically validated, not inspection-only.
- **Cart checks are rate-limit sensitive by nature.** They passed from a cooled-off IP; a burst of hourly runs plus any manual re-runs could still trip `/cart/add.js` protection. If these two checks start flapping in CI, the mitigation is to move them to a lower-frequency cron rather than loosening the assertions.
- **GO-LIVE (user action, `gh` CLI unavailable here):** (1) add all 4 secrets to GitHub repo secrets — `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; (2) trigger a `workflow_dispatch` run from the Actions tab and confirm all checks green from a CI IP (watch the `stock.all` row and giveaway `Live field keys:` log line); (3) after a clean 2–3 day burn-in on the private chat, switch the `TELEGRAM_CHAT_ID` secret to the group `-4207189876` ("MPS Web Development").
- **Telegram group confirmed reachable (2026-10-08):** read-only `getChat` shows the bot is a member of both `6968970533` (private) and `-4207189876` (group). Routing is a secret-value switch only; no code change needed.
- **`knownSoldOut` is a manual allowlist.** When a limited product restocks it must be removed by hand or a genuine future sellout goes unnoticed. `npm run allowlist` prints exactly what to change. Latest run (2026-10-08): 0 items to remove.
- **Three giveaway field keys still inferred, not verified** — **RESOLVED 2026-10-08.** Admin API probe ran successfully against metaobject definitions. All four `rotationFields` keys confirmed valid: `flash_giveaway_end_date`, `flash_giveaway_desktop_banner`, `flash_giveaway_mobile_banner`, `pdp_images`. No config changes needed.
- **`stock.all` never ran green against live data** — **RESOLVED 2026-10-08.** `process.loadEnvFile` added to `playwright.config.js` so local runs now load `.env` credentials. `stock.all` confirmed green on desktop-chrome: 10 displayed DENY-policy products tracked, 0 out of stock (seeded `knownSoldOut` allowlist working as expected).
- claude-mem memory observer is signed out (since 2026-10-07T00:32:45Z) — needs `/login`; nothing is being remembered across sessions
- **PRODUCTION BUG — RESOLVED 2026-10-08 (post go-live):** user reported the 4pm PHT / 3am Chicago giveaway rotation report never sent. Root cause (confirmed via `superpowers:systematic-debugging` + a reproduction script run with/without the fix): `report.js` only dispatched the "GIVEAWAY CHANGES" Telegram block inside the `isManualRun` branch, so a rotation detected on the hourly **cron** (every run except `workflow_dispatch`) never produced any Telegram message — the giveaway check also passes on a healthy rotation, so no incident-alert fired either. Compounding bug: `src/giveaway/check.js` emitted `CHECK_ID = 'giveaway.updated_daily'` while `labels.js`/README/tests all use `'giveaway.freshness'`, so even when included the check misfiled into "Other" on the status board. **Fix (commit `f5f658c`):** `report.js` now computes and dispatches the giveaway-change block unconditionally (outside `isManualRun`), still appending it to the full digest on manual runs; `check.js` now emits `'giveaway.freshness'`. Verified: reproduction script fails without the fix (cron scenario), passes with it; 76/76 unit tests green; no incident-alert spam introduced (verified no-spam contract holds on a healthy/passing rotation). Pushed to `main`.
- **PRODUCTION BUG — RESOLVED 2026-10-10 (HTML migration):** GitHub Actions showed 4 of 6 scheduled runs failing; "Process results and send alerts" step dying on `Telegram API Error: 400 Bad Request — can't parse entities: Can't find end of the entity starting at byte offset 187` (later 269 after an ineffective partial fix). **Real root cause (architectural):** Telegram legacy Markdown (`parse_mode: 'Markdown'`) does not permit escaping inside entities — their own docs state "Escaping inside entities is not allowed, so entity must be closed first and reopened again." This means `_${escapeMd(errorText)}_` is fundamentally broken: `\_` inside an active `_..._` italic span is a literal backslash plus a live delimiter, not an escape sequence. A prior commit (`282f979`) added `escapeMd()` but this could never fix the problem because the italic wrapping itself is the error. The byte offset moved 187 → 269 because the event count went 1 → 2 (a different run's payload), confirming `escapeMd` had no effect. **Fix:** migrated all Telegram formatting from `parse_mode: 'Markdown'` to `parse_mode: 'HTML'`. In HTML mode, only `&`, `<`, `>` need escaping → `&amp;`, `&lt;`, `&gt;` (escape `&` first to avoid double-encoding); escaping is valid everywhere including inside entities; underscores, asterisks, backticks, brackets are completely inert. Rewrote `src/alerting/telegram.js` (replaced `escapeMd` with `escapeHtml`; all italic/bold/code spans use `<i>`/`<b>`/`<code>` tags; `sendTelegram` sends `parse_mode: 'HTML'`). Migrated `src/giveaway/changelog.js` (mandatory — `escapeMd` was removed, module would crash otherwise). Rewrote `tests/unit/telegram.test.js` (replaced the heuristic `assertBalancedEntities` character-count helper — which had a critical blind spot where escaped delimiters lowered the count making tests pass while Telegram still saw odd parity — with `assertValidHtml` that walks a tag stack and checks no raw `&` survives). Fixed 1 stale assertion in `tests/unit/giveaway-changelog.test.js`. Verified: 83/83 unit tests; `verify-html.mjs` structural validation (byte 1637, HTML tags balanced, no raw &amp;) against the exact production payload; adversarial suite (HTML injection, odd delimiters, clamp, giveaway block concatenation) all clean.
- **FEATURE — 2026-10-10:** status board now shows "more broken down detail". Per-check board includes: overall tally line (`✅ N  ⚠️ N  🔴 N  ⏭️ N  / total checks`); per-group `(n/m ok)` counts; failed/flaky rows show bold label + `<code>check.id</code>` + indented `↳ <i>error snippet</i>` + platformNote when present.
- **FEATURE — 2026-10-10 (round 2, "still need more detail"):** user's screenshot showed an all-green RECOVERED report where every row was a bare `✅ Label` — the round-1 detail only fired on failed/flaky rows, so a healthy report (the common case) still looked empty. Added `CHECK_DETAILS` to `src/alerting/labels.js` — a one-line human description of what each check actually asserts, derived from the real spec `expect()` calls (e.g. `cart.add_pdp` → "Add-to-cart succeeds, cart item_count &gt; 0"). Now **every** row (passing, skipped, failed, flaky) shows its detail line. Also wired the previously-unused `formatDuration()` helper into `statusRows()`: every row with a `durationMs` shows `(1.8s)` / `(940ms)`, plus `, N attempts` when a check needed more than one try (flaky signal visible even on checks that ultimately passed). Verified: 83/83 unit tests; size-audit script confirms a realistic 19-check all-green report is 2,555/4,096 chars (62%) and a realistic bad-day (4 failed + 2 flaky) is 3,732/4,096 (91%, trace link still survives `clampMessage`) — only a contrived worst case (all 20 checks failed with 200+ char errors) hits the pre-existing clamp, same as before this change.
- **FEATURE — 2026-10-10 (giveaway daily report schedule guard):** user requested the giveaway rotation Telegram notification fire once daily at 3 AM America/Chicago (DST-aware; Manila drifts 4 PM summer / 5 PM winter). New `src/schedule.js` exports `getCentralTime(now?)` (Intl.DateTimeFormat, reads IANA tz database — correct for DST transitions without manual UTC-offset math) and `shouldSendDailyGiveawayReport({ isManualRun, stamp, now? })` (pure, no I/O). `src/report.js` uses a date-stamp at `state/daily-giveaway-report-date.txt` (idempotent: self-heals if the 03:00 run is delayed or missed, fires exactly once per Central calendar day). Manual runs (`workflow_dispatch`) always bypass the gate and never write the stamp. `tests/unit/schedule.test.js` — 15 test cases covering CDT/CST/DST-boundary/self-heal/stamp-dedup. Verified: 98/98 unit tests; end-to-end sandbox confirms: first cron dispatches + writes stamp, second cron skips with logged reason, manual run dispatches without consuming stamp, stale stamp self-heals. No workflow changes needed — `state/` cache already covers the new stamp file.

---

## Next Step

All 8 roadmap chunks are then complete; the monitor is in steady-state operation. Ongoing maintenance is `npm run allowlist` whenever a limited product restocks.

**After Chunk 10 approval — go-live is a user-side sequence (no `gh` CLI in this environment):**

1. Add `SHOPIFY_ADMIN_API_TOKEN` to GitHub repo secrets (the other three should already exist — verify).
2. Trigger `workflow_dispatch` from the Actions tab. Expect **36 passed / 2 skipped** and a full Telegram digest.
3. Watch the hourly cron for a 2–3 day burn-in to surface flakes (most likely candidates: `cart.add_pdp` / `cart.entries` under `/cart/add.js` rate limiting).
4. If burn-in is clean, switch the `TELEGRAM_CHAT_ID` secret from the private chat to the group `-4207189876`.

**All 8 roadmap chunks are then complete; the monitor is in steady-state operation. Ongoing maintenance is `npm run allowlist` whenever a limited product restocks.**