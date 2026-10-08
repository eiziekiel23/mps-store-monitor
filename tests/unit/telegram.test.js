import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatRunMessage, formatStatusMessage, sendTelegram } from '../../src/alerting/telegram.js';

describe('alerting/telegram - formatStatusMessage', () => {
  const traceId = 'b'.repeat(32);

  test('reports an all-green run with grouped per-check status board', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'home.sections', status: 'passed' },
      { id: 'nav.hamburger', status: 'skipped' }
    ];

    const msg = formatStatusMessage({ checks, traceId });

    assert.ok(msg.includes('✅ *MPS Store Monitor — Manual Run Report*'));
    assert.ok(msg.includes('2 passed, 0 failed, 1 skipped / 3 total'));
    // Per-check status board replaces "All checks passing" summary
    assert.ok(msg.includes('*Storefront*'));
    assert.ok(msg.includes('✅ Store reachable'));
    assert.ok(msg.includes('*Navigation*'));
    assert.ok(msg.includes('⏭️ Mobile hamburger menu'));
    assert.ok(msg.includes(traceId));
  });

  test('shows failure details with friendly names and check IDs', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'nav.key_links', status: 'failed', error: 'Test timeout of 30000ms exceeded.' }
    ];

    const msg = formatStatusMessage({ checks, traceId });

    assert.ok(msg.includes('🔴 *MPS Store Monitor — Manual Run Report*'));
    assert.ok(msg.includes('1 passed, 1 failed'));
    assert.ok(msg.includes('🔴 *FAILURE DETAILS*'));
    // Friendly name + check ID shown together for ops reference
    assert.ok(msg.includes('• Giveaway / Gallery / Reviews links (`nav.key_links`)'));
    assert.ok(msg.includes('_Test timeout of 30000ms exceeded._'));
  });

  test('counts flaky checks separately and displays them with warning emoji', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'timer.correct', status: 'flaky' }
    ];

    const msg = formatStatusMessage({
      checks,
      traceId,
      runUrl: 'https://github.com/org/repo/actions/runs/123'
    });

    assert.ok(msg.includes('1 passed, 1 flaky, 0 failed, 0 skipped / 2 total'));
    assert.ok(msg.includes('⚠️ Countdown timer'), 'flaky check shown with warning emoji');
    assert.ok(msg.includes('(https://github.com/org/repo/actions/runs/123)'));
  });

  test('groups checks by category in the status board', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'nav.key_links', status: 'passed' },
      { id: 'cart.add_pdp', status: 'passed' },
      { id: 'checkout.entries', status: 'passed' },
      { id: 'stock.all', status: 'passed' },
      { id: 'giveaway.freshness', status: 'passed' }
    ];

    const msg = formatStatusMessage({ checks, traceId });

    // Each category header appears in order
    const storefront_idx = msg.indexOf('*Storefront*');
    const nav_idx       = msg.indexOf('*Navigation*');
    const cart_idx      = msg.indexOf('*Cart*');
    const checkout_idx  = msg.indexOf('*Checkout*');
    const stock_idx     = msg.indexOf('*Stock*');
    const giveaway_idx  = msg.indexOf('*Giveaway*');

    assert.ok(storefront_idx > 0, 'Storefront group present');
    assert.ok(nav_idx > storefront_idx, 'groups ordered: Navigation after Storefront');
    assert.ok(cart_idx > nav_idx, 'groups ordered: Cart after Navigation');
    assert.ok(checkout_idx > cart_idx, 'groups ordered: Checkout after Cart');
    assert.ok(stock_idx > checkout_idx, 'groups ordered: Stock after Checkout');
    assert.ok(giveaway_idx > stock_idx, 'groups ordered: Giveaway after Stock');
  });
});

