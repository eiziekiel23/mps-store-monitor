const GIVEAWAY_TIME_ZONE = 'America/Chicago';
const HAS_EXPLICIT_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Calculate the UTC offset of a timezone at a given instant (in ms).
 * Accounts for DST transitions.
 */
function zoneOffsetMs(utcMs, timeZone) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(new Date(utcMs))
        .map((part) => [part.type, part.value])
    );
    const wallAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
  } catch {
    // Fallback: fixed UTC-5 (Eastern Standard Time)
    return -5 * 60 * 60 * 1000;
  }
}

/**
 * Parse the wall-clock fields of a naive date string as if they were UTC.
 * Handles both ISO (2026-10-07 23:59:00) and text (October 7, 2026 02:00:00).
 */
function wallClockAsUtc(value) {
  // ISO format: 2026-10-07 or 2026-10-07T23:59:00
  const match = WALL_CLOCK.exec(value);
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  }

  // Text format: "October 7, 2026 02:00:00". new Date parses as local time,
  // but we extract the wall-clock fields it parsed and re-express as UTC.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    parsed.getHours(),
    parsed.getMinutes(),
    parsed.getSeconds()
  );
}

/**
 * Parse a giveaway date field (which may be a timestamp, ISO, or text format)
 * into a UTC milliseconds epoch. Values with explicit offset/Z are taken as-is;
 * naive values are interpreted as wall-clock time in America/Chicago (DST-aware).
 */
export function parseGiveawayDate(value, timeZone = GIVEAWAY_TIME_ZONE) {
  if (!value) return null;

  const str = String(value).trim();

  // Pure numeric epoch string: 10 digits = seconds, 13 digits = milliseconds.
  // These are absolute instants with no timezone ambiguity.
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return str.length <= 10 ? n * 1000 : n;
  }

  // Explicit offset present: Z or ±HH:MM
  if (HAS_EXPLICIT_OFFSET.test(str)) {
    const ms = Date.parse(str);
    return Number.isNaN(ms) ? null : ms;
  }

  // Naive wall-clock time: interpret as the given timezone
  const wallAsUtc = wallClockAsUtc(value);
  if (wallAsUtc === null) return null;

  // Offset at the guessed UTC time, then re-check at the final result
  // (handles DST transitions on the boundary)
  const guess = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  return wallAsUtc - zoneOffsetMs(guess, timeZone);
}

/**
 * Fetches the active MPS giveaway metaobject, bonus coupons,
 * and product catalog using the Shopify Storefront API.
 */
export async function fetchSnapshot({ storeUrl, storefrontToken }) {
  if (!storefrontToken) {
    throw new Error('snapshot unavailable: missing token');
  }

  const query = `
    query GetSnapshot {
      giveaway: metaobjects(type: "giveaway", first: 5) {
        nodes {
          handle
          fields {
            key
            value
            reference {
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
        }
      }
      bonusCoupons: metaobjects(type: "bonus_coupons", first: 20) {
        nodes {
          fields {
            key
            value
          }
        }
      }
      products(first: 250) {
        nodes {
          handle
          title
          availableForSale
        }
      }
    }
  `;

  const resp = await fetch(`${storeUrl}/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': storefrontToken
    },
    body: JSON.stringify({ query })
  });

  if (resp.status === 401) throw new Error('snapshot unavailable: HTTP 401 (Invalid Token)');
  if (!resp.ok) throw new Error(`snapshot unavailable: HTTP ${resp.status}`);

  const { data, errors } = await resp.json();
  if (errors) throw new Error(`snapshot error: ${errors[0].message}`);

  // Flatten active giveaway
  const giveawayNodes = data.giveaway.nodes || [];

  // Find the active giveaway based on the end date.
  // The metaobject has no separate start_date field; the "active" giveaway is the
  // one currently counting down (soonest future end date), or the first node as fallback.
  const nowMs = Date.now();
  let activeNode = giveawayNodes[0]; // Default to first if dates missing/bad
  let soonestEndMs = Infinity;

  for (const n of giveawayNodes) {
    const f = Object.fromEntries(n.fields.map(field => [field.key, field.value]));
    if (f.flash_giveaway_end_date) {
      // Dates may be a seconds timestamp, an ISO string, or store wall-clock text
      // ("October 7, 2026 02:00:00"); the theme reads them as America/Chicago,
      // so parseGiveawayDate does the same.
      const endMs = parseGiveawayDate(f.flash_giveaway_end_date);
      // Pick the node with the soonest future end date (the one currently active).
      if (endMs != null && endMs > nowMs && endMs < soonestEndMs) {
        activeNode = n;
        soonestEndMs = endMs;
      }
    }
  }

  const giveaway = {};
  if (activeNode) {
    activeNode.fields.forEach(f => {
      // Keep direct value, and fallback to reference image URL if this is a file reference
      giveaway[f.key] = f.reference?.image?.url || f.value;
    });
  }

  const bonusCoupons = (data.bonusCoupons.nodes || []).map(n => {
    const fields = Object.fromEntries(n.fields.map(f => [f.key, f.value]));
    return { code: fields.coupon_code, amount: Number(fields.amount || 0) };
  });

  const products = (data.products.nodes || []).map(p => ({
    handle: p.handle,
    title: p.title,
    available: p.availableForSale
  }));

  return { giveaway, bonusCoupons, products };
}
