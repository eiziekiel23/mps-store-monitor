# MPS Store Monitor — Design

**Date:** 2026-10-06
**Status:** Draft for review
**Store:** https://mysterypokeslabs.com (theme: MPS Booster Theme; checkout extensions: `mps-checkout-extension-app-react`)

## 1. Goal

Outside-in synthetic monitoring of the customer-critical paths of the MPS store. Real browsers on the public internet exercise the storefront and checkout on a schedule. Failures reach a Telegram channel within one run (about 15 min), with correlated logs, metrics and traces to diagnose them.

**Success criteria**
- Every item on the agreed checklist (§4) is an automated check that passes on a healthy store and has been proven to fail when its condition breaks.
- A real breakage produces one Telegram alert, a reminder at most hourly while it persists, and a recovery message.
- Every alert carries a `trace_id` that finds the matching logs, metrics, trace and screenshots.
- The monitor never places an order and does not pollute ad/marketing pixels.

**Non-goals**
- True multi-region probing. GitHub-hosted runners can't pick a region. Every signal carries a `region` label (`gha-us`) so more vantage points can be added later without redesign.
- A telemetry backend. Everything lives in GitHub (artifacts + a `metrics` branch). Traces are written in OTLP JSON so a backend can be added later without code changes.
- Real-user monitoring from buyers' browsers.

## 2. Decisions

| Topic | Decision |
|---|---|
| Runner | GitHub Actions cron, every 15 min, plus manual dispatch |
| Repo | New **public** repo `mps-store-monitor` (free, unlimited standard-runner minutes); local path `/mnt/d/mps-store-monitor` |
| Framework | Playwright Test (Approach A). Browser-free checks use plain HTTP inside the same suite |
| Telemetry | GitHub only: run artifacts + `metrics` branch + minimal GitHub Pages dashboard |
| Correctness source | `giveaway / mps-giveaway` metaobject (and `bonus_coupons`) via the Storefront API |
| Alerting | Retry once in-run → alert on transition to failing → hourly reminder → recovery message; daily digest |

## 3. Architecture

```
GitHub Actions (cron */15, concurrency: monitor)
  ├─ setup: npm ci (cached), Playwright Chromium (cached)
  ├─ global setup: generate trace_id; fetch store snapshot
  │     (mps-giveaway + bonus_coupons metaobjects, product availability)
  ├─ playwright test      → results + per-check spans/logs (custom reporter)
  ├─ report (always)      → traces.json, logs.jsonl, metrics row
  │                         update state/incidents.json, send Telegram, push to `metrics` branch
  ├─ upload artifact      telemetry-<trace_id> (14-day retention)
  └─ on failure()         curl Telegram "⚠️ Monitor run broken"

GitHub Actions (cron 01:00 UTC = 09:00 Asia/Manila) → digest: 24h summary + heartbeat
```

**Repo layout**
```
.github/workflows/monitor.yml, digest.yml
playwright.config.js        projects: desktop-chrome, mobile (iPhone emulation); retries: 1
config/monitor.config.js    store URL, reference products, required section types,
                            key-link and quick-link expected paths, stock exclusions,
                            order-protection tier table, tracker block list
src/snapshot.js             Storefront API fetch of metaobjects + products
src/telemetry/              ids, OTLP trace builder, JSONL logger, metrics row
src/alerting/               incident state machine, Telegram formatter + client
src/report.js               post-run: telemetry files, state, Telegram, metrics push
src/digest.js               daily summary
tests/storefront/*.spec.js  storefront checks
tests/checkout/*.spec.js    checkout checks (serial, one checkout session)
tests/unit/*.test.js        pure-logic unit tests
dashboard/index.html        static page, published from the `metrics` branch
```

