/**
 * Formats a list of AlertEvents into a single Telegram Markdown message.
 */
export function formatRunMessage({ events = [], traceId, runUrl, artifactUrl }) {
  if (!events.length) return null;

  const opened = events.filter(e => e.type === 'opened');
  const reminder = events.filter(e => e.type === 'reminder');
  const recovered = events.filter(e => e.type === 'recovered');

  const lines = ['*MPS Store Monitor Alert*'];

  if (opened.length) {
    lines.push('\n🔴 *NEW FAILURES*');
    for (const e of opened) {
      lines.push(`• \`${e.check}\`\n  _${e.error || 'Unknown error'}_`);
    }
  }

  if (reminder.length) {
    lines.push('\n🔁 *STILL FAILING*');
    for (const e of reminder) {
      const hours = (e.durationMs / 3600000).toFixed(1);
      lines.push(`• \`${e.check}\` (${hours}h)`);
    }
  }

  if (recovered.length) {
    lines.push('\n✅ *RECOVERED*');
    for (const e of recovered) {
      const mins = Math.round(e.durationMs / 60000);
      lines.push(`• \`${e.check}\` (after ${mins}m)`);
    }
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
 * Formats a full test status report for manual runs, showing all check results.
 * Used for workflow_dispatch (manual) runs to give visibility into the full state.
 */
export function formatStatusMessage({ checks = [], traceId, runUrl }) {
  const passed = checks.filter(c => c.status === 'passed').length;
  const flaky = checks.filter(c => c.status === 'flaky').length;
  const failed = checks.filter(c => c.status === 'failed');
  const skipped = checks.filter(c => c.status === 'skipped').length;

  const total = checks.length;
  const statusEmoji = failed.length > 0 ? '🔴' : '✅';

  const lines = [`${statusEmoji} *MPS Store Monitor — Manual Run Report*`];
  lines.push(`\n${passed} passed${flaky ? `, ${flaky} flaky` : ''}, ${failed.length} failed, ${skipped} skipped / ${total} total`);

  if (failed.length > 0) {
    lines.push('\n🔴 *FAILURES*');
    failed.forEach(c => {
      lines.push(`• \`${c.id}\`\n  _${c.error || 'Unknown error'}_`);
      if (c.platformNote) {
        lines.push(`  _(${c.platformNote})_`);
      }
    });
  } else {
    lines.push('\n✅ All checks passing');
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

    // Unrecoverable or second failure
    throw new Error(`Telegram API Error: ${res.status} ${res.statusText}`);
  }
}
