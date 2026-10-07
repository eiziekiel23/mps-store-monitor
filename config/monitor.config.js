export default {
  storeUrl: 'https://mysterypokeslabs.com',
  referenceProducts: [
    '5x-pokemon-booster-packs',
    'premium-modern-pokemon-cards'
  ],
  // Section tokens are matched as substrings against each section's class or id
  // on the live site. The live theme uses underscores in Shopify section ids
  // (e.g. mps_trust_badge) and hyphens in some class names (e.g. section--flash-timer),
  // so tokens below are chosen to match the real rendered markup.
  sections: {
    home: [
      'header',
      'announcement',
      'giveaway_timer',          // id: ...__mps_giveaway_timer_flash
      'giveaway_section_monthly_flash',
      'trust_badge',             // id: ...__mps_trust_badge
      'video',
      'featured_collection',     // id: ...__section_featured_collection
      'winners',                 // id: ...__giveaway_winners_grid
      'customer-pulls',          // class: section--customer-pulls-grid
      'reviews',
      'faq',
      'footer'
    ],
    product: [
      'header',
      'announcement',
      'giveaway_section_monthly_flash', // product pages show the same flash banner section
      'product-header',          // id: ...__zp-product-header-content
      'reviews',
      'footer'
    ]
  },
  navigation: {
    keyLinks: {
      'Mystery Pokémon': '#mystery-pokemon',
      'Sealed Pokémon': '/pages/sealed-pokemon',
      'Giveaway Winners': '/pages/giveaway-winners',
      'Customer Pulls': '/pages/customer-pulls',
      'Customer Reviews': '/pages/customer-reviews'
    },
    quickLinks: {
      'Search': '/search',
      'Refund Policy': '/policies/refund-policy',
      'Privacy Policy': '/policies/privacy-policy',
      'Terms of Service': '/policies/terms-of-service',
      'Shipping Policy': '/policies/shipping-policy',
      'Contact Information': '/policies/contact-information'
    }
  },
  stock: {
    exclusionsRegex: /pass|protection|^golden ticket/i
  },
  trackers: {
    blockRegex: [
      /facebook\.(com|net)/,
      /tiktok/,
      /google-analytics|googletagmanager|doubleclick|googleadservices/,
      /klaviyo/,
      /monorail-edge\.shopifysvc\.com/,
      /\/\.well-known\/shopify\/monorail/
    ]
  },
  orderProtection: {
    // Default tier rates lookup table
    tiers: [
      { max: 50, price: 1.50 },
      { max: 100, price: 2.75 },
      { max: 200, price: 4.50 },
      { max: 300, price: 6.50 },
      { max: 400, price: 8.50 },
      { max: 500, price: 10.50 },
      { max: 1000, price: 18.00 },
      { max: Infinity, price: 25.00 }
    ]
  },
  giveaway: {
    // The flash-giveaway metaobject fields are rotated once a day, normally
    // around 02:00 America/Chicago. The monitor alerts if they haven't rotated
    // by anchorHour + graceMs, or if the active giveaway's end date has passed.
    timeZone: 'America/Chicago',
    anchorHour: 2,
    graceMs: 60 * 60 * 1000, // 1h → due by ~03:00 Chicago
    // A change to any of these fields counts as "today's giveaway rotated".
    // Every field change is still logged; only these drive the freshness verdict.
    // Field keys inferred from metaobject display names: Flash Giveaway End Date,
    // Flash Giveaway Desktop Banner, Flash Giveaway Mobile Banner, PDP Images.
    // Verify against giveaway/check.js field-key logs on first CI run.
    rotationFields: [
      'flash_giveaway_end_date',
      'flash_giveaway_desktop_banner',
      'flash_giveaway_mobile_banner',
      'pdp_images'
    ],
    // Fields excluded from the changelog entirely (noisy, non-semantic churn).
    ignoreFields: [],
    maxEntries: 180
  }
};
