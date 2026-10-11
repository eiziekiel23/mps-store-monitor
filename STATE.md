# STATE.md — MPS Store Monitor — Chunked Work State

**Repo:** `/mnt/d/mps-store-monitor` (public GitHub repo)  
**Last updated:** 2026-10-11 (Chunk 11.3 — **critical clearing bug FIXED + live-verified; pushed to main; awaiting review**)  
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
| **11.1 (upcoming metaobject)** | ✅ done | Create separate `upcoming_flash_giveaway` metaobject type + entry for pre-staging daily giveaway values |
| **11.2 (swap logic)** | ✅ done | 02:00-Chicago DST-aware gate, Admin API metaobject read/write, swap+clear module, Telegram alert, 17 new unit tests — **approved 2026-10-10** |
| **11.3 (workflow wiring)** | 🟡 awaiting review | `giveaway-swap.yml`, gated fallback in `monitor.yml`, clearing-bug fix + live verification. Pushed `f0e85ed`. Only cron-job.org job (Step 6) remains, blocked on API-key rotation |

---

### Chunk 11 — Upcoming Giveaway Auto-Swap (user request, 2026-10-10)

**Goal:** operator pre-stages tomorrow's daily flash giveaway values; a cron job promotes them into the live
`giveaway` metaobject at exactly 02:00 America/Chicago (= 15:00 Manila), auto-adjusting for DST.

#### Chunk 11.2 Steps

- [x] Step 1: `src/schedule.js` — added `GIVEAWAY_SWAP_HOUR = 2` and `shouldRunGiveawaySwap({ stamp, now })`.
      Deliberately has **no `isManualRun` bypass** (unlike `shouldSendDailyGiveawayReport`): the swap mutates live
      storefront data, so a manual `workflow_dispatch` must still respect the 02:00 gate. (User chose "the default".)
- [x] Step 2: `src/admin.js` — added `fetchMetaobjectByHandle()` (returns `{id, handle, type, fields, fieldMap}` or
      `null`) and `updateMetaobjectFields()` (writes only the named keys, raises `userErrors` as exceptions). Both
      reuse the existing `adminGql` helper + injectable fetcher. 401 message generalised from "missing read_products
      scope" to "insufficient scopes for this operation" now that the client does more than read products.
- [x] Step 3: Recon — compared the staging definition against the live `giveaway` definition. Found
      `flash_giveaway_start_date` missing from staging (Chunk 11.1 created only 7 of the 8 daily fields); added it via
      an additive `metaobjectDefinitionUpdate`. **All 8 daily fields now type-match live**, so the swap is a verbatim
      key→value copy with no per-type serialization.
- [x] Step 4: `src/alerting/telegram.js` — added `formatSwapMessage()` (HTML parse mode, `escapeHtml` on every
      interpolated field value; success / nothing-staged / error variants; values >60 chars truncated).
- [x] Step 5: `src/giveaway/swap.js` (new) — `runGiveawaySwap()` promotes all non-empty staged fields into the live
      entry, then clears them on the staging entry (originally via `value: null` — **schema-invalid, replaced in
      Chunk 11.3 Step 7 with `replaceMetaobjectValues({ values: {} })`**). CLI runner with `--dry-run`, stamp at
      `state/giveaway-swap-date.txt`, Telegram dispatch. CLI wrapped in an ESM `isMain` guard
      (`process.argv[1] === fileURLToPath(import.meta.url)`) so importing it in tests does not trigger `process.exit`.
- [x] Step 6: Tests — `tests/unit/giveaway-swap.test.js` (9 tests: gate-closed, nothing-staged, missing staging entry,
      full swap+clear happy path, same-day idempotency, stale-stamp self-heal, missing live entry, `userErrors`,
      stamp-only-on-success) + 8 new `shouldRunGiveawaySwap` tests in `tests/unit/schedule.test.js` (incl. DST:
      02:00 CST gates identically to 02:00 CDT). **134/134 unit tests pass** (was 117).