**Secrets:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SHOPIFY_STOREFRONT_TOKEN` (read-only, Headless channel), `DISCOUNT_CODE` (`sunday100`).

## 4. Check catalog

The run gate `store.reachable` (an HTTP GET of `/`) runs first. If it fails, all other checks are skipped and a single "Store unreachable" alert is sent.

### Storefront (desktop Chrome unless 📱 = mobile profile)

| ID | Pass condition |
|---|---|
| `home.sections` | Each required section **type** (header, announcement, flash timer, giveaway, trust badge, video, featured collection, winners, customer pulls, reviews, FAQs, footer) is present, visible and non-empty, with no `Liquid error` text. All images in them load (HTTP 200, `naturalWidth > 0`). Matching is by type prefix, not instance ID. |
| `product.sections` | Same rules on the reference product pages from config |
| `announcement.correct` | Desktop and 📱 announcement text equals `mps_announcement_bar_text` |
| `timer.correct` | The displayed countdown is within ±2 min of `end_date` interpreted as America/Chicago wall time, and it decreases over 3 s. The flash timer is checked the same way against `flash_giveaway_end_date`. |
| `flash.banners` | Every flash-giveaway image loads and matches the image the metaobject references. Field names are taken from the theme's `giveaway-section-monthly-flash.liquid`. |
| `product.giveaway_images` | The product-page giveaway image matches the current giveaway from the metaobject |
| `nav.hamburger` 📱 | Tap opens the drawer, menu links are visible, and close works |
| `nav.key_links` | Sealed Pokémon, Giveaway Winners, Customer Pulls and Customer Reviews each land on the expected path with a 200 and a visible main heading/content |
| `nav.quick_links` | Every footer "Quick links" item lands on its expected path (map in config) with a 200 |
| `nav.rules` | The official rules page opens and shows its heading and body |
| `video.how_to_enter` | The video starts, and its `currentTime` advances (or the embedded player loads and reports playing) |
| `stock.all` | Every published product has ≥1 available variant, minus config exclusions. The alert lists the offenders. |
| `cart.add_pdp` | Add to cart on each reference product puts it in `/cart.js` |
| `cart.entries` | The cart shows entries = Σ `_entries` × quantity |

### Checkout (serial, one session per run)

| ID | Pass condition |
|---|---|
| `checkout.express` | Shop Pay, PayPal, Amazon Pay and Google Pay buttons render. If the spike shows headless Chromium can't render Google Pay/Amazon Pay, those two accept "button container present". |
| `checkout.blocks` | Both trust badges, the timer and the entries banner render. Product entries = Σ `_entries`; bonus entries = `bonus_entries_amount` while the 10-min window is open. |
| `checkout.timer` | The countdown starts between 9:00 and 10:00 and decreases |
| `checkout.discount` | Applying `DISCOUNT_CODE` raises bonus entries by exactly 100,000 (cross-checked against `bonus_coupons`) and the total updates to match |
| `checkout.order_protection` | The widget shows the tier price for the protected cart total (tier table in config), and the line appears in the order summary. Unchecking removes the line; checking again restores it. |

## 5. Telemetry and correlation

- **IDs:** one `trace_id` (32 hex) per run. One span per check (16 hex) under the root span `monitor.run`, and one child span per `test.step`. Every signal carries `trace_id`, `run_id`, `region`, `attempt`.
- **Traces:** `traces.json` in OTLP/JSON. Failed checks also keep a Playwright `trace.zip` (`trace: 'retain-on-failure'`) and a screenshot.
- **Logs:** `logs.jsonl`, one object per event: `ts, level, check, msg, trace_id, span_id, run_id, attempt, url, error`. Browser console errors, page errors and 4xx/5xx responses from the store domain are captured automatically.
- **Metrics:** per check (status 1/0, duration_ms, attempts), per page (TTFB, LCP, CLS for home and reference PDP), per run (duration, pass/fail counts). One compact row per run is appended to `metrics/YYYY-MM.jsonl` on the `metrics` branch. Files older than 90 days are pruned.
- **Artifacts:** `telemetry-<trace_id>`, 14-day retention. They contain only the monitor's test cart, never customer data.
- **Dashboard (minimal):** a single static `index.html` with no build step and no chart library. It shows a table per check (current status, 24h and 7d uptime, last-failure run link) and the last 20 incidents (check, start, duration, trace_id).

## 6. Alerting

**State:** `state/incidents.json` on the `metrics` branch: `{check: {since, first_trace_id, last_alert_at, failed_runs}}`. The workflow `concurrency` group guarantees a single writer; the push uses rebase-and-retry.

| Transition (final result after retry) | Message |
|---|---|
| pass → fail | 🔴 Immediate alert: reason, screenshot, trace_id, run and artifact links |
| fail → fail | 🔁 Reminder if ≥ 60 min since the last alert, with duration and run count |
| fail → pass | ✅ Recovered, with total downtime |
| fail then pass on retry (flaky) | No message; logged, counted, included in the digest |

- All failures in one run go in **one message** (one line per check) with up to 3 screenshots.
- Telegram Bot API: `sendMessage` (HTML parse mode) and `sendMediaGroup`/`sendPhoto` for screenshots. `TELEGRAM_DRY_RUN=1` prints instead of sending.
- Monitor health: the `if: failure()` step sends "⚠️ Monitor run broken". The daily digest is the heartbeat. GitHub disables scheduled workflows in public repos after 60 days without repository activity. We verify that the metrics-branch commits count as activity, and add a keep-alive if they don't.

## 7. Side-effect containment

- **Trackers blocked** at the browser level via `page.route` abort: Meta, TikTok, Google Analytics/Ads, Klaviyo, other configured domains, and Shopify analytics beacons. This keeps fake page views and AddToCart events out of ad optimization.
- **No orders:** checkout stops before payment. No email is entered, so no abandoned-checkout emails go out. Carts don't reserve inventory. The discount code isn't consumed without an order.
- **Identifiable traffic:** the user agent is a normal Chrome UA with an `MPSMonitor/1.0` suffix.
- **Known drift risk:** the order-protection tier table is duplicated from the extension repo. A divergence fails `checkout.order_protection` loudly.

## 8. Testing

- Unit tests for: incident transitions (incl. reminder timing, flaky), Telegram formatting, OTLP trace and metric row building, Chicago-time timer target, tier lookup, entries totals.
- **Forced-failure proof for every check** via config/env overrides (e.g. wrong expected announcement text, bogus discount code, unreachable URL), recorded in the plan's verification steps.
- Local runs against the live store in dry-run mode before any scheduled run.

## 9. Rollout

1. **Spike (throwaway):** headless Chromium on a GitHub runner. Does it reach checkout without a bot challenge, and which express buttons render? If checkout is challenged, try headed Chromium under `xvfb`. If that is also challenged, stop and revisit the checkout approach with the user before building checkout checks.
2. Build the storefront checks, telemetry and alerting; run locally in dry-run.
3. Build the checkout checks on the spike's outcome.
4. User creates the public repo, Telegram bot and secrets. Alerts go to a **test chat for 2–3 days** to tune flakiness, then `TELEGRAM_CHAT_ID` switches to the real channel.

## 10. Open items resolved during implementation (not design decisions)

- Exact selectors and metaobject field names, read from the Booster Theme source and the live site.
- Reference products, quick-link and key-link expected paths, and stock exclusions. These are populated in `config/monitor.config.js` from the live site and shown to the user for confirmation.