describe('alerting/telegram - formatRunMessage', () => {
  const traceId = 'a'.repeat(32);

  test('returns null for empty events array', () => {
    assert.equal(formatRunMessage({ events: [], traceId }), null);
  });

  test('formats opened, reminder, and recovered sections with friendly labels', () => {
    const events = [
      { type: 'opened', check: 'home.sections', error: 'Missing trust badge' },
      { type: 'reminder', check: 'timer.correct', durationMs: 7200000 },
      { type: 'recovered', check: 'nav.rules', durationMs: 1800000 }
    ];

    const msg = formatRunMessage({
      events,
      traceId,
      runUrl: 'https://github.com/org/repo/actions/runs/123'
    });

    assert.ok(msg.includes('🔴 *NEW FAILURES*'));
    assert.ok(msg.includes('• Homepage sections render (`home.sections`)'));
    assert.ok(msg.includes('_Missing trust badge_'));

    assert.ok(msg.includes('🔁 *STILL FAILING*'));
    assert.ok(msg.includes('• Countdown timer (`timer.correct`) — 2.0h'));

    assert.ok(msg.includes('✅ *RECOVERED*'));
    assert.ok(msg.includes('• Official rules page (`nav.rules`) — after 30m'));

    assert.ok(msg.includes('[Trace ID: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`](https://github.com/org/repo/actions/runs/123)'));
  });

  test('appends per-check status board when full checks list is provided', () => {
    const events = [
      { type: 'opened', check: 'flash.banners', error: 'Banner not found' }
    ];
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'flash.banners', status: 'failed', error: 'Banner not found' },
      { id: 'timer.correct', status: 'passed' }
    ];

    const msg = formatRunMessage({
      events,
      checks,
      traceId,
      runUrl: 'https://github.com/org/repo/actions/runs/123'
    });

    // Alert section
    assert.ok(msg.includes('🔴 *NEW FAILURES*'));
    assert.ok(msg.includes('• Flash giveaway banners (`flash.banners`)'));

    // Status board section (added when checks provided)
    assert.ok(msg.includes('📋 *Check Status*'));
    assert.ok(msg.includes('✅ Store reachable'));
    assert.ok(msg.includes('🔴 Flash giveaway banners'));
    assert.ok(msg.includes('✅ Countdown timer'));
  });

  test('does not append status board when checks list is not provided', () => {
    const events = [
      { type: 'opened', check: 'store.reachable', error: 'Timeout' }
    ];

    const msg = formatRunMessage({
      events,
      traceId,
      runUrl: 'https://github.com/org/repo/actions/runs/123'
    });

    assert.ok(msg.includes('🔴 *NEW FAILURES*'));
    assert.ok(!msg.includes('📋 *Check Status*'), 'status board not added when checks not provided');
  });
});

describe('alerting/telegram - sendTelegram', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('dryRun does not call fetch', async () => {
    let called = false;
    globalThis.fetch = () => { called = true; };

    await sendTelegram({
      token: 'fake-token',
      chatId: 'fake-chat',
      text: 'hello',
      dryRun: true
    });

    assert.equal(called, false);
  });

  test('successful message dispatch', async () => {
    let calledPayload = null;
    globalThis.fetch = async (url, opts) => {
      calledPayload = { url, body: JSON.parse(opts.body) };
      return { ok: true, status: 200 };
    };

    await sendTelegram({
      token: 'my-bot-token',
      chatId: '-100123456',
      text: 'Test Alert'
    });

    assert.equal(calledPayload.url, 'https://api.telegram.org/botmy-bot-token/sendMessage');
    assert.equal(calledPayload.body.chat_id, '-100123456');
    assert.equal(calledPayload.body.text, 'Test Alert');
    assert.equal(calledPayload.body.parse_mode, 'Markdown');
  });

  test('honors 429 Retry-After on first attempt and succeeds on second (Review Focus 2)', async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ parameters: { retry_after: 0.01 } }) // 10ms for fast test
        };
      }
      return { ok: true, status: 200 };
    };

    await sendTelegram({
      token: 'my-bot-token',
      chatId: '-100123456',
      text: 'Test Alert'
    });

    assert.equal(attempts, 2);
  });

  test('throws immediately on unrecoverable HTTP status (e.g. 401)', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    });

    await assert.rejects(
      () => sendTelegram({ token: 'bad-token', chatId: '123', text: 'hi' }),
      /Telegram API Error: 401 Unauthorized/
    );
  });
});
