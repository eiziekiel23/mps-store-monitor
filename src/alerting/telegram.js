import { CHECK_LABELS, CHECK_GROUPS, STATUS_EMOJI } from './labels.js';

/**
 * Telegram message formatting — HTML parse mode.
 *
 * WHY HTML AND NOT MARKDOWN
 * -------------------------
 * This module used `parse_mode: 'Markdown'` (Telegram's *legacy* Markdown) and
 * repeatedly got the entire message rejected with
 *
 *   HTTP 400 — can't parse entities: Can't find end of the entity starting at
 *   byte offset N
 *
 * Legacy Markdown marks up text with *paired delimiters* (`_italic_`, `*bold*`,
 * `` `code` ``). Any arbitrary text interpolated into the message — a Playwright
 * error, a Shopify field name, a product handle — can contain those same
 * characters, which unbalances the pairing and kills the whole message.
 *
 * Backslash-escaping cannot fix this: legacy Markdown only honours `\_` / `\*`
 * **outside** an entity. Escaping *inside* an entity is not supported, and our
 * error text is by definition inside one (`_<error>_`). A `\_` written there is
 * a literal backslash followed by a live delimiter, so it *closes the entity
 * early* and shifts every later delimiter pair by one — which is exactly how a
 * dangling entity appeared at byte offset 269 in production even though the
 * text had "been escaped".
 *
 * HTML parse mode removes the failure class entirely:
 *   - markup is explicit and self-delimiting (`<i>…</i>`), never positional;
 *   - only three characters are special in text (`&`, `<`, `>`), and escaping
 *     them works *everywhere*, including inside an entity;
 *   - `_`, `*`, `` ` ``, `[`, `]`, `(`, `)` in arbitrary text are plain
 *     characters that need no handling at all.
 *
 * INVARIANT: every tag this module emits opens and closes on the same physical
 * line. `clampMessage()` relies on that to truncate safely.
 */

/** Telegram rejects messages longer than this. */
const TELEGRAM_MAX_CHARS = 4096;

/** Per-check error text shown in the status board is kept short so the board scans. */
const BOARD_ERROR_MAX = 90;

/** Error text in the headline failure list can be longer — it is the main payload. */
const EVENT_ERROR_MAX = 300;

/**
 * Neutralise the only three characters Telegram's HTML parser treats as markup.
 * Unlike the legacy-Markdown escaping this replaced, it is valid in every
 * position — inside `<i>`/`<b>`/`<code>` spans included.
 *
 * `&` MUST be replaced first, or the `&` of a just-inserted `&lt;` would itself
 * be re-escaped into `&amp;lt;`.
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape a value destined for a double-quoted HTML attribute (e.g. href). */
function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/** Collapse an error to a single short line for compact display. */
function snippet(text, max = BOARD_ERROR_MAX) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Keep the message inside Telegram's hard limit.
 * Safe because every tag we emit is closed on the same line, so cutting on a
 * newline boundary can never split a tag and produce unparseable HTML.
 */
function clampMessage(text) {
  if (text.length <= TELEGRAM_MAX_CHARS) return text;
  const budget = TELEGRAM_MAX_CHARS - 32;
  const cut = text.lastIndexOf('\n', budget);
  return `${text.slice(0, cut > 0 ? cut : budget)}\n<i>… report truncated</i>`;
}

/**
 * Count checks by status.
 * @returns {{passed:number, flaky:number, failed:number, skipped:number, total:number}}
 */
export function tally(checks = []) {
  const n = (s) => checks.filter((c) => c.status === s).length;
  return {
    passed: n('passed'),
    flaky: n('flaky'),
    failed: n('failed'),
    skipped: n('skipped'),
    total: checks.length
  };
}

/** One-line roll-up of a tally, e.g. "✅ 16  ⚠️ 1  🔴 2  ⏭️ 1  / 20 checks". */
function tallyLine(checks) {
  const t = tally(checks);
  const parts = [`${STATUS_EMOJI.passed} ${t.passed}`];
  if (t.flaky) parts.push(`${STATUS_EMOJI.flaky} ${t.flaky}`);
  parts.push(`${STATUS_EMOJI.failed} ${t.failed}`);
  if (t.skipped) parts.push(`${STATUS_EMOJI.skipped} ${t.skipped}`);
  return `${parts.join('  ')}  / ${t.total} checks`;
}