- [x] Step 7: Live dry-run — `node src/giveaway/swap.js --dry-run` against the real store: auth OK (no 401), staging
      handle `upcoming-flash-giveaway` resolved, gate correctly OPEN (05:58 CDT, no stamp), result `nothing-staged`
      (entry exists but no values staged yet), **no stamp written**. Confirms the read path end-to-end.
- [x] Step 8: Checkpoint — **approved 2026-10-10**. Chunk 11.3 started.

#### Chunk 11.3 Steps

- [x] Step 1 (bug fix found before wiring workflows): discovered that running `swap.js` from a 15-minute-interval
      fallback step would alert on "nothing staged" ~88×/day, since the gate deliberately stays open all day
      (stamp only written on a successful swap, by design, for late-staging self-heal). Fixed by making the
      "nothing staged" Telegram warning **opt-in** via a new `--alert-if-empty` CLI flag — only the once-daily
      dedicated workflow passes it; the monitor.yml fallback does not. Also updated `swap.js`'s header doc: the
      stamp file `state/giveaway-swap-date.txt` is now documented as **git-committed** (not local-only as
      originally written), since two workflows must share one authoritative stamp.
- [x] Step 2: `.github/workflows/giveaway-swap.yml` (new) — dedicated workflow, `workflow_dispatch` with a
      `trigger` choice input (`manual`/`scheduled`) mirroring `monitor.yml`'s convention. Steps: checkout →
      setup-node 20 → `npm ci` → `node src/giveaway/swap.js --alert-if-empty` → commit
      `state/giveaway-swap-date.txt` only if changed (`git add` + `git diff --cached --quiet` check, matching
      the existing changelog-commit pattern) → `git pull --rebase --autostash` + push.
- [x] Step 3: `.github/workflows/monitor.yml` — added "Giveaway daily swap (fallback)" step (`if: always()`,
      runs `node src/giveaway/swap.js` with no `--alert-if-empty`) between "Check giveaway freshness" and
      "Process results and send alerts". Folded the stamp commit into the existing "Commit giveaway changelog"
      step (renamed "...& swap stamp") rather than duplicating commit logic — added
      `state/giveaway-swap-date.txt` to its `git add` list.
- [x] Step 4 (bug fix): both new commit steps originally ended the commit message with a literal blank-line +
      `Co-Authored-By:` trailer inside a YAML `run: |` block scalar — the unindented trailer line terminated the
      block early, breaking the rest of the step (caught by `python3 -c "yaml.safe_load(...)"` validation, which
      threw `ParserError` on `monitor.yml` line 125). Fixed in both workflows with git's two-`-m` form
      (`git commit -m "subject" -m "Co-Authored-By: ..."`, which git joins with a blank line), avoiding any
      unindented continuation line. Re-validated: both files parse cleanly, both commit step bodies confirmed
      intact (trailer + `git push` present).
- [x] Step 5: Verification — `npm run test:unit` **134/134 still passing** (no regressions from the `--alert-if-empty`
      flag or doc changes); both workflow YAMLs parse via `yaml.safe_load` with all steps present.
- [ ] Step 6: Create the cron-job.org job — daily 02:00 America/Chicago → dispatch `giveaway-swap.yml` with
      `trigger: scheduled`. **BLOCKED: needs the cron-job.org API key rotated first** (the old key was exposed in
      a prior transcript — see Constraints).
