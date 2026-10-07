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

  // Find the active giveaway based on dates (using system time for now)
  const now = Math.floor(Date.now() / 1000);
  let activeNode = giveawayNodes[0]; // Default to first if dates missing/bad

  for (const n of giveawayNodes) {
    const f = Object.fromEntries(n.fields.map(field => [field.key, field.value]));
    // Check flash giveaway range
    if (f.flash_giveaway_start_date && f.flash_giveaway_end_date) {
      // Date in metaobject might be a timestamp string or an ISO string.
      // Theme handles it via standard `date: '%s'` format.
      // If the field is already an absolute seconds timestamp string:
      const start = Number(f.flash_giveaway_start_date);
      const end = Number(f.flash_giveaway_end_date);
      if (now > start && now < end) {
        activeNode = n;
        break;
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
