# MPS Store Monitor — Chunked Work State

**Repo:** `/mnt/d/mps-store-monitor` (public GitHub repo)  
**Last updated:** 2026-10-07 08:12 UTC  
**Chunked workflow:** 5-7 steps per chunk, update after every step, checkpoint + approval between chunks.

---

## Current Chunk

| Chunk | Status | Focus |
|-------|--------|-------|
| **6 (giveaway changelog)** | ✅ done | Giveaway freshness tracking, daily rotation detection, Markdown + Telegram rendering |
| **7 (remaining storefront checks)** | ▶ in progress | Five remaining checks: nav.rules, nav.quick_links, video.how_to_enter, stock.all, cart.add_pdp + cart.entries |

### Chunk 7 Steps

- [ ] Step 1: nav.rules spec (giveaway rules page reachable)
- [ ] Step 2: nav.quick_links spec (footer quick links validation)
- [ ] Step 3: video.how_to_enter spec (video loads and plays)
- [ ] Step 4: stock.all spec (reference products available)
- [ ] Step 5: cart.add_pdp + cart.entries specs (add-to-cart + cart render)
- [ ] Step 6: Run complete storefront test suite + verify green
- [ ] Step 7: End-to-end checkpoint

---

## Completed

- **Chunk 1 (spike):** Playwright checkout reachability probe, GitHub Actions headless validation, decision on no-xvfb baseline runs
- **Chunk 2 (design + impl plan):** Store monitor design spec, 8-chunk roadmap, GitHub repo creation
- **Chunk 3 (alerting):** Incident state machine, Telegram formatter/client, report.js orchestrator, 67 unit tests
- **Chunk 4 (core storefront checks):** store.reachable, home.sections, product.sections, announcement.correct, timer.correct, flash.banners, product.giveaway_images (7 checks, 2 Playwright projects)
- **Chunk 5 (nav):** nav.hamburger (mobile drawer open/close)
- **Chunk 6 (giveaway changelog):** Snapshot diffing, daily-rotation staleness tracking, Markdown changelog, Telegram digest integration, config + CI runner, unit tests (24 new), commit-back step

---

## Constraints & Decisions

- Playwright tests run on `desktop-chrome` and `mobile` projects; checks are deduplicated (worst-status-wins)
- Daily giveaway rotation anchor: 02:00 America/Chicago with 1h grace; staleness if no rotation fields change by ~03:00
- Incident reminder cooldown: 60 minutes for persistent failures
- Hourly (cron) runs send Telegram only on state changes; manual runs (`workflow_dispatch`) send full digest
- Giveaway snapshot + changelog committed to repo (not cached); incident state cached (not committed)
- Three field keys in giveaway schema are inferred, not yet verified: `flash_giveaway_desktop_banner`, `flash_giveaway_mobile_banner`, `pdp_images` (confirmed key: `flash_giveaway_end_date`)
- First CI run must confirm the inferred field keys via the `Live field keys:` log line in check.js output

---

## Open Items

- Confirm the three secrets are set at the repo level (or add `environment:` block to workflow)
- Trigger a `workflow_dispatch` run to verify the first live execution and confirm field keys
- nav.quick_links and nav.rules tests reference `config.navigation.quickLinks` and `config.navigation.rules` — the latter doesn't exist in monitor.config.js yet (need to ask user or infer from the Booster Theme repo)

---

## Next Step

**Chunk 7, Step 1:** Build nav.rules spec — verify the giveaway rules page is reachable and contains expected content.
