import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatRunMessage, formatStatusMessage, sendTelegram } from '../../src/alerting/telegram.js';

describe('alerting/telegram - formatStatusMessage', () => {
  const traceId = 'b'.repeat(32);

  test('reports an all-green run with a success header', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'home.sections', status: 'passed' },
      { id: 'nav.hamburger', status: 'skipped' }
    ];

    const msg = formatStatusMessage({ checks, traceId });

    assert.ok(msg.includes('✅ *MPS Store Monitor — Manual Run Report*'));
    assert.ok(msg.includes('2 passed, 0 failed, 1 skipped / 3 total'));
    assert.ok(msg.includes('✅ All checks passing'));
    assert.ok(msg.includes(traceId));
  });

  test('lists each failing check with its error and uses the failure header', () => {
    const checks = [
      { id: 'store.reachable', status: 'passed' },
      { id: 'nav.key_links', status: 'failed', error: 'Test timeout of 30000ms exceeded.' }
    ];

    const msg = formatStatusMessage({ checks, traceId });

    assert.ok(msg.includes('🔴 *MPS Store Monitor — Manual Run Report*'));
    assert.ok(msg.includes('1 passed, 1 failed'));
    assert.ok(msg.includes('🔴 *FAILURES*'));
    assert.ok(msg.includes('• `nav.key_links`'));
    assert.ok(msg.includes('_Test timeout of 30000ms exceeded._'));
    assert.ok(!msg.includes('All checks passing'));
  });

  test('counts flaky checks separately and links the run URL when provided', () => {
    const checks = [
      { id: 'a', status: 'passed' },
      { id: 'b', status: 'flaky' }
    ];

    const msg = formatStatusMessage({
      checks,
      traceId,
      runUrl: 'https://github.com/org/repo/actions/runs/123'
    });

    assert.ok(msg.includes('1 flaky'));
    assert.ok(msg.includes('(https://github.com/org/repo/actions/runs/123)'));
  });
});

describe('alerting/telegram - formatRunMessage', () => {
  const traceId = 'a'.repeat(32);

  test('returns null for empty events array', () => {
    assert.equal(formatRunMessage({ events: [], traceId }), null);
  });

  test('formats opened, reminder, and recovered sections', () => {
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
    assert.ok(msg.includes('• `home.sections`'));
    assert.ok(msg.includes('_Missing trust badge_'));

    assert.ok(msg.includes('🔁 *STILL FAILING*'));
    assert.ok(msg.includes('• `timer.correct` (2.0h)'));

    assert.ok(msg.includes('✅ *RECOVERED*'));
    assert.ok(msg.includes('• `nav.rules` (after 30m)'));

    assert.ok(msg.includes('[Trace ID: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`](https://github.com/org/repo/actions/runs/123)'));
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