- [x] Step 7: Live full-cycle verification — **a CRITICAL BUG was found during the pre-verification recon, fixed,
      and the fix live-verified against the real Admin API.**
  - Read-only inspection (`tmp/inspect-entries.mjs`): LIVE `giveaway/mps-giveaway` (`gid://…/87942103277`) has 8/8
    daily fields populated (end date `October 11, 2026`); STAGING `upcoming_flash_giveaway/upcoming-flash-giveaway`
    (`gid://…/586361897197`) has 8/8 populated with **real operator-staged values for tomorrow** (end date
    `October 12, 2026`, distinct image GIDs). → The operator is actively using the system, so the destructive
    `tmp/test-clearing.mjs` was NOT run (it would have wiped tomorrow's giveaway). The standing `value: null` open
    item was investigated by schema introspection instead of tested destructively — which is what caught the bug.
  - **🔴 BUG (now fixed) — `value: null` clearing was schema-invalid.** Shopify's `MetaobjectFieldInput.value` is
    `String!` (non-nullable). Confirmed two ways: (1) official docs (shopify.dev/.../MetaobjectFieldInput),
    (2) live GraphQL introspection against the deployed 2026-10 schema (`__type` → `value: NON_NULL(String)`).
    The old clear step built `fields: [{key, value: null}]`; GraphQL rejects `null` for a `String!` variable at
    coercion time — **it never reaches Shopify's resolver**, so it failed for EVERY field type, not just
    `file_reference`/`list.*`.
  - **Blast radius it would have had (nightly, 02:00 Chicago):** promote-to-live succeeds ✅ → clear-staging throws
    → exception caught in `main()` → **FAILED Telegram alert** ❌ → `process.exit(1)` before `writeStamp` → **stamp
    never written** ❌ → gate stays open → cycle repeats → recurring FAILED alerts even though the live giveaway
    had actually updated correctly.
  - **Why unit tests missed it:** the swap tests use a mocked `makeFetcher` with canned responses; a mock cannot
    enforce Shopify's GraphQL schema, so the invalid payload was never rejected. No test asserted payload *shape*.
  - **✅ FIX APPLIED (chosen over the earlier "just delete the clear step" proposal — clearing is kept):**
    - `src/admin.js`: new exported `replaceMetaobjectValues()` using the mutually exclusive
      `MetaobjectUpdateInput.values: JSON` input (**full replacement — omitted keys are cleared**). Also corrected
      `updateMetaobjectFields`'s docstring, which falsely claimed `value: null` clears a field.
    - `src/giveaway/swap.js`: clear step now calls `replaceMetaobjectValues({ values: {} })`. **Asymmetric writes
      by design:** staging is cleared with a *full replacement* (safe — it holds exactly the 8 daily fields), while
      the live entry is promoted with the *sparse* `fields` write (mandatory — a full replacement would wipe its
      19 monthly fields). Module docstring documents both modes and why `value: null` cannot work.
    - `tests/unit/giveaway-swap.test.js`: new schema-compliance regression guard using a **recording fetcher** that
      captures raw request bodies and asserts promote-uses-`fields` / clear-uses-`values: {}` / no-`null`-anywhere.
      This closes the mock blind spot that let the bug ship.
  - **Live verification (`tmp/verify-clearing.mjs`, non-destructive):** created a throwaway
    `upcoming_flash_giveaway` entry, populated 5 fields covering all the hard types —
    `flash_giveaway_desktop_banner` (`file_reference`), `pdp_images` (`list.file_reference`),
    `mps_announcement_bar_texts` (`list.single_line_text_field`), plus two text fields — then cleared it with
    `replaceMetaobjectValues({ values: {} })` and re-read it: **all 5 fields cleared, 0 remaining.** Throwaway entry
    deleted; the real staging/live entries were never touched (image GIDs were only read, never modified).
    → **The long-standing `value: null` / `file_reference` / `list.*` open item is now CLOSED.**
  - `npm run test:unit`: **135/135 passing** (134 + the new regression guard).
  - Committed + pushed to `main`; `CHANGELOG-giveaways.md` updated with a deployment entry.
  - **Remaining live step is automatic:** `monitor.yml` already runs on GitHub's native 15-min schedule
    (`7,22,37,52 * * * *`) and calls `node src/giveaway/swap.js` as the self-healing fallback, so the first tick
    after 02:00 America/Chicago tonight will promote the operator's real Oct 12 values and clear staging — a true
    full-cycle run on real data, with a Telegram success alert. No manual dispatch needed (and none was forced, to
    avoid promoting Oct 12 values early). **This does not depend on Step 6 / cron-job.org**; that job only adds the
    dedicated once-daily caller that also sends the "nothing staged" reminder.

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
- **Decision (user, 2026-10-10):** hourly (cron) runs now send a FULL status digest every run ("Hourly Status Report") — not alert-only. Incident alerts still fire on state changes (NEW/STILL/RECOVERED); the giveaway rotation report is daily-gated and kept as a separate message. Manual (`workflow_dispatch`) runs send the digest as "Manual Run Report". (This reverses the earlier alert-only-on-cron no-spam decision at the user's explicit request.)
- **Decision (user, 2026-10-10):** GitHub cron confirmed dropped — public Actions API shows only 3 scheduled runs across 2+ days (`0 * * * *` is the most congested GitHub cron minute). User chose option 2 (most aggressive): cron changed to `7,22,37,52 * * * *` (every 15 min, offset to dodge congested :00/:30). Status digest gated to once per UTC clock hour via `state/hourly-status-report-hour.txt` stamp so operator still gets one Hourly Status Report/hour, not four. Incident alerts NOT gated — they fire every 15-min tick so a real failure surfaces within 15 min. Cart rate-limit watch-point: `cart.add_pdp` / `cart.entries` now hit `/cart/add.js` 4× as often; if they flap, move to a separate hourly-only cron.
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
- **FEATURE — 2026-10-10 (hourly status detail report):** user's request "we need this to run hourly and have broken down detail aside from the daily giveaway changes report" — the full status digest (all 19 checks grouped by category, with detail/timing per check) now dispatches hourly on cron runs (was manual-only before). The giveaway rotation block is kept separate (its own dispatch, daily-gated) so the two reports stay distinct. Updated `formatStatusMessage()` to accept an optional `title` parameter (escapes HTML, defaults to "Status Report") so the Telegram header distinguishes "Hourly Status Report" (cron) from "Manual Run Report" (workflow_dispatch). Incident alerts (NEW FAILURES / STILL FAILING / RECOVERED) remain transition-based and independent. Verified: 100/100 unit tests (added 2 new title tests); hourly cron run now sends full digest with correct "Hourly Status Report" header.
- **FEATURE — 2026-10-10 (15-min cron resilience + hourly digest gate):** user reported the hourly check "not running at all or inconsistent" (last run ~10 AM Manila, checked at 3:38 PM — a 5.5h gap). Confirmed via the public GitHub Actions REST API (no `gh` auth needed on a public repo) that scheduled runs were genuinely **dropped**, not delayed: only 3 scheduled runs across 2+ days when hourly `0 * * * *` should have produced ~50. `0 * * * *` is the most congested minute on GitHub's shared cron scheduler. Installed `gh` CLI user-locally (`~/.local/bin/gh`, no sudo — not authenticated; `gh auth login` left for the user) for future live run-history checks. Fix (user chose option 2, the aggressive schedule): `.github/workflows/monitor.yml` cron changed to `7,22,37,52 * * * *` (even 15-min cadence, offset off the congested :00/:30 marks). To preserve the user's "hourly" report intent rather than send 4×/hour, added `getHourStamp(now?)` + `shouldSendHourlyStatusReport({isManualRun, stamp, now?})` to `src/schedule.js` (UTC-hour key — immune to DST repeated/skipped local hours) and gated the status-digest dispatch in `src/report.js` behind a new `state/hourly-status-report-hour.txt` stamp (read/write helpers mirroring the daily-report pattern). Incident alerts (`events.length > 0` dispatch) are deliberately left ungated so failures still surface within 15 minutes. Verified: 109/109 unit tests (9 new: 4 `getHourStamp`, 5 `shouldSendHourlyStatusReport`, incl. self-heal-after-dropped-tick and manual-bypass-doesn't-corrupt-cron-gating); 5-scenario sandbox against the real `report.js` (first-tick sends+stamps, same-hour second tick skips, stale-stamp self-heals, manual bypasses, cron-after-manual still gates correctly) — all passed. YAML + cron expression validated via PyYAML (even 15-min gaps, avoids :00/:30, `workflow_dispatch` preserved). **Watch-point flagged, not yet acted on:** `cart.add_pdp`/`cart.entries` hit `/cart/add.js` 4× as often now; if rate-limit flakes appear during burn-in, split cart checks onto a separate, lower-frequency schedule.

- **PRODUCTION BUG — CAUGHT PRE-DEPLOY & RESOLVED 2026-10-11 (metaobject field clearing):** the daily swap's
  staging-clear step called `updateMetaobjectFields` with `fields: [{key, value: null}]`, but Shopify's
  `MetaobjectFieldInput.value` is **`String!` (non-nullable)**. GraphQL rejects the `null` at variable-coercion
  time, so the mutation never reaches the resolver — this failed for **every** field type, not just the
  `file_reference`/`list.*` types the old open item suspected. Confirmed two independent ways: official docs, and
  live `__type` introspection against the deployed 2026-10 schema (`value: NON_NULL(String)`). **Why it was
  dangerous:** the promote-to-live mutation runs *first* and succeeds, so each nightly run would have correctly
  updated the live giveaway, then thrown on the clear, sent a **FAILED** Telegram alert, and `process.exit(1)`
  before `writeStamp` — leaving the gate open so the whole cycle repeated indefinitely. The operator would have
  seen nightly failure alerts for a system that was actually rotating the giveaway correctly. **Why tests missed
  it:** the swap's unit tests inject a mocked `makeFetcher` with canned responses; a mock cannot enforce
  Shopify's GraphQL schema, and no test asserted the request *payload shape*. **Fix:** new
  `replaceMetaobjectValues()` in `src/admin.js` using the mutually exclusive `MetaobjectUpdateInput.values: JSON`
  input (full replacement — omitted keys are cleared); `swap.js` clears staging with `values: {}`. The two write
  modes are now **deliberately asymmetric**: live uses the sparse `fields` write (27 fields — a full replacement
  would wipe its 19 monthly fields), staging uses full replacement (only ever holds the 8 daily fields).
  **Live-verified non-destructively:** `tmp/verify-clearing.mjs` created a throwaway `upcoming_flash_giveaway`
  entry populated with all the hard types (`file_reference`, `list.file_reference`,
  `list.single_line_text_field`), cleared it with `values: {}`, re-read it → **all fields cleared**; throwaway
  entry deleted, real entries never touched. A schema-compliance regression guard (recording fetcher asserting
  promote-uses-`fields` / clear-uses-`values` / no-`null`-anywhere) now closes the mock blind spot. 135/135 unit
  tests. Pushed `f0e85ed`.

---

## Next Step

**Chunk 11.3 is 🟡 awaiting review** (pushed `f0e85ed`). Step 6 (cron-job.org job) is the only remaining item and
is blocked on the user rotating the exposed cron-job.org API key.

**Tonight's automatic live full-cycle run — no action needed.** `monitor.yml` already runs on GitHub's native
15-minute schedule (`7,22,37,52 * * * *`) and calls `node src/giveaway/swap.js` as the self-healing fallback. The
first tick after **02:00 America/Chicago** will find the gate open, promote the operator's already-staged
**Oct 12** values into the live entry, clear staging via `values: {}`, write the stamp, and send a Telegram
success alert. This is a genuine full-cycle run on real data and does **not** depend on cron-job.org. **What to
check tomorrow:** (1) a Telegram swap-success alert arrived; (2) the live giveaway shows the Oct 12 values;
(3) the staging entry is empty; (4) `state/giveaway-swap-date.txt` was bot-committed with `2026-10-12`.

**User-side security housekeeping (unchanged, still outstanding):** rotate the GitHub fine-grained PAT and the
cron-job.org API key — both appeared in earlier session transcripts. Step 6 stays blocked until the cron-job.org
key is rotated.

**After Chunk 10 approval — go-live is a user-side sequence (no `gh` CLI in this environment):**

1. Add `SHOPIFY_ADMIN_API_TOKEN` to GitHub repo secrets (the other three should already exist — verify).
2. Trigger `workflow_dispatch` from the Actions tab. Expect **36 passed / 2 skipped** and a full Telegram digest.
3. Watch the hourly cron for a 2–3 day burn-in to surface flakes (most likely candidates: `cart.add_pdp` / `cart.entries` under `/cart/add.js` rate limiting).
4. If burn-in is clean, switch the `TELEGRAM_CHAT_ID` secret from the private chat to the group `-4207189876`.

**All 8 roadmap chunks are then complete; the monitor is in steady-state operation. Ongoing maintenance is `npm run allowlist` whenever a limited product restocks.**