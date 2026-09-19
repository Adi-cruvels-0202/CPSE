/**
 * Dummy merchant data — checklist 1.21 and 1.22.
 *
 * The merchant side of the product is out of scope (PROJECT_CONTEXT.md §1), so
 * stores, catalogues and khata ledgers exist only as seed data. Every id is a
 * fixed UUID rather than a random one, which makes seeding idempotent: running
 * it twice updates the same rows instead of creating a second set, and tests
 * can reference a known id.
 *
 * All money is integer paise (decision D8): 24900 = Rs 249.00.
 */

const rupees = (value) => Math.round(value * 100);

export const testCustomer = {
  email: 'test.customer@cpse.local',
  password: 'CpseTest!2026',
  full_name: 'Test Customer',
  phone: '+919876543210',
};

export const stores = [
  {
    id: '11111111-1111-4111-8111-000000000001',
    slug: 'sharma-kirana',
    name: 'Sharma Kirana Store',
    description: 'Neighbourhood grocery — staples, snacks and daily essentials.',
    logo_url: 'https://images.cpse.local/stores/sharma-kirana/logo.png',
    cover_image_url: 'https://images.cpse.local/stores/sharma-kirana/cover.jpg',
    phone: '+919812345601',
    email: 'hello@sharmakirana.local',
    address_line1: '14 Model Town Road',
    address_line2: 'Near Gurudwara',
    city: 'Ludhiana',
    state: 'Punjab',
    postal_code: '141002',
    latitude: 30.900965,
    longitude: 75.857276,
    opening_hours: {
      mon: [{ open: '08:00', close: '21:00' }],
      tue: [{ open: '08:00', close: '21:00' }],
      wed: [{ open: '08:00', close: '21:00' }],
      thu: [{ open: '08:00', close: '21:00' }],
      fri: [{ open: '08:00', close: '21:00' }],
      sat: [{ open: '08:00', close: '22:00' }],
      sun: [{ open: '09:00', close: '13:00' }],
    },
    timezone: 'Asia/Kolkata',
    pickup_enabled: true,
    delivery_enabled: true,
    min_order_paise: rupees(199),
    delivery_fee_paise: rupees(29),
    is_active: true,
    categories: [
      {
        id: '21111111-1111-4111-8111-000000000001',
        slug: 'staples',
        name: 'Staples',
        sort_order: 1,
        products: [
          {
            id: '31111111-1111-4111-8111-000000000001',
            slug: 'basmati-rice',
            name: 'Basmati Rice',
            description: 'Aged long-grain basmati, loose.',
            price_paise: rupees(129),
            mrp_paise: rupees(150),
            stock: 40,
            sort_order: 1,
            images: [
              { url: 'https://images.cpse.local/products/basmati-1.jpg', alt_text: 'Basmati rice', sort_order: 1 },
              { url: 'https://images.cpse.local/products/basmati-2.jpg', alt_text: 'Close up of grains', sort_order: 2 },
            ],
            // Variants carry absolute prices, never deltas (see 0008 migration).
            variants: [
              { id: '41111111-1111-4111-8111-000000000001', name: '1 kg', price_paise: rupees(129), stock: 40, sort_order: 1 },
              { id: '41111111-1111-4111-8111-000000000002', name: '5 kg', price_paise: rupees(599), stock: 12, sort_order: 2 },
            ],
          },
          {
            id: '31111111-1111-4111-8111-000000000002',
            slug: 'toor-dal',
            name: 'Toor Dal',
            description: 'Unpolished split pigeon peas.',
            price_paise: rupees(165),
            mrp_paise: rupees(180),
            stock: 25,
            sort_order: 2,
            images: [{ url: 'https://images.cpse.local/products/toor-dal.jpg', alt_text: 'Toor dal', sort_order: 1 }],
            variants: [],
          },
        ],
      },
      {
        id: '21111111-1111-4111-8111-000000000002',
        slug: 'snacks',
        name: 'Snacks & Namkeen',
        sort_order: 2,
        products: [
          {
            id: '31111111-1111-4111-8111-000000000003',
            slug: 'aloo-bhujia',
            name: 'Aloo Bhujia',
            description: 'Crisp potato sev, made fresh weekly.',
            price_paise: rupees(55),
            mrp_paise: rupees(60),
            stock: 60,
            sort_order: 1,
            images: [{ url: 'https://images.cpse.local/products/aloo-bhujia.jpg', alt_text: 'Aloo bhujia', sort_order: 1 }],
            variants: [
              { id: '41111111-1111-4111-8111-000000000003', name: '200 g', price_paise: rupees(55), stock: 60, sort_order: 1 },
              { id: '41111111-1111-4111-8111-000000000004', name: '400 g', price_paise: rupees(99), stock: 30, sort_order: 2 },
            ],
          },
          {
            // Deliberately out of stock: exercises the unavailable-product path
            // in cart and checkout tests (spec §6).
            id: '31111111-1111-4111-8111-000000000004',
            slug: 'soan-papdi',
            name: 'Soan Papdi',
            description: 'Seasonal. Currently sold out.',
            price_paise: rupees(120),
            mrp_paise: null,
            stock: 0,
            is_available: false,
            sort_order: 2,
            images: [],
            variants: [],
          },
        ],
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000002',
    slug: 'green-leaf-bakery',
    name: 'Green Leaf Bakery',
    description: 'Small-batch breads and cakes, baked every morning.',
    logo_url: 'https://images.cpse.local/stores/green-leaf/logo.png',
    cover_image_url: 'https://images.cpse.local/stores/green-leaf/cover.jpg',
    phone: '+919812345602',
    email: 'orders@greenleaf.local',
    address_line1: '7 Civil Lines',
    city: 'Ludhiana',
    state: 'Punjab',
    postal_code: '141001',
    latitude: 30.912043,
    longitude: 75.843536,
    opening_hours: {
      mon: [{ open: '07:00', close: '20:00' }],
      tue: [{ open: '07:00', close: '20:00' }],
      wed: [{ open: '07:00', close: '20:00' }],
      thu: [{ open: '07:00', close: '20:00' }],
      fri: [{ open: '07:00', close: '20:00' }],
      sat: [{ open: '07:00', close: '20:00' }],
      sun: [],
    },
    timezone: 'Asia/Kolkata',
    // Pickup only — covers the "delivery not offered" branch in checkout.
    pickup_enabled: true,
    delivery_enabled: false,
    min_order_paise: 0,
    delivery_fee_paise: 0,
    is_active: true,
    categories: [
      {
        id: '21111111-1111-4111-8111-000000000003',
        slug: 'breads',
        name: 'Breads',
        sort_order: 1,
        products: [
          {
            id: '31111111-1111-4111-8111-000000000005',
            slug: 'sourdough-loaf',
            name: 'Sourdough Loaf',
            description: '48-hour ferment, baked at 6am.',
            price_paise: rupees(180),
            mrp_paise: null,
            stock: 8,
            sort_order: 1,
            images: [{ url: 'https://images.cpse.local/products/sourdough.jpg', alt_text: 'Sourdough loaf', sort_order: 1 }],
            variants: [],
          },
          {
            id: '31111111-1111-4111-8111-000000000006',
            slug: 'multigrain-bread',
            name: 'Multigrain Bread',
            description: 'Five grains, no refined flour.',
            price_paise: rupees(95),
            mrp_paise: rupees(110),
            // Untracked stock: null means the store does not count this item.
            stock: null,
            sort_order: 2,
            images: [],
            variants: [],
          },
        ],
      },
      {
        id: '21111111-1111-4111-8111-000000000004',
        slug: 'cakes',
        name: 'Cakes',
        sort_order: 2,
        products: [
          {
            id: '31111111-1111-4111-8111-000000000007',
            slug: 'chocolate-truffle',
            name: 'Chocolate Truffle Cake',
            description: 'Eggless available on request.',
            price_paise: rupees(450),
            mrp_paise: rupees(500),
            stock: 5,
            sort_order: 1,
            images: [{ url: 'https://images.cpse.local/products/truffle-cake.jpg', alt_text: 'Chocolate truffle cake', sort_order: 1 }],
            variants: [
              { id: '41111111-1111-4111-8111-000000000005', name: 'Half kg', price_paise: rupees(450), stock: 5, sort_order: 1 },
              { id: '41111111-1111-4111-8111-000000000006', name: 'One kg', price_paise: rupees(850), stock: 3, sort_order: 2 },
              // An unavailable variant, for availability-rule tests.
              { id: '41111111-1111-4111-8111-000000000007', name: 'Two kg', price_paise: rupees(1600), stock: 0, is_available: false, sort_order: 3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000003',
    slug: 'city-pharmacy',
    name: 'City Pharmacy',
    description: 'Medicines and wellness, open late.',
    logo_url: 'https://images.cpse.local/stores/city-pharmacy/logo.png',
    cover_image_url: null,
    phone: '+919812345603',
    email: null,
    address_line1: '92 Ferozepur Road',
    city: 'Ludhiana',
    state: 'Punjab',
    postal_code: '141012',
    latitude: 30.884215,
    longitude: 75.846718,
    // Open late, past midnight — exercises the overnight branch of the
    // open/closed resolver (src/lib/openingHours.js).
    opening_hours: {
      mon: [{ open: '09:00', close: '23:30' }],
      tue: [{ open: '09:00', close: '23:30' }],
      wed: [{ open: '09:00', close: '23:30' }],
      thu: [{ open: '09:00', close: '23:30' }],
      fri: [{ open: '22:00', close: '02:00' }],
      sat: [{ open: '22:00', close: '02:00' }],
      sun: [{ open: '10:00', close: '22:00' }],
    },
    timezone: 'Asia/Kolkata',
    pickup_enabled: true,
    delivery_enabled: true,
    min_order_paise: rupees(99),
    delivery_fee_paise: rupees(19),
    is_active: true,
    categories: [
      {
        id: '21111111-1111-4111-8111-000000000005',
        slug: 'daily-care',
        name: 'Daily Care',
        sort_order: 1,
        products: [
          {
            id: '31111111-1111-4111-8111-000000000008',
            slug: 'antiseptic-liquid',
            name: 'Antiseptic Liquid',
            description: 'For first aid and general hygiene.',
            price_paise: rupees(145),
            mrp_paise: rupees(165),
            stock: 30,
            sort_order: 1,
            images: [{ url: 'https://images.cpse.local/products/antiseptic.jpg', alt_text: 'Antiseptic liquid', sort_order: 1 }],
            variants: [
              { id: '41111111-1111-4111-8111-000000000008', name: '250 ml', price_paise: rupees(145), stock: 30, sort_order: 1 },
              { id: '41111111-1111-4111-8111-000000000009', name: '500 ml', price_paise: rupees(255), stock: 18, sort_order: 2 },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * Checklist 1.22 — a khata account for the test customer at the kirana store,
 * with a short ledger. The customer can only ever read this (see 0018_rls.sql);
 * balance_paise is maintained by the trigger in 0017, so it is not seeded.
 *
 * Net: 2500 + 1800 - 2000 + 640 = 2940 paise owed.
 */
export const khataSeed = {
  accountId: '51111111-1111-4111-8111-000000000001',
  storeId: stores[0].id,
  transactions: [
    { type: 'debit', amount_paise: rupees(25), description: 'Groceries on credit', occurred_at: '2026-08-02T10:15:00Z' },
    { type: 'debit', amount_paise: rupees(18), description: 'Atta and oil', occurred_at: '2026-08-11T18:40:00Z' },
    { type: 'credit', amount_paise: rupees(20), description: 'Part payment (UPI)', occurred_at: '2026-08-20T09:05:00Z' },
    { type: 'debit', amount_paise: rupees(6.4), description: 'Snacks', occurred_at: '2026-09-01T17:20:00Z' },
  ],
};

/** Flattens the nested seed tree into the rows each table expects. */
export function flattenSeed(source = stores) {
  const storeRows = [];
  const categoryRows = [];
  const productRows = [];
  const imageRows = [];
  const variantRows = [];

  for (const { categories = [], ...store } of source) {
    storeRows.push(store);

    for (const { products = [], ...category } of categories) {
      categoryRows.push({ ...category, store_id: store.id });

      for (const { images = [], variants = [], ...product } of products) {
        productRows.push({
          is_available: true,
          ...product,
          store_id: store.id,
          category_id: category.id,
        });

        images.forEach((image, index) => {
          imageRows.push({
            // Deterministic id, so re-seeding updates instead of duplicating.
            id: `61111111-1111-4111-8111-${String(imageRows.length + 1).padStart(12, '0')}`,
            ...image,
            product_id: product.id,
            sort_order: image.sort_order ?? index + 1,
          });
        });

        variants.forEach((variant, index) => {
          variantRows.push({
            is_available: true,
            ...variant,
            product_id: product.id,
            sort_order: variant.sort_order ?? index + 1,
          });
        });
      }
    }
  }

  return { storeRows, categoryRows, productRows, imageRows, variantRows };
}
