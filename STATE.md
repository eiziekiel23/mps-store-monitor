# MPS Store Monitor — Chunked Work State

**Repo:** `/mnt/d/mps-store-monitor` (public GitHub repo)  
**Last updated:** 2026-10-08 (Chunk 7 awaiting review — cart checks now verified green)  
**Chunked workflow:** 5-7 steps per chunk, update after every step, checkpoint + approval between chunks.

---

## Current Chunk

| Chunk | Status | Focus |
|-------|--------|-------|
| **6 (giveaway changelog)** | ✅ done | Giveaway freshness tracking, daily rotation detection, Markdown + Telegram rendering |
| **7 (remaining storefront checks)** | 🟡 awaiting review | Five remaining checks: nav.rules, nav.quick_links, video.how_to_enter, stock.all, cart.add_pdp + cart.entries |

### Chunk 7 Steps

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

## Completed

- **Chunk 7 (remaining storefront checks):** `tests/storefront/rules.spec.js`, `quick-links.spec.js`, `video.spec.js`, `stock.spec.js`, `cart.spec.js`; Cloudflare-bypass rework of `smoke.spec.js` + cart helpers; `config/monitor.config.js` quickLinks corrected to the 3 real footer policy links (commit `ab080f0`). **Cart checks verified GREEN locally** (29 passed / 3 skipped, both projects) once the test-IP Cloudflare block cleared. **Consolidated** duplicate `reachable.spec.js` → `smoke.spec.js` (title + Liquid-error assertions merged; commit `985a74d`)
- **Chunk 6 (giveaway changelog):** Snapshot diffing, daily-rotation staleness tracking, Markdown changelog, Telegram digest integration, config + CI runner, unit tests (24 new), commit-back step — **verified live in CI** (two `chore(giveaway): update changelog [skip ci]` commits on main)
- **Chunk 5 (nav):** nav.hamburger (mobile drawer open/close)
- **Chunk 4 (core storefront checks):** store.reachable, home.sections, product.sections, announcement.correct, timer.correct, flash.banners, product.giveaway_images (7 checks, 2 Playwright projects)
- **Chunk 3 (alerting):** Incident state machine, Telegram formatter/client, report.js orchestrator, 67 unit tests
- **Chunk 2 (design + impl plan):** Store monitor design spec, 8-chunk roadmap, GitHub repo creation
- **Chunk 1 (spike):** Playwright checkout reachability probe, GitHub Actions headless validation, decision on no-xvfb baseline runs

---

## Constraints & Decisions

- **Cloudflare blocks all bare HTTP clients.** Playwright's `request` fixture AND `page.request.*` both receive an HTTP 429 JS challenge (`cf-mitigated: challenge`). Cloudflare fingerprints the TLS/connection layer (JA3/JA4), so sharing cookies does not help. **Every check must use real browser navigation (`page.goto`) or in-page `page.evaluate(() => fetch(...))`.** Never `page.request`.
- **Booster Theme ATC is a `<div>`, not a `<button>`:** selector is `form.shopify-product-form .btn-atc-pdp`. `getByRole('button')` returns 0 matches; the `<button name="add">` elements are hidden mobile sticky-bar duplicates.
- **Cart-mutation endpoints are specially protected.** `/cart/add.js` and `/cart/clear.js` 429 far more aggressively than GETs (anti-scalper protection, appropriate for a limited-stock giveaway store). Two distinct 429 bodies observed: Shopify JSON `too_many_requests`, and Cloudflare's HTML challenge page.
- **Decision (user, 2026-10-08):** keep `cart.add_pdp` / `cart.entries` on the **hourly** cron as originally planned, accepting the rate-limit and any inventory-reservation exposure.
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
- Confirm the three secrets are repo-scoped: `SHOPIFY_STOREFRONT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Three giveaway field keys still inferred, not verified: `flash_giveaway_desktop_banner`, `flash_giveaway_mobile_banner`, `pdp_images` (confirmed: `flash_giveaway_end_date`). User shared admin screenshots (2026-10-08) showing the *display labels* — "Overlap Desktop Banner", "Overlap Mobile Banner", "PDP Images" — but **the display label is not the API key**. Need the **Key** column from Settings → Custom data → Metaobjects → definition, or the `Live field keys:` log line from a `workflow_dispatch` run.
- `stock.all` skips without `SHOPIFY_STOREFRONT_TOKEN`; it has never run green against live data
- claude-mem memory observer is signed out (since 2026-10-07T00:32:45Z) — needs `/login`; nothing is being remembered across sessions

---

## Next Step

**Chunk 8 (pending approval):** trigger a `workflow_dispatch` CI run to (a) confirm `cart.add_pdp` / `cart.entries` pass from a clean IP, (b) confirm the three inferred giveaway field keys, (c) confirm `stock.all` runs green with the storefront token, then proceed to the remaining checkout checks per the 8-chunk roadmap.
