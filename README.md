# MPS Store Monitor

A Playwright-based synthetic monitoring suite for [mysterypokeslabs.com](https://mysterypokeslabs.com), running hourly health checks via GitHub Actions with Telegram alerting. Monitors storefront availability, giveaway freshness, checkout functionality, and live inventory status across desktop and mobile.

**41 checks across 4 check groups** (7 storefront sections + announcements + timers + giveaway images + navigation + cart/checkout + stock + giveaway staleness + alerting). Aggregated by check ID (worst-wins ranking); desktop + mobile results deduplicated (skipped mobile results never alert).

## Quick Start (Local Development)

### Prerequisites
- Node 18+
- A Shopify store with Storefront and Admin API tokens
- A Telegram bot token and chat ID (for local testing/dry-run)

### Setup

1. **Clone and install:**
   ```bash
   git clone https://github.com/eiziekiel23/mps-store-monitor
   cd mps-store-monitor
   npm install
   ```

2. **Create `.env` (gitignored, for local dev only):**
   ```bash
   cp .env.example .env
   # Edit .env with your tokens:
   SHOPIFY_STOREFRONT_TOKEN=your_token_here
   SHOPIFY_ADMIN_API_TOKEN=your_admin_token_here
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   ```

3. **Run tests locally:**
   ```bash
   # Full suite (browser + API tests, ~2 min)
   npm test
   
   # Unit tests only (no browser)
   npm run test:unit
   ```

4. **Run giveaway freshness check and send alerts (local dry-run):**
   ```bash
   # Dry-run prints alert without actually sending
   TELEGRAM_BOT_TOKEN=fake TELEGRAM_CHAT_ID=fake node src/giveaway/check.js
   
   # Full pipeline (checks + alerting + metrics)
   node src/report.js
   ```

### Local Constraints

**WSL2 Chromium libraries:** If running Playwright on WSL2, set:
```bash
export LD_LIBRARY_PATH=/home/eiziekiel23/.claude/jobs/721a0389/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu
```

This is not needed on macOS or native Linux.

## Deployment (GitHub Actions)

### 1. Add Repository Secrets

In **Settings > Secrets and variables > Actions**, create these repository secrets:

| Secret | Obtained from |
|--------|---|
| `SHOPIFY_STOREFRONT_TOKEN` | Shopify Admin > Apps > Headless > Storefronts > API credentials |
| `SHOPIFY_ADMIN_API_TOKEN` | Shopify Admin > Settings > Apps and integrations > Develop apps > [your dev app] > Admin API (scope: `read_products`) |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram → /newbot → copy the token |
| `TELEGRAM_CHAT_ID` | Your Telegram chat or group ID (prefix with `-` for group chats with `@` name) |

### 2. Workflow Schedule

The monitor runs on **GitHub Actions** with the following schedule:

- **Hourly cron:** `0 * * * *` — runs all checks, sends Telegram alerts on state changes only
- **Manual trigger:** `workflow_dispatch` — runs all checks and sends full digest to Telegram

View runs at: https://github.com/eiziekiel23/mps-store-monitor/actions

### 3. Artifacts Generated

Each run produces:

- **Telemetry:** `traces.json`, `logs.jsonl`, `metrics.json` — exported as job artifacts
- **Giveaway changelog:** committed to `main` with auto-commit message `chore(giveaway): update changelog [skip ci]`
- **Incident state:** cached per run in `.github/workflows/` (used for alert deduplication, reminders, recovery tracking)

## Architecture

### Check Groups

**Storefront (16 checks)**
- `store.reachable` — basic connectivity + Cloudflare bypass confirmation
- `home.sections`, `product.sections` — required homepage/product sections present
- `announcement.correct` — announcement metaobject text matches live rendering
- `timer.correct` — countdown timer active and within ±2m of configured end date
- `flash.banners` — flash giveaway banner images load from metaobject references
- `nav.key_links`, `nav.quick_links`, `nav.rules` — key and quick footer links land on correct paths
- `product.giveaway_images` — giveaway brand image loads on reference products
- `video.how_to_enter` — homepage video loads and plays
- `cart.add_pdp`, `cart.entries` — add-to-cart via PDP puts item in `/cart.js`; cart entries math validated
- `stock.all` — every displayed product with `inventoryPolicy: DENY` is available for sale (Admin API)
- `nav.hamburger` — mobile drawer opens/closes (mobile-only)

**Checkout Extensions (3 checks)**
- `checkout.entries` — giveaway entries banner renders with self-consistent totals
- `checkout.bonus_entries` — bonus entry amount matches timer and banner agreement
- `checkout.trust_badge` — trust badge image present and loaded

**Giveaway Freshness (1 check)**
- `giveaway.freshness` — flash giveaway fields rotated in the last 24h (within grace window)

**Alerting (1 check)**
- `alerting.healthy` — Telegram delivery, incident state machine, metrics export all working

### Technologies

- **Test framework:** Playwright (Node v22, `@playwright/test@1.63`)
- **API client:** Shopify Admin API (for inventory) + Storefront API (for snapshots)
- **Alerting:** Telegram Bot API with retry/backoff
- **Telemetry:** Custom OpenTelemetry-like JSON (traces, logs, metrics, correlation IDs)
- **CI/CD:** GitHub Actions (cron + workflow_dispatch) with artifact cache

### Data Flow

```
hourly cron or manual trigger
    ↓
[Playwright tests run (browser + API)]
    ├─ storefront checks (via browser)
    ├─ checkout checks (via browser)
    ├─ stock checks (via Admin API)
    └─ [generates telemetry: traces.json, logs.jsonl, metrics.json]
    ↓
[src/giveaway/check.js] — metaobject staleness vs daily anchor
    ↓
[src/report.js] — incident state machine + Telegram formatter
    ├─ on-disk incident state (used for dedup, reminders, recovery)
    ├─ cron run: send only state changes
    └─ manual run: send full digest
    ↓
Telegram channel receives:
    ├─ ✅ all-green digest with check count and duration
    ├─ 🔴 opened/reminder alerts per failing check
    └─ 🔁 recovery alerts when checks return to green
```

## Configuration

### `config/monitor.config.js`

Centralized configuration for all checks:

```javascript
export default {
  storeUrl: 'https://mysterypokeslabs.com',
  admin: {
    shop: 'mysterypokeslabs.myshopify.com',
    apiVersion: '2026-10'
  },
  referenceProducts: ['5x-pokemon-booster-packs', 'premium-modern-pokemon-cards'],
  sections: { /* section tokens for each page */ },
  navigation: { /* key + quick links + rules page */ },
  stock: {
    exclusionsRegex: /pass|protection|^golden ticket/i,
    knownSoldOut: [ /* 8 limited product handles, manually maintained */ ]
  },
  orderProtection: { tiers: [ /* pricing table */ ] },
  giveaway: { /* rotation timing, tolerance, field keys */ },
  trackers: { blockRegex: [ /* ad trackers to block in tests */ ] }
};
```

**Key maintenance points:**

- **`stock.knownSoldOut`:** When a product in this list restocks and resells, remove its handle. When a new limited product sells out, add its handle so the check doesn't permanently redden.
  
  To refresh the list (e.g., after a restock):
  ```bash
  npm run allowlist         # or: node scripts/update-allowlist.js
  ```
  
  This queries the Admin API and prints (a) every out-of-stock DENY-policy product and (b) the live status of each current `knownSoldOut` entry — flagging any that are **BACK IN STOCK** (remove them) or no longer displayed. Manually update `config/monitor.config.js` with the changes. Requires `SHOPIFY_ADMIN_API_TOKEN`.

- **`giveaway.rotationFields`:** The metaobject field keys used to detect a daily giveaway rotation (verified against live `metaobjectDefinitions`).

- **`sections.home` / `sections.product`:** Substring tokens matched against Shopify section IDs (e.g., `mps_giveaway_timer` matches the section id `__mps_giveaway_timer_flash`).

## Troubleshooting

### "stock.all skipped"
- **Local dev:** Ensure `.env` is present with `SHOPIFY_ADMIN_API_TOKEN`
- **CI:** Verify `SHOPIFY_ADMIN_API_TOKEN` is set in GitHub Secrets

### "Cloudflare 429 (bot challenge)"
- This is expected on the first run against the store. Tests use real browser navigation (`page.goto`) or in-page `fetch` to bypass the challenge. The Admin API calls go to `*.myshopify.com` which is not behind Cloudflare.
- If repeated 429s occur, the store's IP or user-agent may be blocked. Wait ~15 minutes or try from a different IP.

### "Cart tests fail inconsistently"
- **Expected:** `/cart/add.js` has anti-scalper rate limiting. If runs are hourly + manual testing, this endpoint gets hit frequently and may 429. This is appropriate for a limited-stock giveaway store.
- **Mitigation:** If these checks start flapping in CI, move them to a lower-frequency cron (e.g., every 6 hours) rather than loosening the assertions.

### "Telegram 429 Rate Limited"
- The alerting pipeline honors the Telegram `Retry-After` header and retries once. If it still fails, the run logs the error, saves incident state (so no alerts are lost), and exits non-zero.

## Testing Strategy

**Two test suites:**

1. **Unit tests** (`npm run test:unit`) — mocked APIs, no browser
   - Admin API pagination, filtering, error cases
   - Incident state machine, reminder/recovery maths
   - Giveaway rotation detection, staleness evaluation
   - Telegram formatting, retry/backoff
   - Telemetry tracing, metrics flattening
   - ~80 tests, ~3 seconds

2. **Storefront + Checkout tests** (`npm test`) — real browser, live APIs
   - 38 tests across 2 projects (desktop-chrome + mobile iPhone)
   - Tests run in parallel except checkout (serial to avoid cart collisions)
   - 1 retry per check
   - Mobile-only checks (nav.hamburger) skipped on desktop, desktop-only checks (stock.all) skipped on mobile
   - ~2 minutes local, aggregated via worst-wins ranking

**Test discovery:** Playwright auto-discovers tests in `tests/` matching `*.spec.js`. Each test is annotated with `{ annotation: { type: 'check', description: '<check_id>' } }` so the custom reporter can deduplicate and aggregate.

## Performance & Limits

- **Local run:** ~2 minutes (browser launches, storefront renders, API calls)
- **CI run:** ~1–1.5 minutes (GitHub Actions uses 2 vCPU, parallel workers)
- **Concurrency:** Desktop-chrome and mobile run in parallel; checkout checks run serial per project
- **API quota:** 
  - Storefront API: 25 calls/second leaky bucket (shared with all client requests)
  - Admin API: 2 calls/second standard (sufficient for the monitor)
  - Telegram: 30 messages/second (not a concern for hourly runs)

## Contributing

**Local development workflow:**

1. Create a branch: `git checkout -b feature/my-check`
2. Add test in `tests/storefront/*.spec.js` or `tests/checkout/*.spec.js`
3. Annotate with check ID: `{ annotation: { type: 'check', description: 'my.check' } }`
4. Update `config/monitor.config.js` if needed (sections, links, timeouts)
5. Run tests: `npm test`
6. Commit: `git add . && git commit -m "feat: add my.check"`
7. Push and open a PR

**Review checklist:**
- [ ] Test passes locally on both projects
- [ ] No hardcoded timeouts or brittle selectors (use data attributes where possible)
- [ ] Cloudflare bypassed (browser navigation, not `page.request.*`)
- [ ] No secrets in code (use env vars from `.env` / GitHub Secrets)
- [ ] Check ID added to `config/` if it's a new check
- [ ] Commit message follows convention

## Resources

- [Playwright test docs](https://playwright.dev/docs/intro)
- [Shopify Admin API reference](https://shopify.dev/docs/api/admin-rest)
- [Shopify Storefront API reference](https://shopify.dev/docs/api/storefront)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

**Last updated:** 2026-10-08 (Chunk 9 complete, Admin API inventory integration live)
