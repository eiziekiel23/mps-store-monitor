# MPS Store Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Project protocol (CLAUDE.md, overrides defaults):** work runs in chunks of 5–7 steps. One chunk per session (`/resume`). `/checkpoint` at the end of each chunk, then **stop for user approval**. Update `STATE.md` (MPS Booster Theme root) after every step. Only the **current** chunk is detailed below; each later chunk is detailed in this file when it starts.

**Goal:** Outside-in synthetic monitoring of mysterypokeslabs.com on GitHub Actions. It produces correlated logs, metrics and traces, and alerts a Telegram channel on failure.

**Architecture:** Playwright Test runs the checks every 15 min on GitHub-hosted runners in a public repo. A custom reporter turns results into OTLP-JSON traces, JSONL logs and a metrics row, all sharing one `trace_id`. `report.js` runs an incident state machine (state kept on a `metrics` branch) and sends grouped Telegram messages.

**Tech Stack:** Node 22 (ESM), `@playwright/test` (Chromium), `node:test` for unit tests, GitHub Actions, Telegram Bot API, Shopify Storefront API.

**Spec:** `docs/superpowers/specs/2026-10-06-store-monitor-design.md`

## Global Constraints

- Store under test: `https://mysterypokeslabs.com`. **Never place an order**; checkout stops before payment and no email is entered.
- Block trackers on every page: Meta, TikTok, Google Analytics/Ads/GTM, Klaviyo, Shopify analytics beacons (monorail).
- User agent = the browser's normal Chrome UA (`HeadlessChrome` → `Chrome`) + ` MPSMonitor/1.0`.
- Secrets only via env/Actions secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SHOPIFY_STOREFRONT_TOKEN`, `DISCOUNT_CODE`. Never committed, never logged.
- Giveaway dates are America/Chicago wall time. Live values are text like `October 7, 2026 02:00:00`.
- Retry once per check (`retries: 1`). Alert on pass→fail, remind ≥60 min, recover on fail→pass, never alert on flaky.
- Every signal carries `trace_id`, `run_id`, `region` (`gha-us`), `attempt`.
- Cadence: `*/15 * * * *`; digest at `0 1 * * *` (09:00 Asia/Manila). Artifact retention 14 days. Metrics files pruned after 90 days.
- **Git:** the user commits themselves. Commit/push in `mps-store-monitor` only with the user's explicit go-ahead for that repo. Until then, "Commit" steps mean: list the files for the user.
- Line endings: LF for this new repo (`.gitattributes: * text=auto eol=lf`).

## Review Focus

1. **Storefront token missing/revoked:** the snapshot fetch fails, so every metaobject-dependent check fails with one clear reason (`snapshot unavailable: <http status>`), not N cryptic errors. *Test owner: Chunk 4 (snapshot), unit test with a mocked 401.*
2. **Telegram API down, wrong token, or 429:** `report.js` must still save incident state and metrics. It honors `retry_after` once, then logs and exits non-zero so the `if: failure()` path fires. *Test owner: Chunk 3, unit test with a mocked 429 and 401.*
3. **First run / `metrics` branch missing / concurrent push rejected:** create the branch if absent; on a non-fast-forward, fetch + rebase + retry up to 3×. *Test owner: Chunk 7, test against a temporary local bare repo.*
4. **No active giveaway (end date passed, metaobject not updated yet):** timer and flash checks fail with `no active giveaway (ended <date>)`, so it alerts once and then reminds hourly. No crash, no per-check storm. *Test owner: Chunk 4, unit test of the timer-expectation helper with a past date.*
5. **GitHub cron lag or skipped runs:** reminder and recovery maths use timestamps, never run counts, so a 40-min gap doesn't double-remind or miscount downtime. *Test owner: Chunk 3, unit test with irregular `nowMs` gaps.*

---

## Chunk overview

| # | Chunk | Steps | Verifiable result |
|---|---|---|---|
| 1 | **Spike (throwaway):** can a GitHub runner reach checkout, and which express buttons and extension blocks render? | 6 | `spike-results` JSON + screenshots from a GH runner (headless and xvfb-headed); decision recorded |
| 2 | Foundation: scaffold, Playwright config (projects, retries, tracker blocking, UA), telemetry modules, custom reporter | 7 | Unit tests pass; a sample run emits `traces.json`, `logs.jsonl`, `metrics.json` with one shared `trace_id` |
| 3 | Alerting: incident state machine, Telegram formatter + client (dry-run), `report.js` | 6 | Unit tests incl. Review Focus 2 and 5; dry-run prints the grouped 🔴/🔁/✅ messages for scripted runs |
| 4 | Snapshot + storefront checks I: `store.reachable` gate, home/product sections, announcement, timer, flash banners, product giveaway images | 7 | All pass on live; each proven to fail via an override; Review Focus 1 and 4 tests |
| 5 | Storefront checks II: hamburger 📱, key links, quick links, rules, video, stock, add to cart, cart entries | 7 | All pass on live; each proven to fail via an override; config paths confirmed by the user |
| 6 | Checkout checks (shape decided by chunk 1): express, blocks, timer, `sunday100` +100k, order protection | 6 | All pass on live; forced failures (bogus code, wrong tier table) go red |
| 7 | CI: `monitor.yml`, `digest.yml`, `metrics` branch push + prune, minimal dashboard, failure step, 60-day inactivity keep-alive check | 7 | Scheduled runs green on GitHub; test-chat receives alert → reminder → recovery from a forced failure; dashboard live |
| 8 | Burn-in and go-live: 2–3 days on the test chat, fix flakes, README setup docs, switch to the real channel | 5 | ≤1 flaky alert/day over the last 24 h; real channel receives the digest |

### Interfaces (fixed now so chunks agree)

```js
// src/telemetry/ids.js
newTraceId(): string            // 32 lowercase hex
newSpanId(): string             // 16 lowercase hex

