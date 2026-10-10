import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatRunMessage, formatStatusMessage, sendTelegram, escapeHtml } from '../../src/alerting/telegram.js';

/**
 * Verify that the message is well-formed Telegram HTML.
 *
 * Checks two things:
 *   1. No raw unescaped `<`, `>`, or `&` outside of intentional tags — if
 *      dynamic text slips through unescaped the parser would reject it.
 *   2. Every HTML tag we open is also closed, and in the right order (no
 *      crossing/unclosed tags).
 *
 * This replaces the old `assertBalancedEntities` which counted `_` and `*`
 * characters to catch legacy-Markdown parse failures. That approach had a
 * critical blind spot: it stripped backslash-escaped delimiters AND code spans
 * before counting, so it saw 4 (balanced) while Telegram's parser saw 5 (odd →
 * HTTP 400). The HTML approach is immune to that class of error entirely.
 */
function assertValidHtml(msg) {
  // Telegram HTML supports: b, strong, i, em, u, ins, s, del, code, pre,
  // a (href only), tg-spoiler, blockquote.  We emit a subset; check all of them.
  const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'del',
    'code', 'pre', 'a', 'tg-spoiler', 'blockquote']);

  const stack = [];
  // Walk through all < > pairs
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let m;
  while ((m = tagRe.exec(msg)) !== null) {
    const full = m[0];
    const name = m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue; // ignore HTML entities like &lt; rendered in context
    const isClose = full.startsWith('</');
    if (isClose) {
      assert.ok(stack.length > 0, `Unexpected closing </${name}> with empty stack`);
      const top = stack.pop();
      assert.equal(top, name, `Mismatched tag: expected </${top}> but got </${name}>`);
    } else {
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0, `Unclosed HTML tags: ${stack.join(', ')}`);

  // Make sure no raw & slipped through outside an entity reference.
  // Strip all &xxx; entities first, then any remaining & is a bug.
  const stripped = msg.replace(/&[a-zA-Z]+;/g, '');
  assert.ok(!stripped.includes('&'), `Raw unescaped & found in message`);
}

describe('escapeHtml', () => {
  test('escapes & < > in that order so & is not double-escaped', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml('<tag>'), '&lt;tag&gt;');
    assert.equal(escapeHtml('a&b<c>d'), 'a&amp;b&lt;c&gt;d');
    // & must be escaped before < or > or the inserted &amp;lt; would double-escape
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  test('leaves underscores, asterisks, backticks, brackets, and parens untouched', () => {
    const raw = '_italic_ *bold* `code` [link](url) (parens)';
    assert.equal(escapeHtml(raw), raw); // none of these are special in HTML mode
  });
});

