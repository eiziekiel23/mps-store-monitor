import { CHECK_LABELS, CHECK_GROUPS, STATUS_EMOJI } from './labels.js';

/**
 * Escapes Telegram legacy-Markdown entity delimiters (`_ * \` [`) in a piece of
 * dynamic/arbitrary text so it renders as literal characters instead of trying
 * to open/close a Markdown entity.
 *
 * Use this ONLY on interpolated values (error strings, field values, raw check
 * ids used as a label fallback) — never on the literal `*…*`/`_…_`/`` `…` ``
 * wrapper characters we write ourselves, or the intended formatting disappears.
 *
 * Why this matters: Telegram's Bot API rejects the whole message with HTTP 400
 * ("can't parse entities: Can't find end of the entity...") if any `_`/`*` in
 * the text is unbalanced. A real example that triggered this in production:
 * an error string containing the Shopify field name `flash_giveaway_end_date`
 * (3 underscores) wrapped bare in an `_..._` italic span — 3 + the span's own
 * 2 wrapper underscores = 5, an odd/unbalanced count.
 */
export function escapeMd(text) {
  return String(text).replace(/([_*`[\]])/g, '\\$1');
}

/**
 * Build a grouped per-check status board for Telegram (Markdown mode).
 *
 * Checks are rendered under their category header (Storefront, Navigation, …).
 * Checks that have no entry in CHECK_GROUPS fall into an "Other" group at the
 * end so newly-added checks always appear rather than being silently dropped.
 *
 * @param {Array<{id:string, status:string}>} checks - aggregated check results
 * @returns {string} Markdown block (starts with a blank line)
 */
function buildStatusBoard(checks) {
  if (!checks.length) return '';

  const byId = new Map(checks.map(c => [c.id, c]));
  const allGroupIds = new Set(CHECK_GROUPS.flatMap(g => g.ids));
  const lines = [];

  for (const group of CHECK_GROUPS) {
    const present = group.ids.map(id => byId.get(id)).filter(Boolean);
    if (!present.length) continue;

    lines.push(`\n*${group.label}*`);
    for (const c of present) {
      const emoji = STATUS_EMOJI[c.status] ?? '❓';
      // escapeMd guards the fallback (`?? c.id`) — a raw check id like
      // "cart.add_pdp" would otherwise sit unescaped outside any code span.
      const label = escapeMd(CHECK_LABELS[c.id] ?? c.id);
      lines.push(`${emoji} ${label}`);
    }
  }

  // Ungrouped checks (unknown ids) — append so nothing is silently dropped
  const ungrouped = checks.filter(c => !allGroupIds.has(c.id));
  if (ungrouped.length) {
    lines.push('\n*Other*');
    for (const c of ungrouped) {
      const emoji = STATUS_EMOJI[c.status] ?? '❓';
      lines.push(`${emoji} ${escapeMd(CHECK_LABELS[c.id] ?? c.id)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats state-transition events into a Telegram Markdown alert.
 *
 * Optionally accepts the full aggregated check list (`checks`) to append a
 * per-check status board at the end — pass it from report.js so operators see
 * the full picture alongside the failure/recovery event.
 */
export function formatRunMessage({ events = [], traceId, runUrl, artifactUrl, checks = [] }) {
  if (!events.length) return null;

  const opened    = events.filter(e => e.type === 'opened');
  const reminder  = events.filter(e => e.type === 'reminder');
  const recovered = events.filter(e => e.type === 'recovered');

  const lines = ['*MPS Store Monitor Alert*'];

  if (opened.length) {
    lines.push('\n🔴 *NEW FAILURES*');
    for (const e of opened) {
      const label = escapeMd(CHECK_LABELS[e.check] ?? e.check);
      // escapeMd the error text so bare underscores (like in "flash_giveaway_end_date")
      // don't break the `_..._` italic span. This was the root cause of GitHub Actions
      // failures with HTTP 400 "can't parse entities".
      lines.push(`• ${label} (\`${e.check}\`)\n  _${escapeMd(e.error || 'Unknown error')}_`);
    }
  }

  if (reminder.length) {
    lines.push('\n🔁 *STILL FAILING*');
    for (const e of reminder) {
      const label = escapeMd(CHECK_LABELS[e.check] ?? e.check);
      const hours = (e.durationMs / 3600000).toFixed(1);
      lines.push(`• ${label} (\`${e.check}\`) — ${hours}h`);
    }
  }

  if (recovered.length) {
    lines.push('\n✅ *RECOVERED*');
    for (const e of recovered) {
      const label = escapeMd(CHECK_LABELS[e.check] ?? e.check);
      const mins = Math.round(e.durationMs / 60000);
      lines.push(`• ${label} (\`${e.check}\`) — after ${mins}m`);
    }
  }

  // Per-check status board (only when caller passes the full check list)
  if (checks.length > 0) {
    lines.push('\n📋 *Check Status*');
    lines.push(buildStatusBoard(checks));
  }

  const link = artifactUrl || runUrl;
  if (link) {
    lines.push(`\n🔎 [Trace ID: \`${traceId}\`](${link})`);
  } else {
    lines.push(`\n🔎 Trace ID: \`${traceId}\``);
  }

  return lines.join('\n');
}

/**
 * Formats a full test status report for manual (workflow_dispatch) runs.
 * Shows every check grouped by category so operators can scan the full
 * picture in one glance — no hunting through raw passed/failed counts.
 */
export function formatStatusMessage({ checks = [], traceId, runUrl }) {
  const passed  = checks.filter(c => c.status === 'passed').length;
  const flaky   = checks.filter(c => c.status === 'flaky').length;
  const failed  = checks.filter(c => c.status === 'failed');
  const skipped = checks.filter(c => c.status === 'skipped').length;
  const total   = checks.length;

  const statusEmoji = failed.length > 0 ? '🔴' : '✅';
  const lines = [`${statusEmoji} *MPS Store Monitor — Manual Run Report*`];

  // Summary line
  lines.push(`\n${passed} passed${flaky ? `, ${flaky} flaky` : ''}, ${failed.length} failed, ${skipped} skipped / ${total} total`);

  // Per-check status board (always shown — this is the "checklist")
  lines.push(buildStatusBoard(checks));

  // Failure detail block — only when something broke
  if (failed.length > 0) {
    lines.push('\n🔴 *FAILURE DETAILS*');
    for (const c of failed) {
      const label = escapeMd(CHECK_LABELS[c.id] ?? c.id);
      lines.push(`• ${label} (\`${c.id}\`)\n  _${escapeMd(c.error || 'Unknown error')}_`);
      if (c.platformNote) {
        lines.push(`  _(${escapeMd(c.platformNote)})_`);
      }
    }
  }

  if (runUrl) {
    lines.push(`\n🔎 [Trace ID: \`${traceId}\`](${runUrl})`);
  } else {
    lines.push(`\n🔎 Trace ID: \`${traceId}\``);
  }

  return lines.join('\n');
}

/**
 * Sends a Markdown-formatted message to a Telegram chat, handling 429
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
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });

    if (res.ok) return;

    if (res.status === 429 && attempt === 1) {
      const data = await res.json().catch(() => ({}));
      // Telegram provides retry_after in seconds in the parameters block
      const retryAfterSec = data.parameters?.retry_after || 5;

      console.warn(`[Telegram] 429 Rate limited. Retrying after ${retryAfterSec}s...`);
      await new Promise(r => setTimeout(r, retryAfterSec * 1000));

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
