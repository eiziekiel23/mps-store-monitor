#!/usr/bin/env node
/**
 * Refresh the knownSoldOut allowlist by querying the Admin API for real out-of-stock DENY products.
 *
 * Run this when a product in the allowlist restocks (to remove it) or to detect newly sold-out products.
 *
 * Usage:
 *   node scripts/update-allowlist.js
 *
 * Requires: SHOPIFY_ADMIN_API_TOKEN in .env or environment
 */

import { fetchDisplayedInventory } from '../src/admin.js';
import config from '../config/monitor.config.js';

// Load .env for local runs (silent no-op when absent, e.g. in CI). Requires Node ≥ 20.6.
try { process.loadEnvFile('.env'); } catch { /* file absent — ignore */ }

const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
if (!token) {
  console.error('✖ SHOPIFY_ADMIN_API_TOKEN not set.');
  console.error('  Set it in .env or via: export SHOPIFY_ADMIN_API_TOKEN=shpat_...');
  process.exit(1);
}

console.log('Querying Admin API for displayed products...\n');

const { displayed } = await fetchDisplayedInventory({
  shop: config.admin.shop,
  token,
  version: config.admin.apiVersion
});

console.log(`Found ${displayed.length} displayed products.\n`);

// Filter to DENY-policy products that are out of stock
const outOfStock = displayed.filter(
  (p) =>
    p.variants.some((v) => v.inventoryPolicy === 'DENY' && !v.availableForSale) &&
    p.variants.some((v) => v.inventoryPolicy === 'DENY')
);

console.log('Out-of-stock DENY-policy products (should be in config.stock.knownSoldOut):\n');
if (outOfStock.length === 0) {
  console.log('  (none)');
} else {
  outOfStock.forEach((p) => {
    console.log(`  '${p.handle}',`);
  });
}

console.log('\n---\n');
console.log(`Current config.stock.knownSoldOut (${config.stock.knownSoldOut.length} items):\n`);
config.stock.knownSoldOut.forEach((h) => {
  const found = displayed.find((p) => p.handle === h);
  const status = found
    ? found.variants.some((v) => !v.availableForSale && v.inventoryPolicy === 'DENY')
      ? '✔ still OOS'
      : '⚠️  BACK IN STOCK — remove from allowlist'
    : '⚠️  not found in displayed products';
  console.log(`  '${h}' — ${status}`);
});

console.log('\n---\n');
console.log('Next steps:');
console.log('1. Review the "BACK IN STOCK" items above');
console.log('2. Remove them from config.stock.knownSoldOut in config/monitor.config.js');
console.log('3. Add any new out-of-stock DENY products to the allowlist');
console.log('4. Commit and push: git add config/monitor.config.js && git commit -m "chore: update allowlist"');
