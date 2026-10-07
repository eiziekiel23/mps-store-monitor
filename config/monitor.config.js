export default {
  storeUrl: 'https://mysterypokeslabs.com',
  referenceProducts: [
    'mystery-boost-box',
    'charizard-vintage-pack'
  ],
  sections: {
    home: [
      'header',
      'announcement',
      'giveaway-section-monthly-timer',
      'giveaway-section-monthly-flash',
      'trust-badge',
      'video',
      'featured-collection',
      'winners',
      'customer-pulls',
      'reviews',
      'faq',
      'footer'
    ],
    product: [
      'header',
      'announcement',
      'giveaway-section-monthly-image',
      'main-product',
      'reviews',
      'footer'
    ]
  },
  navigation: {
    keyLinks: {
      'Sealed Pokémon': '/collections/sealed-pokemon',
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
  }
};