// Shared shapes
// CheckResult = { id: string, status: 'passed'|'failed'|'flaky'|'skipped', attempts: number,
//                 durationMs: number, error?: string, screenshot?: string /* file path */,
//                 spanId: string }
// SpanRecord  = { spanId: string, parentSpanId: string|null, name: string, startMs: number,
//                 endMs: number, status: 'ok'|'error', attributes: Record<string, string|number|boolean> }

// src/telemetry/logger.js
createLogger({ traceId, runId, region }) -> { log(level, msg, fields = {}), entries(): object[], toJsonl(): string }
// src/telemetry/otlp.js
buildOtlpTrace({ traceId, runId, region, spans: SpanRecord[] }) -> object   // OTLP/JSON ExportTraceServiceRequest
// src/telemetry/metrics.js
buildMetricsRow({ traceId, runId, region, startedAt, durationMs, checks: CheckResult[], pages: PageTiming[] }) -> object
// PageTiming = { page: string, ttfbMs: number, lcpMs: number|null, cls: number|null }

// src/reporter.js  (Playwright reporter) -> writes telemetry/results.json = { traceId, runId, region, startedAt, durationMs, checks, spans, pages }

// src/alerting/incidents.js
applyRun(state: object, checks: CheckResult[], { nowMs, traceId }) -> { state: object, events: AlertEvent[] }
// AlertEvent = { type: 'opened'|'reminder'|'recovered', check: string, sinceMs: number, durationMs: number,
//                error?: string, firstTraceId: string, screenshot?: string }
// src/alerting/telegram.js
formatRunMessage({ events: AlertEvent[], traceId, runUrl, artifactUrl }) -> string|null
sendTelegram({ token, chatId, text, photos = [], dryRun }) -> Promise<void>

// src/snapshot.js
fetchSnapshot({ storeUrl, storefrontToken }) ->
  Promise<{ giveaway: Record<string, string|null>, bonusCoupons: {code: string, amount: number}[],
            products: {handle: string, title: string, available: boolean}[] }>
```

---

## Chunk 1 — Spike: checkout from a GitHub runner (THROWAWAY)

**Question:** From a GitHub-hosted Ubuntu runner, can Chromium (a) reach `/checkouts/...` with a cart, without a bot challenge, (b) see the 4 express buttons, and (c) see our 5 checkout extension blocks? Does headless differ from headed-under-xvfb?

**Prerequisite (user):** create an **empty public** GitHub repo `mps-store-monitor` and OK pushing a `spike` branch to it.

**Throwaway rule:** the spike lives in a scratch clone in the session scratchpad and on branch `spike`. Nothing from it is merged. The branch is deleted at the end of the chunk.

**Files (scratch clone, branch `spike`):**
- Create: `spike/checkout-spike.mjs`
- Create: `.github/workflows/spike.yml`

- [ ] **Step 1: Write the spike script**

`spike/checkout-spike.mjs`:
```js
// THROWAWAY spike — answers: can a GH runner reach checkout, and what renders there?
import { chromium } from 'playwright';
import fs from 'node:fs';

