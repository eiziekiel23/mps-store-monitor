/**
 * Human-readable labels and grouping for all monitored check IDs.
 *
 * CHECK_LABELS:  maps every check id → display name shown in Telegram reports.
 * CHECK_GROUPS:  ordered sections in the per-check status board; checks that
 *               appear in no group fall into an "Other" catch-all at the end.
 * STATUS_EMOJI:  one emoji per aggregated status value.
 */

export const CHECK_LABELS = {
  // Storefront
  'store.reachable':         'Store reachable',
  'home.sections':           'Homepage sections render',
  'product.sections':        'Product page sections render',
  'announcement.correct':    'Announcement banner text',
  'timer.correct':           'Countdown timer',
  'flash.banners':           'Flash giveaway banners',
  'product.giveaway_images': 'Giveaway product images',
  'video.how_to_enter':      'How-to-enter video',
  // Navigation
  'nav.key_links':           'Giveaway / Gallery / Reviews links',
  'nav.quick_links':         'Footer quick links',
  'nav.rules':               'Official rules page',
  'nav.hamburger':           'Mobile hamburger menu',
  // Cart
  'cart.add_pdp':            'Add to cart',
  'cart.entries':            'Cart entries total',
  // Checkout
  'checkout.entries':        'Checkout entries banner',
  'checkout.bonus_entries':  'Checkout bonus entries',
  'checkout.trust_badge':    'Checkout trust badge',
  // Stock
  'stock.all':               'All products in stock',
  // Giveaway
  'giveaway.freshness':      'Daily giveaway rotated',
  // System
  'alerting.healthy':        'Alerting system',
};

/** Ordered display groups for the per-check status board. */
export const CHECK_GROUPS = [
  {
    label: 'Storefront',
    ids: [
      'store.reachable',
      'home.sections',
      'product.sections',
      'announcement.correct',
      'timer.correct',
      'flash.banners',
      'product.giveaway_images',
      'video.how_to_enter',
    ],
  },
  {
    label: 'Navigation',
    ids: ['nav.key_links', 'nav.quick_links', 'nav.rules', 'nav.hamburger'],
  },
  {
    label: 'Cart',
    ids: ['cart.add_pdp', 'cart.entries'],
  },
  {
    label: 'Checkout',
    ids: ['checkout.entries', 'checkout.bonus_entries', 'checkout.trust_badge'],
  },
  {
    label: 'Stock',
    ids: ['stock.all'],
  },
  {
    label: 'Giveaway',
    ids: ['giveaway.freshness'],
  },
  {
    label: 'System',
    ids: ['alerting.healthy'],
  },
];

export const STATUS_EMOJI = {
  passed:  '✅',
  flaky:   '⚠️',
  failed:  '🔴',
  skipped: '⏭️',
};
