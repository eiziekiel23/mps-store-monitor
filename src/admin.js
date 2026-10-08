/**
 * Shopify Admin API client.
 *
 * Used by the monitoring suite for data the Storefront API does not expose:
 *   - Real inventoryQuantity and inventoryPolicy per variant
 *   - The exact set of products published to the Online Store channel
 *     (status:ACTIVE + onlineStoreUrl non-null)
 *
 * SECURITY: the token is accepted as a parameter and never logged.
 * Only its presence and length are checked; the value is never echoed.
 */

const PRODUCTS_QUERY = `
  query($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        title
        onlineStoreUrl
        tracksInventory
        totalInventory
        variants(first: 100) {
          nodes {
            title
            sku
            inventoryQuantity
            inventoryPolicy
            availableForSale
          }
        }
      }
    }
  }
`;

/**
 * Execute a single Admin API GraphQL request.
 *
 * @param {string} endpoint  Full URL to the Admin GraphQL endpoint
 * @param {string} token     Admin API access token
 * @param {string} query     GraphQL query string
 * @param {object} variables Query variables
 * @param {typeof fetch} fetcher  Injectable fetch (real or mock)
 */
async function adminGql(endpoint, token, query, variables, fetcher) {
  const resp = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });

  if (resp.status === 401) {
    throw new Error('Admin API: HTTP 401 — invalid token or missing read_products scope');
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Admin API: HTTP ${resp.status}\n${body.slice(0, 300)}`);
  }

  const { data, errors } = await resp.json();
  if (errors?.length) {
    throw new Error(`Admin API GraphQL error: ${errors[0].message}`);
  }
  return data;
}

/**
 * Fetch every product displayed on the online store via the Admin API.
 *
 * "Displayed on the online store" means:
 *   - product.status === ACTIVE  (filtered server-side via query:"status:active")
 *   - product.onlineStoreUrl is non-null  (published to the Online Store channel)
 *
 * Unpublished products (subscriptions, reships, winner-fulfillment SKUs, etc.)
 * are active but have a null onlineStoreUrl and are excluded from the result.
 *
 * @param {{
 *   shop: string,       Myshopify domain, e.g. "mysterypokeslabs.myshopify.com"
 *   token: string,      Admin API access token (shpat_…)
 *   version?: string,   API version, defaults to "2026-10"
 *   fetcher?: typeof fetch
 * }} opts
 * @returns {Promise<{
 *   displayed: Array<{
 *     handle: string,
 *     title: string,
 *     onlineStoreUrl: string,
 *     tracksInventory: boolean,
 *     totalInventory: number,
 *     variants: Array<{
 *       title: string,
 *       sku: string,
 *       inventoryQuantity: number,
 *       inventoryPolicy: 'DENY' | 'CONTINUE',
 *       availableForSale: boolean
 *     }>
 *   }>,
 *   activeCount: number,
 *   pages: number
 * }>}
 */
export async function fetchDisplayedInventory({
  shop,
  token,
  version = '2026-10',
  fetcher = fetch
}) {
  if (!token) throw new Error('Admin API: token is required');

  const endpoint = `https://${shop}/admin/api/${version}/graphql.json`;
  const allActive = [];
  let cursor = null;
  let pages = 0;

  do {
    const data = await adminGql(endpoint, token, PRODUCTS_QUERY, { cursor }, fetcher);
    const nodes = data.products.nodes.map((p) => ({
      handle: p.handle,
      title: p.title,
      onlineStoreUrl: p.onlineStoreUrl ?? null,
      tracksInventory: Boolean(p.tracksInventory),
      totalInventory: p.totalInventory ?? 0,
      variants: p.variants.nodes.map((v) => ({
        title: v.title,
        sku: v.sku ?? '',
        inventoryQuantity: v.inventoryQuantity ?? 0,
        inventoryPolicy: v.inventoryPolicy,
        availableForSale: Boolean(v.availableForSale)
      }))
    }));
    allActive.push(...nodes);
    cursor = data.products.pageInfo.hasNextPage
      ? data.products.pageInfo.endCursor
      : null;
    pages += 1;
  } while (cursor && pages < 20);

  return {
    displayed: allActive.filter((p) => p.onlineStoreUrl !== null),
    activeCount: allActive.length,
    pages
  };
}