describe('alerting/telegram - formatStatusMessage', () => {
  const traceId = 'b'.repeat(32);

  test('reports an all-green run with grouped per-check status board', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'home.sections', status: 'passed' },
      { id: 'nav.hamburger', status: 'skipped' }
    ];

    const msg = formatStatusMessage({ checks, traceId });

    assert.ok(msg.includes('✅ <b>MPS Store Monitor — Manual Run Report</b>'));
    // Per-check status board replaces "All checks passing" summary
    assert.ok(msg.includes('<b>Storefront</b>'));
    assert.ok(msg.includes('✅ Store reachable'));
    assert.ok(msg.includes('<b>Navigation</b>'));
    assert.ok(msg.includes('⏭️ Mobile hamburger menu'));
    assert.ok(msg.includes(traceId));
    assertValidHtml(msg);
  });

  test('shows failure details with friendly names and check IDs', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'nav.key_links', status: 'failed', error: 'Test timeout of 30000ms exceeded.' }
    ];

    const msg = formatStatusMessage({ checks, traceId });

    assert.ok(msg.includes('🔴 <b>MPS Store Monitor — Manual Run Report</b>'));
    assert.ok(msg.includes('🔴 <b>FAILURE DETAILS</b>'));
    // Friendly name + check ID shown together for ops reference
    assert.ok(msg.includes('Giveaway / Gallery / Reviews links'));
    assert.ok(msg.includes('<code>nav.key_links</code>'));
    assert.ok(msg.includes('<i>Test timeout of 30000ms exceeded.</i>'));
    assertValidHtml(msg);
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

    assert.ok(msg.includes('⚠️'), 'flaky check shown with warning emoji');
    assert.ok(msg.includes('Countdown timer'), 'flaky check label present');
    assert.ok(msg.includes('https://github.com/org/repo/actions/runs/123'));
    assertValidHtml(msg);
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

    // Each category header appears in order (now as HTML bold tags)
    const storefront_idx = msg.indexOf('<b>Storefront</b>');
    const nav_idx       = msg.indexOf('<b>Navigation</b>');
    const cart_idx      = msg.indexOf('<b>Cart</b>');
    const checkout_idx  = msg.indexOf('<b>Checkout</b>');
    const stock_idx     = msg.indexOf('<b>Stock</b>');
    const giveaway_idx  = msg.indexOf('<b>Giveaway</b>');

    assert.ok(storefront_idx > 0, 'Storefront group present');
    assert.ok(nav_idx > storefront_idx, 'groups ordered: Navigation after Storefront');
    assert.ok(cart_idx > nav_idx, 'groups ordered: Cart after Navigation');
    assert.ok(checkout_idx > cart_idx, 'groups ordered: Checkout after Cart');
    assert.ok(stock_idx > checkout_idx, 'groups ordered: Stock after Checkout');
    assert.ok(giveaway_idx > stock_idx, 'groups ordered: Giveaway after Stock');
    assertValidHtml(msg);
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

    assert.ok(msg.includes('🔴 <b>NEW FAILURES</b>'));
    assert.ok(msg.includes('Homepage sections render'));
    assert.ok(msg.includes('<code>home.sections</code>'));
    assert.ok(msg.includes('<i>Missing trust badge</i>'));

    assert.ok(msg.includes('🔁 <b>STILL FAILING</b>'));
    assert.ok(msg.includes('Countdown timer'));
    assert.ok(msg.includes('<code>timer.correct</code>'));
    assert.ok(msg.includes('— 2.0h'));

    assert.ok(msg.includes('✅ <b>RECOVERED</b>'));
    assert.ok(msg.includes('Official rules page'));
    assert.ok(msg.includes('<code>nav.rules</code>'));
    assert.ok(msg.includes('— after 30m'));

    // Trace block uses HTML <code> and <a href>
    assert.ok(msg.includes('<code>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</code>'));
    assert.ok(msg.includes('href="https://github.com/org/repo/actions/runs/123"'));
    assertValidHtml(msg);
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
    assert.ok(msg.includes('🔴 <b>NEW FAILURES</b>'));
    assert.ok(msg.includes('Flash giveaway banners'));

    // Status board section (added when checks provided)
    assert.ok(msg.includes('📋 <b>Check Status</b>'));
    assert.ok(msg.includes('✅ Store reachable'));
    assert.ok(msg.includes('🔴 <b>Flash giveaway banners</b>'));
    assert.ok(msg.includes('✅ Countdown timer'));
    assertValidHtml(msg);
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

    assert.ok(msg.includes('🔴 <b>NEW FAILURES</b>'));
    assert.ok(!msg.includes('📋 <b>Check Status</b>'), 'status board not added when checks not provided');
    assertValidHtml(msg);
  });

  // Regression: a real production error string from tests/storefront/timer.spec.js:58
  // contained "flash_giveaway_end_date" (3 underscores). Under legacy Markdown the
  // whole message was rejected with HTTP 400 "can't parse entities: Can't find end of
  // the entity starting at byte offset 269" because backslash-escaping inside a `_..._`
  // italic entity is not supported by Telegram's legacy-Markdown parser — `\_` inside
  // an entity is a literal backslash plus a live delimiter, not an escape sequence.
  //
  // Under HTML parse mode this cannot happen: underscores are inert characters and
  // `<i>…</i>` is explicit + self-delimiting. The test verifies that the error string
  // appears LITERALLY (no backslash-mangling) and that the message is valid HTML.
  test('interpolates underscore-heavy error text without any mangling (was HTTP 400 in production)', () => {
    const events = [
      {
        type: 'opened',
        check: 'timer.correct',
        error: "Invalid flash_giveaway_end_date format from metaobject: 'October 8, 2026'"
      }
    ];

    const msg = formatRunMessage({ events, traceId });

    // Under HTML mode the underscores are plain text — no backslash escaping needed or present.
    assert.ok(
      msg.includes('flash_giveaway_end_date'),
      'underscores in the error identifier appear literally, without backslash escaping'
    );
    assert.ok(
      !msg.includes('flash\\_giveaway\\_end\\_date'),
      'no legacy-Markdown backslash escaping present'
    );
    assertValidHtml(msg);
  });

  test('unknown check id used as label fallback — underscores in the id are safe', () => {
    // No CHECK_LABELS entry → the raw id is reused as the label text.  Under
    // legacy Markdown this could unbalance the entity pairing; under HTML the
    // id's underscores are plain characters and escapeHtml leaves them alone.
    const events = [{ type: 'opened', check: 'custom.new_check', error: 'boom' }];
    const msg = formatRunMessage({ events, traceId });

    assert.ok(msg.includes('custom.new_check'), 'raw id appears in message');
    assertValidHtml(msg);
  });

  test('HTML special characters in error text are neutralised', () => {
    // Selectors (<div[data-id]>), comparisons (x > y, x < y), and & all need
    // escaping so Telegram does not misparse the tags.  They should not appear
    // raw in the output.
    const events = [
      {
        type: 'opened',
        check: 'store.reachable',
        error: 'Selector <div[data-id]> matched 3 nodes; expected x > 0 & y < 10'
      }
    ];
    const msg = formatRunMessage({ events, traceId });

    assert.ok(msg.includes('&lt;div[data-id]&gt;'), '< and > are escaped to &lt; &gt;');
    assert.ok(msg.includes('&amp;'), '& is escaped to &amp;');
    assert.ok(!msg.includes('<div'), 'raw < not present as a tag opener');
    assertValidHtml(msg);
  });

  test('status board shows inline error detail for failed checks', () => {
    const events = [{ type: 'opened', check: 'cart.add_pdp', error: 'page.goto: net::ERR_ABORTED' }];
    const checks = [
      { id: 'cart.add_pdp', status: 'failed', error: 'page.goto: net::ERR_ABORTED at https://example.com' },
      { id: 'store.reachable', status: 'passed' }
    ];

    const msg = formatRunMessage({ events, checks, traceId });

    // Failed check in the board gets bold label + code id + italic error snippet
    assert.ok(msg.includes('<b>Add to cart</b>'), 'failed check label is bold');
    assert.ok(msg.includes('<code>cart.add_pdp</code>'), 'failed check id in code span');
    assert.ok(msg.includes('↳'), 'error indented with arrow');
    assert.ok(msg.includes('page.goto'), 'error text appears in board');
    assertValidHtml(msg);
  });

  test('status board shows inline detail for flaky checks', () => {
    const checks = [
      { id: 'timer.correct', status: 'flaky', error: 'Timer did not decrease after 3s' }
    ];
    const events = [{ type: 'reminder', check: 'timer.correct', durationMs: 3600000 }];

    const msg = formatRunMessage({ events, checks, traceId });

    assert.ok(msg.includes('<b>Countdown timer</b>'), 'flaky check label is bold');
    assert.ok(msg.includes('<code>timer.correct</code>'), 'flaky check id in code span');
    assert.ok(msg.includes('Timer did not decrease'), 'error snippet present for flaky check');
    assertValidHtml(msg);
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

  test('successful message dispatch uses HTML parse mode', async () => {
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
    assert.equal(calledPayload.body.parse_mode, 'HTML');
  });

  test('honors 429 Retry-After on first attempt and succeeds on second', async () => {
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
      statusText: 'Unauthorized',
      json: async () => ({ error_code: 401, description: 'Unauthorized' })
    });

    await assert.rejects(
      () => sendTelegram({ token: 'bad-token', chatId: '123', text: 'hi' }),
      /Telegram API Error: 401 Unauthorized/
    );
  });
});