/**
 * Render one check as one or more status-board lines.
 *
 * Passing/skipped checks stay on a single compact line. Failing and flaky ones
 * are broken down further — they additionally carry the raw check id (so an
 * operator can grep the spec without consulting labels.js), the error text, and
 * the cross-project divergence note when the Playwright projects disagree.
 */
function statusRows(check) {
  const emoji = STATUS_EMOJI[check.status] ?? '❓';
  const label = escapeHtml(CHECK_LABELS[check.id] ?? check.id);
  const needsDetail = check.status === 'failed' || check.status === 'flaky';

  if (!needsDetail) return [`${emoji} ${label}`];

  const rows = [`${emoji} <b>${label}</b> — <code>${escapeHtml(check.id)}</code>`];

  const err = snippet(check.error);
  if (err) rows.push(`    ↳ <i>${escapeHtml(err)}</i>`);
  if (check.platformNote) rows.push(`    ↳ <i>${escapeHtml(check.platformNote)}</i>`);

  return rows;
}

/**
 * Build the grouped per-check status board.
 *
 * Every check appears under its category header with a per-group "n/m ok"
 * count, so the board doubles as the operator's QA checklist. Checks missing
 * from CHECK_GROUPS fall into a trailing "Other" group rather than vanishing.
 *
 * @param {Array<{id:string, status:string, error?:string, platformNote?:string}>} checks
 * @returns {string} HTML block (starts with a blank line)
 */
function buildStatusBoard(checks) {
  if (!checks.length) return '';

  const byId = new Map(checks.map((c) => [c.id, c]));
  const allGroupIds = new Set(CHECK_GROUPS.flatMap((g) => g.ids));
  const lines = [];

  const renderGroup = (label, present) => {
    const ok = present.filter((c) => c.status === 'passed').length;
    lines.push(`\n<b>${escapeHtml(label)}</b>  <i>(${ok}/${present.length} ok)</i>`);
    for (const c of present) lines.push(...statusRows(c));
  };

  for (const group of CHECK_GROUPS) {
    const present = group.ids.map((id) => byId.get(id)).filter(Boolean);
    if (present.length) renderGroup(group.label, present);
  }

  const ungrouped = checks.filter((c) => !allGroupIds.has(c.id));
  if (ungrouped.length) renderGroup('Other', ungrouped);

  return lines.join('\n');
}

/** Trailing trace/run-link block, shared by both message formats. */
function traceBlock(traceId, link) {
  const lines = [`\n🔎 Trace <code>${escapeHtml(traceId)}</code>`];
  if (link) lines.push(`<a href="${escapeAttr(link)}">View CI run →</a>`);
  return lines.join('\n');
}

/**
 * Formats state-transition events into a Telegram HTML alert.
 *
 * Pass the full aggregated check list (`checks`) from report.js to append the
 * per-check status board, so operators see the whole picture next to the event.
 */
