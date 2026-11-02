/** Small, repeatable development catalogue for the customer storefront. */

const rupees = (value) => Math.round(value * 100);
const uuid = (prefix, number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, '0')}`;

const groups = [
  {
    category: 'Groceries', shopCategory: 'grocery',
    shops: [
      { name: 'Green Basket Grocers', slug: 'green-basket-grocers', address: '12 Model Town Market', description: 'A sample neighbourhood grocer for everyday staples and fresh produce.' },
      { name: 'Daily Needs Supermart', slug: 'daily-needs-supermart', address: '45 Sarabha Nagar Main Road', description: 'A sample local market for pantry staples and household essentials.' },
    ],
    catalogue: [
      { name: 'Pantry Staples', slug: 'pantry-staples', products: [
        ['Basmati Rice', 'basmati-rice', 129, 149, 'kg', 5],
        ['Whole Wheat Atta', 'whole-wheat-atta', 55, 62, 'kg', 5],
      ] },
      { name: 'Fresh Produce', slug: 'fresh-produce', products: [
        ['Apples', 'apples', 120, 140, 'kg', 0],
        ['Potatoes', 'potatoes', 32, 38, 'kg', 0],
      ] },
    ],
  },
  {
    category: 'Food and bakery', shops: [
      {
        name: 'Tandoori Junction', slug: 'tandoori-junction', shopCategory: 'restaurant', address: '8 Pakhowal Road',
        description: 'A sample takeaway kitchen serving freshly prepared local meals.',
        catalogue: [
          { name: 'Meals', slug: 'meals', products: [
            ['Paneer Rice Bowl', 'paneer-rice-bowl', 165, 185, 'serving', 5],
            ['Dal Tadka Meal', 'dal-tadka-meal', 145, 165, 'serving', 5],
          ] },
          { name: 'Snacks and Sides', slug: 'snacks-sides', products: [
            ['Samosa', 'samosa', 25, 30, 'pcs', 5],
            ['Mint Chutney', 'mint-chutney', 35, 40, 'pack', 5],
          ] },
        ],
      },
      {
        name: 'Sunrise Bakehouse', slug: 'sunrise-bakehouse', shopCategory: 'bakery', address: '21 Feroze Gandhi Market',
        description: 'A sample bakery with breads, cakes and freshly baked treats.',
        catalogue: [
          { name: 'Breads', slug: 'breads', products: [
            ['Multigrain Bread', 'multigrain-bread', 55, 65, 'pcs', 5],
            ['Milk Bread', 'milk-bread', 45, 55, 'pcs', 5],
          ] },
          { name: 'Cakes and Treats', slug: 'cakes-treats', products: [
            ['Chocolate Cupcake', 'chocolate-cupcake', 45, 55, 'pcs', 5],
            ['Butter Cookies', 'butter-cookies', 95, 110, 'pack', 5],
          ] },
        ],
      },
    ],
  },
  {
    category: 'Health and pharmacy', shopCategory: 'pharmacy',
    shops: [
      { name: 'WellCare Pharmacy', slug: 'wellcare-pharmacy', address: '19 College Road', description: 'A sample chemist with everyday first-aid and wellness essentials.' },
      { name: 'CityMed Chemist', slug: 'citymed-chemist', address: '33 Dugri Road', description: 'A sample neighbourhood pharmacy for common health essentials.' },
    ],
    catalogue: [
      { name: 'First Aid', slug: 'first-aid', products: [
        ['Adhesive Bandages', 'adhesive-bandages', 60, 70, 'pack', 5],
        ['Antiseptic Liquid', 'antiseptic-liquid', 75, 85, 'pcs', 5],
      ] },
      { name: 'Wellness', slug: 'wellness', products: [
        ['ORS Sachets', 'ors-sachets', 22, 26, 'pack', 5],
        ['Vitamin C Tablets', 'vitamin-c-tablets', 55, 65, 'pack', 5],
      ] },
    ],
  },
  {
    category: 'Home and household', shopCategory: 'general',
    shops: [
      { name: 'Home and Hearth', slug: 'home-and-hearth', address: '5 BRS Nagar Market', description: 'A sample home shop for kitchenware and practical household goods.' },
      { name: 'CleanNest Household Store', slug: 'cleannest-household-store', address: '27 Haibowal Main Road', description: 'A sample household shop for cleaning and daily-use supplies.' },
    ],
    catalogue: [
      { name: 'Kitchen', slug: 'kitchen', products: [
        ['Stainless Steel Tumbler', 'stainless-steel-tumbler', 90, 110, 'pcs', 12],
        ['Food Storage Container', 'food-storage-container', 145, 170, 'pcs', 12],
      ] },
      { name: 'Cleaning', slug: 'cleaning', products: [
        ['Dishwash Liquid', 'dishwash-liquid', 85, 99, 'pcs', 18],
        ['Microfiber Cleaning Cloth', 'microfiber-cleaning-cloth', 55, 65, 'pcs', 12],
      ] },
    ],
  },
  {
    category: 'Fashion and personal care', shopCategory: 'clothing',
    shops: [
      { name: 'Thread and Needle Boutique', slug: 'thread-and-needle-boutique', address: '16 Ghumar Mandi', description: 'A sample boutique for everyday clothing and accessories.' },
      { name: 'Everyday Style Studio', slug: 'everyday-style-studio', address: '39 Model Town Extension', description: 'A sample fashion shop with casual wear and useful accessories.' },
    ],
    catalogue: [
      { name: 'Clothing', slug: 'clothing', products: [
        ['Cotton Kurta', 'cotton-kurta', 699, 799, 'pcs', 5],
        ['Everyday T-Shirt', 'everyday-t-shirt', 399, 449, 'pcs', 5],
      ] },
      { name: 'Accessories', slug: 'accessories', products: [
        ['Cotton Scarf', 'cotton-scarf', 249, 299, 'pcs', 5],
        ['Canvas Tote Bag', 'canvas-tote-bag', 299, 349, 'pcs', 12],
      ] },
    ],
  },
  {
    category: 'Electronics', shopCategory: 'electronics',
    shops: [
      { name: 'Spark Mobile and Electronics', slug: 'spark-mobile-electronics', address: '10 G.T. Road Market', description: 'A sample electronics shop for mobile accessories and daily tech.' },
      { name: 'Northstar Electronics', slug: 'northstar-electronics', address: '42 Civil Lines', description: 'A sample local electronics shop for practical home and phone accessories.' },
    ],
    catalogue: [
      { name: 'Mobile Accessories', slug: 'mobile-accessories', products: [
        ['USB-C Charging Cable', 'usb-c-charging-cable', 199, 249, 'pcs', 18],
        ['Phone Stand', 'phone-stand', 149, 179, 'pcs', 18],
      ] },
      { name: 'Everyday Electronics', slug: 'everyday-electronics', products: [
        ['LED Desk Lamp', 'led-desk-lamp', 499, 599, 'pcs', 18],
        ['Power Strip', 'power-strip', 399, 449, 'pcs', 18],
      ] },
    ],
  },
  {
    category: 'Kids, books and hobbies', shopCategory: 'other',
    shops: [
      { name: 'Little Lantern Toys and Kids', slug: 'little-lantern-toys-kids', address: '3 Sarabha Nagar Market', description: 'A sample children’s shop for toys, games and creative play.' },
      { name: 'PaperTrail Books and Hobbies', slug: 'papertrail-books-hobbies', address: '18 College Road', description: 'A sample book and stationery shop for reading and creative hobbies.' },
    ],
    catalogue: [
      { name: 'Play and Create', slug: 'play-and-create', products: [
        ['Colouring Set', 'colouring-set', 120, 145, 'set', 12],
        ['Wooden Building Blocks', 'wooden-building-blocks', 349, 399, 'set', 12],
      ] },
      { name: 'Books and Stationery', slug: 'books-stationery', products: [
        ['Drawing Notebook', 'drawing-notebook', 85, 99, 'pcs', 12],
        ['Storybook for Young Readers', 'storybook-young-readers', 175, 199, 'pcs', 0],
      ] },
    ],
  },
  {
    category: 'Hardware and outdoors', shopCategory: 'general',
    shops: [
      { name: 'FixIt Hardware and Tools', slug: 'fixit-hardware-tools', address: '7 Industrial Area Market', description: 'A sample hardware shop for small repairs, tools and fittings.' },
      { name: 'Green Thumb Garden and Outdoor', slug: 'green-thumb-garden-outdoor', address: '24 Ferozepur Road', description: 'A sample garden shop for plants, pots and outdoor essentials.' },
    ],
    catalogue: [
      { name: 'Tools and Repair', slug: 'tools-repair', products: [
        ['Screwdriver Set', 'screwdriver-set', 249, 299, 'set', 18],
        ['Measuring Tape', 'measuring-tape', 99, 119, 'pcs', 18],
      ] },
      { name: 'Garden and Outdoor', slug: 'garden-outdoor', products: [
        ['Terracotta Plant Pot', 'terracotta-plant-pot', 149, 179, 'pcs', 5],
        ['Garden Hand Trowel', 'garden-hand-trowel', 129, 159, 'pcs', 18],
      ] },
    ],
  },
];

// Additional distinct demo shops bring each home-page category to five when
// combined with the three pre-existing development listings. Kept in separate
// appended groups so the original sample IDs remain stable across seed runs.
const shopExpansions = [
  { from: 'Groceries', shops: [
    { name: 'Harvest Corner Market', slug: 'harvest-corner-market', address: '6 Pakhowal Road', description: 'A sample neighbourhood market for daily groceries and fresh produce.' },
    { name: 'Punjab Pantry', slug: 'punjab-pantry', address: '31 Dugri Road', description: 'A sample grocery shop for pantry staples and household basics.' },
  ] },
  { from: 'Food and bakery', shops: [
    { name: 'Spice Route Kitchen', slug: 'spice-route-kitchen', shopCategory: 'restaurant', address: '14 Ferozepur Road', description: 'A sample kitchen serving familiar meals and quick bites.' },
    { name: 'Ovenfresh Bread Co', slug: 'ovenfresh-bread-co', shopCategory: 'bakery', address: '9 College Road', description: 'A sample bakehouse for fresh breads and everyday treats.' },
  ] },
  { from: 'Health and pharmacy', shops: [
    { name: 'CarePlus Medical Store', slug: 'careplus-medical-store', address: '22 Civil Lines', description: 'A sample pharmacy for first-aid and everyday wellness essentials.' },
    { name: 'GoodHealth Chemists', slug: 'goodhealth-chemists', address: '4 Haibowal Main Road', description: 'A sample chemist for common health and personal-care needs.' },
  ] },
  { from: 'Home and household', shops: [
    { name: 'Everyday Home Goods', slug: 'everyday-home-goods', address: '17 Sarabha Nagar', description: 'A sample home shop for useful kitchen and household items.' },
    { name: 'NeatSpace Essentials', slug: 'neatspace-essentials', address: '28 Model Town Market', description: 'A sample household store for cleaning and daily-use products.' },
    { name: 'Kitchen Corner Store', slug: 'kitchen-corner-store', address: '11 Ghumar Mandi', description: 'A sample shop for practical kitchenware and home basics.' },
  ] },
  { from: 'Fashion and personal care', shops: [
    { name: 'Cottonwood Clothing', slug: 'cottonwood-clothing', address: '20 Pakhowal Road', description: 'A sample clothing shop for comfortable everyday styles.' },
    { name: 'The Style Edit', slug: 'the-style-edit', address: '37 College Road', description: 'A sample fashion and accessories shop for daily wear.' },
    { name: 'Everyday Care and Style', slug: 'everyday-care-and-style', address: '2 BRS Nagar Market', description: 'A sample personal-care and fashion shop for everyday essentials.' },
  ] },
  { from: 'Electronics', shops: [
    { name: 'PixelPoint Electronics', slug: 'pixelpoint-electronics', address: '13 G.T. Road Market', description: 'A sample electronics shop for useful phone and home accessories.' },
    { name: 'BrightWire Tech Store', slug: 'brightwire-tech-store', address: '25 Civil Lines', description: 'A sample tech shop for cables, chargers and everyday electronics.' },
    { name: 'Circuit House Ludhiana', slug: 'circuit-house-ludhiana', address: '8 Industrial Area Market', description: 'A sample local electronics store for practical technology essentials.' },
  ] },
  { from: 'Kids, books and hobbies', shops: [
    { name: 'Curious Cubs Toy Shop', slug: 'curious-cubs-toy-shop', address: '15 Sarabha Nagar Market', description: 'A sample toy shop for games, building sets and creative play.' },
    { name: 'The Reading Nook', slug: 'the-reading-nook', address: '29 College Road', description: 'A sample bookshop for children’s stories and family reading.' },
    { name: 'Make and Play Stationery', slug: 'make-and-play-stationery', address: '5 Ghumar Mandi', description: 'A sample stationery shop for school supplies and art projects.' },
  ] },
  { from: 'Hardware and outdoors', shops: [
    { name: 'Reliable Tools Depot', slug: 'reliable-tools-depot', address: '16 Industrial Area Market', description: 'A sample hardware shop for repair tools and home fittings.' },
    { name: 'Greenway Garden Supplies', slug: 'greenway-garden-supplies', address: '32 Ferozepur Road', description: 'A sample garden shop for pots, plants and outdoor essentials.' },
    { name: 'HandyHome Hardware', slug: 'handyhome-hardware', address: '7 Dugri Road', description: 'A sample local hardware shop for small fixes and DIY projects.' },
  ] },
];

const expandedGroups = shopExpansions.map(({ from, shops }) => {
  const template = groups.find(({ category }) => category === from);
  const catalogueFor = (shop) => template.catalogue
    ?? template.shops.find(({ shopCategory }) => shopCategory === shop.shopCategory)?.catalogue
    ?? template.shops[0].catalogue;
  return { ...template, shops: shops.map((shop) => ({ ...shop, catalogue: catalogueFor(shop) })) };
});
const allGroups = [...groups, ...expandedGroups];

const openingHours = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [{ open: '08:00', close: '22:00' }]]),
);

let storeNumber = 0;
let categoryNumber = 0;
let productNumber = 0;

export const sampleShops = allGroups.flatMap((group) => group.shops.map((profile) => {
  storeNumber += 1;
  const storeId = uuid('50000000', storeNumber);
  const categories = (profile.catalogue ?? group.catalogue).map((catalogue) => {
    categoryNumber += 1;
    const categoryId = uuid('51000000', categoryNumber);
    return {
      id: categoryId,
      name: catalogue.name,
      slug: catalogue.slug,
      sort_order: categoryNumber,
      products: catalogue.products.map(([name, slug, price, mrp, unit, tax], index) => {
        productNumber += 1;
        const productId = uuid('52000000', productNumber);
        return {
          id: productId,
          name,
          slug,
          description: `Sample ${name.toLowerCase()} listing for local development.` ,
          price_paise: rupees(price),
          mrp_paise: rupees(mrp),
          tax_percent: tax,
          unit,
          stock: 30,
          sort_order: index + 1,
          images: [],
          variants: [{
            id: uuid('53000000', productNumber),
            name: 'Default',
            price_paise: rupees(price),
            stock: 30,
            sort_order: 1,
          }],
        };
      }),
    };
  });

  return {
    id: storeId,
    slug: profile.slug,
    name: profile.name,
    description: profile.description,
    logo_url: null,
    cover_image_url: null,
    phone: null,
    email: null,
    address_line1: profile.address,
    address_line2: 'Sample address for development',
    city: 'Ludhiana',
    state: 'Punjab',
    postal_code: '141001',
    country: 'IN',
    latitude: null,
    longitude: null,
    opening_hours: openingHours,
    timezone: 'Asia/Kolkata',
    pickup_enabled: true,
    delivery_enabled: true,
    min_order_paise: 0,
    delivery_fee_paise: 0,
    free_delivery_threshold_paise: null,
    accepts_cash: true,
    accepts_online: false,
    is_active: true,
    is_published: true,
    shop_category: profile.shopCategory ?? group.shopCategory,
    categories,
  };
}));