const STORE = 'https://mysterypokeslabs.com';
const MODE = process.env.MODE || 'headless'; // 'headless' | 'headed'
const OUT = `spike-results/${MODE}`;
const BLOCK = [
  /facebook\.(com|net)/, /tiktok/, /google-analytics|googletagmanager|doubleclick|googleadservices/,
  /klaviyo/, /monorail-edge\.shopifysvc\.com/, /\/\.well-known\/shopify\/monorail/,
];
const EXPRESS = {
  shopPay: ['[aria-label*="Shop Pay" i]', 'shop-pay-button', '[data-testid*="shop-pay" i]'],
  paypal: ['[aria-label*="PayPal" i]', 'iframe[title*="PayPal" i]'],
  amazonPay: ['[aria-label*="Amazon Pay" i]', 'iframe[title*="Amazon" i]', '[id*="AmazonPay" i]'],
  googlePay: ['[aria-label*="Google Pay" i]', 'iframe[title*="Google Pay" i]', 'gpay-button'],
};
const EXTENSION_TEXT = {
  entries: 'Your Order Gets Entries Into',
  timer: 'CHECKOUT IN THE NEXT',
  orderProtection: 'VIP Premium Order Protection',
};

fs.mkdirSync(OUT, { recursive: true });
const result = { mode: MODE, startedAt: new Date().toISOString(), errors: [] };

