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
    throw new Error('Admin API: HTTP 401 — invalid token or insufficient scopes for this operation');
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

// ── Metaobjects ───────────────────────────────────────────────────────────────
//
// Used by the daily giveaway swap (src/giveaway/swap.js), which promotes the
// operator-staged "upcoming_flash_giveaway" values into the live "giveaway"
// entry at 02:00 America/Chicago. The Storefront API is read-only, so every
// metaobject mutation has to go through the Admin API.
//
// Metaobjects are addressed by a composite {type, handle} key rather than a
// GID, so the swap never hard-codes a numeric metaobject ID (those differ
// between stores). Requires write_metaobjects on the token.

const METAOBJECT_BY_HANDLE_QUERY = `
  query($handle: MetaobjectHandleInput!) {
    metaobjectByHandle(handle: $handle) {
      id
      handle
      type
      fields { key value }
    }
  }
`;

const METAOBJECT_UPDATE_MUTATION = `
  mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        id
        handle
        fields { key value }
      }
      userErrors { field message code }
    }
  }
`;

/**
 * Read a single metaobject entry by its type + handle.
 *
 * Every field `value` comes back as a string regardless of the field's declared
 * type: plain text for single_line_text_field, a file GID for file_reference,
 * and a JSON-array string for any list.* type. The swap relies on this — it can
 * copy `value` verbatim between entries with no per-type serialization.
 *
 * Fields that have never been set are simply absent from the `fields` array
 * (not present with a null value), so `fieldMap` only ever contains keys the
 * operator has actually populated.
 *
 * @param {{
 *   shop: string,
 *   token: string,
 *   type: string,     metaobject definition type, e.g. "giveaway"
 *   handle: string,   entry handle, e.g. "mps-giveaway"
 *   version?: string,
 *   fetcher?: typeof fetch
 * }} opts
 * @returns {Promise<null | {
 *   id: string,
 *   handle: string,
 *   type: string,
 *   fields: Array<{ key: string, value: string | null }>,
 *   fieldMap: Record<string, string | null>
 * }>} null when no entry exists for that type+handle
 */
export async function fetchMetaobjectByHandle({
  shop,
  token,
  type,
  handle,
  version = '2026-10',
  fetcher = fetch
}) {
  if (!token) throw new Error('Admin API: token is required');
  if (!type || !handle) throw new Error('Admin API: metaobject type and handle are required');

  const endpoint = `https://${shop}/admin/api/${version}/graphql.json`;
  const data = await adminGql(
    endpoint,
    token,
    METAOBJECT_BY_HANDLE_QUERY,
    { handle: { type, handle } },
    fetcher
  );

  const node = data.metaobjectByHandle;
  if (!node) return null;

  const fields = (node.fields ?? []).map((f) => ({ key: f.key, value: f.value ?? null }));
  return {
    id: node.id,
    handle: node.handle,
    type: node.type,
    fields,
    fieldMap: Object.fromEntries(fields.map((f) => [f.key, f.value]))
  };
}

/**
 * Write field values onto an existing metaobject entry.
 *
 * Only the keys passed in are touched; every other field on the entry is left
 * exactly as it was. That is what makes the swap safe to run against the live
 * giveaway entry, which carries 27 fields of which only the 7 daily ones rotate
 * — the monthly fields are never named here and so never change.
 *
 * To CLEAR a field, pass `value: null`. Shopify rejects an empty string for
 * reference and list types, so null is the only portable "unset" across the
 * mixed field types the swap handles.
 *
 * `userErrors` are raised as exceptions: a metaobjectUpdate can return HTTP 200
 * with a populated userErrors array (e.g. an invalid file GID), which would
 * otherwise read as a silent success.
 *
 * @param {{
 *   shop: string,
 *   token: string,
 *   id: string,        metaobject GID
 *   fields: Array<{ key: string, value: string | null }>,
 *   version?: string,
 *   fetcher?: typeof fetch
 * }} opts
 * @returns {Promise<{ id: string, handle: string, fieldMap: Record<string, string | null> }>}
 */
export async function updateMetaobjectFields({
  shop,
  token,
  id,
  fields,
  version = '2026-10',
  fetcher = fetch
}) {
  if (!token) throw new Error('Admin API: token is required');
  if (!id) throw new Error('Admin API: metaobject id is required');
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Admin API: at least one field is required to update a metaobject');
  }

  const endpoint = `https://${shop}/admin/api/${version}/graphql.json`;
  const data = await adminGql(
    endpoint,
    token,
    METAOBJECT_UPDATE_MUTATION,
    { id, metaobject: { fields } },
    fetcher
  );

  const result = data.metaobjectUpdate;
  if (result?.userErrors?.length) {
    const summary = result.userErrors
      .map((e) => `${(e.field ?? []).join('.') || '(no field)'}: ${e.message}`)
      .join('; ');
    throw new Error(`Admin API: metaobjectUpdate failed — ${summary}`);
  }

  const node = result.metaobject;
  const updated = (node.fields ?? []).map((f) => ({ key: f.key, value: f.value ?? null }));
  return {
    id: node.id,
    handle: node.handle,
    fieldMap: Object.fromEntries(updated.map((f) => [f.key, f.value]))
  };
}