export function formatRunMessage({ events = [], traceId, runUrl, artifactUrl, checks = [] }) {
  if (!events.length) return null;

  const opened = events.filter((e) => e.type === 'opened');
  const reminder = events.filter((e) => e.type === 'reminder');
  const recovered = events.filter((e) => e.type === 'recovered');

  const lines = ['<b>MPS Store Monitor Alert</b>'];

  if (checks.length) lines.push(`\n${tallyLine(checks)}`);

  if (opened.length) {
    lines.push('\n🔴 <b>NEW FAILURES</b>');
    for (const e of opened) {
      const label = escapeHtml(CHECK_LABELS[e.check] ?? e.check);
      const err = escapeHtml(snippet(e.error || 'Unknown error', EVENT_ERROR_MAX));
      lines.push(`• ${label} (<code>${escapeHtml(e.check)}</code>)\n  <i>${err}</i>`);
    }
  }

  if (reminder.length) {
    lines.push('\n🔁 <b>STILL FAILING</b>');
    for (const e of reminder) {
      const label = escapeHtml(CHECK_LABELS[e.check] ?? e.check);
      const hours = (e.durationMs / 3600000).toFixed(1);
      lines.push(`• ${label} (<code>${escapeHtml(e.check)}</code>) — ${hours}h`);
    }
  }

  if (recovered.length) {
    lines.push('\n✅ <b>RECOVERED</b>');
    for (const e of recovered) {
      const label = escapeHtml(CHECK_LABELS[e.check] ?? e.check);
      const mins = Math.round(e.durationMs / 60000);
      lines.push(`• ${label} (<code>${escapeHtml(e.check)}</code>) — after ${mins}m`);
    }
  }

  if (checks.length) {
    lines.push('\n📋 <b>Check Status</b>');
    lines.push(buildStatusBoard(checks));
  }

  lines.push(traceBlock(traceId, artifactUrl || runUrl));

  return clampMessage(lines.join('\n'));
}

/**
 * Formats a full test status report for manual (workflow_dispatch) runs.
 * Shows every check grouped by category so operators can scan the full
 * picture in one glance — no hunting through raw passed/failed counts.
 */
export function formatStatusMessage({ checks = [], traceId, runUrl }) {
  const t = tally(checks);
  const failed = checks.filter((c) => c.status === 'failed');

  const statusEmoji = failed.length > 0 ? '🔴' : '✅';
  const lines = [`${statusEmoji} <b>MPS Store Monitor — Manual Run Report</b>`];

  lines.push(`\n${tallyLine(checks)}`);

  // Per-check status board (always shown — this is the "checklist")
  lines.push(buildStatusBoard(checks));

  // Full-length failure detail block — only when something broke. The board
  // above carries a short snippet; this section keeps the untruncated text.
  if (failed.length > 0) {
    lines.push('\n🔴 <b>FAILURE DETAILS</b>');
    for (const c of failed) {
      const label = escapeHtml(CHECK_LABELS[c.id] ?? c.id);
      const err = escapeHtml(snippet(c.error || 'Unknown error', EVENT_ERROR_MAX));
      lines.push(`• ${label} (<code>${escapeHtml(c.id)}</code>)\n  <i>${err}</i>`);
      if (c.platformNote) {
        lines.push(`  <i>(${escapeHtml(c.platformNote)})</i>`);
      }
    }
  }

  lines.push(traceBlock(traceId, runUrl));

  return clampMessage(lines.join('\n'));
}

/**
 * Sends an HTML-formatted message to a Telegram chat, handling 429
 * rate limits according to the Retry-After header/body.
 */
export async function sendTelegram({ token, chatId, text, dryRun = false }) {
  if (dryRun) {
    console.log(`[DRY-RUN] Telegram Message to ${chatId}:\n${text}\n---------------------------`);
    return;
  }

  if (!token || !chatId) {
    throw new Error('Telegram token and chatId are required');
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  let attempt = 1;
  while (attempt <= 2) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    if (res.ok) return;

    if (res.status === 429 && attempt === 1) {
      const data = await res.json().catch(() => ({}));
      // Telegram provides retry_after in seconds in the parameters block
      const retryAfterSec = data.parameters?.retry_after || 5;

      console.warn(`[Telegram] 429 Rate limited. Retrying after ${retryAfterSec}s...`);
      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));

      attempt++;
      continue;
    }

    // Unrecoverable or second failure — include the full response body so the
    // CI log shows Telegram's description (e.g. "chat not found", "can't parse entities").
    // Guard the json() call: a malformed response must never mask the real HTTP error.
    let desc = '';
    try {
      const errBody = await res.json();
      if (errBody?.description) desc = ` — ${errBody.description}`;
    } catch { /* body unavailable or not JSON — fall back to status text */ }
    throw new Error(`Telegram API Error: ${res.status} ${res.statusText}${desc}`);
  }
}