const browser = await chromium.launch({ headless: MODE === 'headless' });
const probe = await browser.newPage();
const ua = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome') + ' MPSMonitor/1.0';
await probe.close();
const context = await browser.newContext({ userAgent: ua, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
await context.route('**/*', (route) =>
  BLOCK.some((re) => re.test(route.request().url())) ? route.abort() : route.continue()
);
const page = await context.newPage();

try {
  // Pick an in-stock product ≥ $45 (so order protection is eligible), excluding pass/protection/ticket-only items
  const products = (await (await fetch(`${STORE}/products.json?limit=250`)).json()).products;
  const pick = products
    .filter((p) => !/pass|protection|^golden ticket/i.test(p.title))
    .flatMap((p) => p.variants.filter((v) => v.available && Number(v.price) >= 45).map((v) => ({ p, v })))[0];
  result.variant = pick && { product: pick.p.handle, variantId: pick.v.id, price: pick.v.price };
  if (!pick) throw new Error('no eligible in-stock variant ≥ $45');

  await page.goto(STORE, { waitUntil: 'domcontentloaded' });
  result.addStatus = await page.evaluate(async (id) => {
    const r = await fetch('/cart/add.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id, quantity: 1 }] }),
    });
    return r.status;
  }, pick.v.id);

  const resp = await page.goto(`${STORE}/checkout`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(15_000); // let checkout + extensions + wallets settle
  result.checkout = { status: resp?.status(), url: page.url(), title: await page.title() };

  const html = await page.content();
  result.challenge = {
    urlLooksLikeChallenge: /challenge|captcha/i.test(page.url()),
    hcaptchaFrame: (await page.locator('iframe[src*="hcaptcha"], iframe[src*="captcha"]').count()) > 0,
    deniedText: /access denied|verify you are human|are you a robot/i.test(html),
  };

  result.express = {};
  for (const [name, selectors] of Object.entries(EXPRESS)) {
    result.express[name] = false;
    for (const s of selectors) {
      if ((await page.locator(s).count()) > 0) { result.express[name] = s; break; }
    }
  }
  // Discovery dump so chunk 6 can pick stable selectors
  result.discovery = {
    buttonLabels: await page.$$eval('button, [role="button"]', (els) =>
      [...new Set(els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()).filter(Boolean))].slice(0, 80)),
    iframeTitles: await page.$$eval('iframe', (els) => els.map((e) => e.title || e.src.slice(0, 80))),
  };

  result.extensions = {};
  for (const [name, text] of Object.entries(EXTENSION_TEXT)) {
    result.extensions[name] = (await page.getByText(text, { exact: false }).count()) > 0;
  }
  result.extensions.trustBadgeImages = await page.locator('img[alt*="Trust Badge" i], img[alt="Trust badge"]').count();
} catch (e) {
  result.errors.push(String(e?.stack || e));
} finally {
  await page.screenshot({ path: `${OUT}/checkout.png`, fullPage: true }).catch(() => {});
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
```

- [ ] **Step 2: Run it locally (residential IP baseline)**

Run (scratch clone):
```bash
npm init -y >/dev/null && npm i playwright@latest && npx playwright install chromium
MODE=headless node spike/checkout-spike.mjs
```
Expected: `result.json` with `checkout.url` containing `/checkouts/` and a screenshot. Record the outcome in STATE.md. Local success does **not** answer the question, because datacenter IPs are treated differently.

- [ ] **Step 3: Write the spike workflow**

`.github/workflows/spike.yml`:
```yaml
name: spike-checkout
on:
  push:
    branches: [spike]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  spike:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm i playwright@latest && npx playwright install --with-deps chromium
      - run: MODE=headless node spike/checkout-spike.mjs
        continue-on-error: true
      - run: MODE=headed xvfb-run -a node spike/checkout-spike.mjs
        continue-on-error: true
      - name: Commit results to spike-results branch
        run: |
          git config user.name "spike-bot"; git config user.email "spike-bot@users.noreply.github.com"
          git switch --orphan spike-results
          git add -f spike-results
          git commit -m "spike results $(date -u +%FT%TZ)"
          git push -f origin spike-results
```

- [ ] **Step 4: Push and run on GitHub** (only after the user's go-ahead)

```bash
git remote add origin https://github.com/eiziekiel23/mps-store-monitor.git
git switch -c spike && git add spike .github package.json && git commit -m "spike: checkout reachability (throwaway)"
git push -u origin spike
```
Wait about 5 min, then `git fetch origin spike-results && git show origin/spike-results:spike-results/headless/result.json` (and `headed`). Expected: both JSON files present.

- [ ] **Step 5: Decide**

Read both results and screenshots, then record one of these in STATE.md and in spec §9:
- **A:** headless reaches checkout and the blocks render → chunk 6 uses headless.
- **B:** only xvfb-headed works → chunk 6 runs the checkout project headed under `xvfb-run`.
- **C:** both challenged → stop; present options to the user (e.g. reduce checkout cadence, self-hosted runner) before chunk 6.

Also record which express buttons were detected and the discovered labels and selectors.

- [ ] **Step 6: Verify and clean up (checkpoint)**

Confirm the decision is backed by the `result.json` files and screenshots. Delete the remote branches (`git push origin --delete spike spike-results`) and the scratch clone. Run `/checkpoint` and stop for approval.

## Chunk 3 — Alerting: Incident State & Telegram

**Goal:** Process the raw telemetry results to track pass/fail state over time, apply reminder cooldowns, and format grouped Telegram alerts.

- [ ] **Step 1: Write `src/alerting/incidents.js`**
  Implement `applyRun(state, checks, { nowMs, traceId })` per the plan interfaces. It maps previous state arrays and current results into `opened`, `reminder`, and `recovered` events, maintaining a 60-minute reminder cooldown.
- [ ] **Step 2: Write `src/alerting/telegram.js`**
  Implement `formatRunMessage({ events, traceId, runUrl, artifactUrl })` for grouped 🔴/🔁/✅ emoji output, and `sendTelegram()` with HTTP 429 `Retry-After` honoring (once).
- [ ] **Step 3: Write `src/report.js`**
  The post-run orchestrator. Reads `telemetry/results.json`, reads `state/incidents.json` (or creates empty), calls `applyRun`, sends Telegram, updates state.
- [ ] **Step 4: Unit tests for incidents (Review Focus 5)**
  Write `tests/unit/incidents.test.js`. Prove that a 40-minute gap between runs does not trigger double-reminders or drop state.
- [ ] **Step 5: Unit tests for Telegram (Review Focus 2)**
  Write `tests/unit/telegram.test.js`. Mock `fetch` to simulate a 429 response, verify it waits exactly `retry_after` and succeeds, and verify it exits cleanly on second failure.
- [ ] **Step 6: Dry-run and Checkpoint**
  Execute `node src/report.js --dry-run` against synthetic check fixtures to print formatted alert outputs, then commit and checkpoint.

