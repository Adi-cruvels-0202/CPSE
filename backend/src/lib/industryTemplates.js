/**
 * Industry templates — roadmap §4 P1 "Industry templates", "Product starter
 * catalogues", "Units", "Workflow defaults".
 *
 * A template is a starting point, never a rule: applying one creates ordinary
 * categories and products the merchant can rename, reprice, deactivate or
 * delete, and sets store defaults they can change. Prices are suggestions the
 * merchant confirms or overrides when choosing products; GST rates are the
 * usual ones for the goods and must be confirmed with the merchant's own
 * accountant. Every price is integer paise.
 */

const v = (name, pricePaise, extra = {}) => ({ name, pricePaise, ...extra });

export const INDUSTRY_TEMPLATES = {
  grocery: {
    label: 'Grocery / Kirana',
    shopCategory: 'grocery',
    defaults: { lowStockThreshold: 5, taxPercent: 5, trackInventory: true, expiryAlertDays: 30 },
    categories: ['Rice & Grains', 'Atta & Flours', 'Dals & Pulses', 'Fruits & Vegetables', 'Dairy & Eggs', 'Oils & Ghee', 'Spices', 'Tea & Coffee', 'Snacks & Biscuits', 'Household'],
    products: [
      { key: 'basmati-rice', name: 'Basmati Rice', category: 'Rice & Grains', unit: 'kg', taxPercent: 5, variants: [v('1 kg', 12000, { weightGrams: 1000 }), v('5 kg', 57500, { weightGrams: 5000 })] },
      { key: 'sona-masoori', name: 'Sona Masoori Rice', category: 'Rice & Grains', unit: 'kg', taxPercent: 5, variants: [v('1 kg', 6500, { weightGrams: 1000 }), v('5 kg', 31000, { weightGrams: 5000 })] },
      { key: 'wheat-atta', name: 'Whole Wheat Atta', category: 'Atta & Flours', unit: 'kg', taxPercent: 5, variants: [v('1 kg', 5500, { weightGrams: 1000 }), v('5 kg', 26000, { weightGrams: 5000 })] },
      { key: 'besan', name: 'Besan (Gram Flour)', category: 'Atta & Flours', unit: 'g', taxPercent: 5, variants: [v('500 g', 6000, { weightGrams: 500 }), v('1 kg', 11500, { weightGrams: 1000 })] },
      { key: 'toor-dal', name: 'Toor Dal', category: 'Dals & Pulses', unit: 'kg', taxPercent: 5, variants: [v('500 g', 8500, { weightGrams: 500 }), v('1 kg', 16500, { weightGrams: 1000 })] },
      { key: 'moong-dal', name: 'Moong Dal', category: 'Dals & Pulses', unit: 'kg', taxPercent: 5, variants: [v('500 g', 7500, { weightGrams: 500 }), v('1 kg', 14500, { weightGrams: 1000 })] },
      { key: 'mustard-oil', name: 'Mustard Oil', category: 'Oils & Ghee', unit: 'l', taxPercent: 5, variants: [v('1 litre', 18500), v('5 litre', 89000)] },
      { key: 'sunflower-oil', name: 'Sunflower Oil', category: 'Oils & Ghee', unit: 'l', taxPercent: 5, variants: [v('1 litre', 16500)] },
      { key: 'turmeric', name: 'Turmeric Powder', category: 'Spices', unit: 'g', taxPercent: 5, variants: [v('100 g', 3500, { weightGrams: 100 }), v('200 g', 6500, { weightGrams: 200 })] },
      { key: 'tea', name: 'Assam Tea', category: 'Tea & Coffee', unit: 'g', taxPercent: 5, variants: [v('250 g', 14000, { weightGrams: 250 }), v('500 g', 27000, { weightGrams: 500 })] },
      { key: 'glucose-biscuits', name: 'Glucose Biscuits', category: 'Snacks & Biscuits', unit: 'pack', taxPercent: 18, variants: [v('Pack', 1000)] },
      { key: 'washing-soap', name: 'Detergent Bar', category: 'Household', unit: 'pcs', taxPercent: 18, variants: [v('Bar', 3500)] },
    ],
  },
  pharmacy: {
    label: 'Pharmacy / Chemist',
    shopCategory: 'pharmacy',
    // Medicines expire: alert three months ahead.
    defaults: { lowStockThreshold: 10, taxPercent: 12, trackInventory: true, expiryAlertDays: 90 },
    categories: ['Pain & Fever', 'Cold & Cough', 'Digestive Care', 'Vitamins & Supplements', 'First Aid', 'Personal Care'],
    products: [
      { key: 'paracetamol-500', name: 'Paracetamol 500 mg', category: 'Pain & Fever', unit: 'pack', taxPercent: 12, variants: [v('Strip of 10', 3000)] },
      { key: 'ors', name: 'ORS Sachet', category: 'Digestive Care', unit: 'pack', taxPercent: 12, variants: [v('Sachet', 2200), v('Box of 10', 21000)] },
      { key: 'antacid', name: 'Antacid Tablets', category: 'Digestive Care', unit: 'pack', taxPercent: 12, variants: [v('Strip of 6', 2500)] },
      { key: 'cough-syrup', name: 'Herbal Cough Syrup', category: 'Cold & Cough', unit: 'ml', taxPercent: 12, variants: [v('100 ml', 11000)] },
      { key: 'vapour-rub', name: 'Vapour Rub', category: 'Cold & Cough', unit: 'g', taxPercent: 12, variants: [v('25 ml', 9000)] },
      { key: 'vitamin-c', name: 'Vitamin C Chewable', category: 'Vitamins & Supplements', unit: 'pack', taxPercent: 18, variants: [v('Strip of 15', 4500)] },
      { key: 'bandage', name: 'Adhesive Bandages', category: 'First Aid', unit: 'box', taxPercent: 12, variants: [v('Box of 20', 6000)] },
      { key: 'antiseptic', name: 'Antiseptic Liquid', category: 'First Aid', unit: 'ml', taxPercent: 18, variants: [v('100 ml', 7000), v('500 ml', 26000)] },
      { key: 'hand-sanitizer', name: 'Hand Sanitizer', category: 'Personal Care', unit: 'ml', taxPercent: 18, variants: [v('100 ml', 5000)] },
    ],
  },
  clothing: {
    label: 'Clothing / Apparel',
    shopCategory: 'clothing',
    // Garments do not expire; sizes run out.
    defaults: { lowStockThreshold: 2, taxPercent: 5, trackInventory: true, expiryAlertDays: 0 },
    categories: ["Men's Wear", "Women's Wear", 'Kids', 'Innerwear', 'Accessories'],
    products: [
      { key: 'cotton-shirt', name: 'Cotton Shirt', category: "Men's Wear", unit: 'pcs', taxPercent: 5, variants: [v('S', 79900), v('M', 79900), v('L', 79900), v('XL', 84900)] },
      { key: 'kurta', name: 'Cotton Kurta', category: "Women's Wear", unit: 'pcs', taxPercent: 5, variants: [v('S', 89900), v('M', 89900), v('L', 89900)] },
      { key: 'kids-tshirt', name: 'Kids T-Shirt', category: 'Kids', unit: 'pcs', taxPercent: 5, variants: [v('2–3 yrs', 29900), v('4–5 yrs', 32900), v('6–7 yrs', 34900)] },
      { key: 'socks', name: 'Cotton Socks', category: 'Innerwear', unit: 'pair', taxPercent: 5, variants: [v('Pair', 9900), v('Pack of 3', 27900)] },
      { key: 'belt', name: 'Leather Belt', category: 'Accessories', unit: 'pcs', taxPercent: 12, variants: [v('32', 49900), v('34', 49900), v('36', 49900)] },
    ],
  },
  electronics: {
    label: 'Electronics & Mobile Accessories',
    shopCategory: 'electronics',
    defaults: { lowStockThreshold: 3, taxPercent: 18, trackInventory: true, expiryAlertDays: 0 },
    categories: ['Chargers & Cables', 'Audio', 'Batteries', 'Lighting', 'Mobile Accessories'],
    products: [
      { key: 'usb-c-cable', name: 'USB-C Cable', category: 'Chargers & Cables', unit: 'pcs', taxPercent: 18, variants: [v('1 m', 29900), v('2 m', 39900)] },
      { key: 'charger-20w', name: '20 W Fast Charger', category: 'Chargers & Cables', unit: 'pcs', taxPercent: 18, variants: [v('Charger', 69900)] },
      { key: 'earphones', name: 'Wired Earphones', category: 'Audio', unit: 'pcs', taxPercent: 18, variants: [v('Earphones', 39900)] },
      { key: 'aa-batteries', name: 'AA Batteries', category: 'Batteries', unit: 'pack', taxPercent: 18, variants: [v('Pack of 2', 6000), v('Pack of 4', 11500)] },
      { key: 'led-bulb', name: 'LED Bulb', category: 'Lighting', unit: 'pcs', taxPercent: 12, variants: [v('9 W', 9900), v('12 W', 12900)] },
      { key: 'screen-guard', name: 'Tempered Glass Screen Guard', category: 'Mobile Accessories', unit: 'pcs', taxPercent: 18, variants: [v('Universal 6.5"', 19900)] },
    ],
  },
  bakery: {
    label: 'Bakery & Sweets',
    shopCategory: 'bakery',
    // Fresh goods: alert two days ahead, and expect frequent restocking.
    defaults: { lowStockThreshold: 5, taxPercent: 5, trackInventory: true, expiryAlertDays: 2 },
    categories: ['Cakes', 'Breads', 'Cookies', 'Snacks & Savouries', 'Sweets'],
    products: [
      { key: 'white-bread', name: 'White Bread', category: 'Breads', unit: 'pcs', taxPercent: 0, variants: [v('400 g loaf', 4500, { weightGrams: 400 })] },
      { key: 'brown-bread', name: 'Brown Bread', category: 'Breads', unit: 'pcs', taxPercent: 0, variants: [v('400 g loaf', 5500, { weightGrams: 400 })] },
      { key: 'pav', name: 'Ladi Pav', category: 'Breads', unit: 'pack', taxPercent: 0, variants: [v('Pack of 6', 3500)] },
      { key: 'black-forest', name: 'Black Forest Cake', category: 'Cakes', unit: 'kg', taxPercent: 18, variants: [v('500 g', 45000, { weightGrams: 500 }), v('1 kg', 85000, { weightGrams: 1000 })] },
      { key: 'butter-cookies', name: 'Butter Cookies', category: 'Cookies', unit: 'g', taxPercent: 18, variants: [v('250 g', 15000, { weightGrams: 250 })] },
      { key: 'veg-puff', name: 'Veg Puff', category: 'Snacks & Savouries', unit: 'pcs', taxPercent: 5, variants: [v('Piece', 2500)] },
      { key: 'kaju-katli', name: 'Kaju Katli', category: 'Sweets', unit: 'kg', taxPercent: 5, variants: [v('250 g', 27500, { weightGrams: 250 }), v('500 g', 54000, { weightGrams: 500 })] },
    ],
  },
  stationery: {
    label: 'Stationery & Books',
    shopCategory: 'stationery',
    defaults: { lowStockThreshold: 10, taxPercent: 12, trackInventory: true, expiryAlertDays: 0 },
    categories: ['Notebooks', 'Pens & Pencils', 'Art & Craft', 'Office Supplies', 'School Essentials'],
    products: [
      { key: 'notebook-ruled', name: 'Ruled Notebook', category: 'Notebooks', unit: 'pcs', taxPercent: 12, variants: [v('100 pages', 4000), v('200 pages', 7500)] },
      { key: 'ball-pen', name: 'Ball Pen', category: 'Pens & Pencils', unit: 'pcs', taxPercent: 18, variants: [v('Blue', 1000), v('Black', 1000), v('Box of 10 (blue)', 9500)] },
      { key: 'pencil', name: 'HB Pencil', category: 'Pens & Pencils', unit: 'box', taxPercent: 12, variants: [v('Box of 10', 5000)] },
      { key: 'crayons', name: 'Wax Crayons', category: 'Art & Craft', unit: 'box', taxPercent: 12, variants: [v('12 shades', 4500), v('24 shades', 8500)] },
      { key: 'a4-paper', name: 'A4 Copier Paper', category: 'Office Supplies', unit: 'pack', taxPercent: 12, variants: [v('Ream of 500', 32000)] },
      { key: 'geometry-box', name: 'Geometry Box', category: 'School Essentials', unit: 'pcs', taxPercent: 18, variants: [v('Box', 12000)] },
    ],
  },
  restaurant: {
    label: 'Restaurant / Café',
    shopCategory: 'restaurant',
    // Cooked to order: stock is usually not counted, and nothing is kept for days.
    defaults: { lowStockThreshold: 0, taxPercent: 5, trackInventory: false, expiryAlertDays: 1 },
    categories: ['Starters', 'Main Course', 'Breads', 'Rice & Biryani', 'Desserts', 'Beverages'],
    products: [
      { key: 'paneer-tikka', name: 'Paneer Tikka', category: 'Starters', unit: 'plate', taxPercent: 5, variants: [v('Half', 18000), v('Full', 32000)] },
      { key: 'dal-makhani', name: 'Dal Makhani', category: 'Main Course', unit: 'plate', taxPercent: 5, variants: [v('Half', 16000), v('Full', 28000)] },
      { key: 'butter-naan', name: 'Butter Naan', category: 'Breads', unit: 'pcs', taxPercent: 5, variants: [v('Piece', 5000)] },
      { key: 'veg-biryani', name: 'Veg Biryani', category: 'Rice & Biryani', unit: 'plate', taxPercent: 5, variants: [v('Half', 15000), v('Full', 26000)] },
      { key: 'gulab-jamun', name: 'Gulab Jamun', category: 'Desserts', unit: 'pcs', taxPercent: 5, variants: [v('2 pieces', 8000)] },
      { key: 'masala-chai', name: 'Masala Chai', category: 'Beverages', unit: 'serving', taxPercent: 5, variants: [v('Cup', 3000)] },
    ],
  },
  general: {
    label: 'General Store',
    shopCategory: 'general',
    defaults: { lowStockThreshold: 5, taxPercent: 12, trackInventory: true, expiryAlertDays: 30 },
    categories: ['Daily Needs', 'Personal Care', 'Cleaning', 'Snacks & Drinks', 'Stationery'],
    products: [
      { key: 'milk-packet', name: 'Toned Milk', category: 'Daily Needs', unit: 'ml', taxPercent: 0, variants: [v('500 ml', 2800), v('1 litre', 5400)] },
      { key: 'eggs', name: 'Farm Eggs', category: 'Daily Needs', unit: 'dozen', taxPercent: 0, variants: [v('Half dozen', 4200), v('Dozen', 8000)] },
      { key: 'bath-soap', name: 'Bath Soap', category: 'Personal Care', unit: 'pcs', taxPercent: 18, variants: [v('Bar', 4000), v('Pack of 4', 15000)] },
      { key: 'toothpaste', name: 'Toothpaste', category: 'Personal Care', unit: 'g', taxPercent: 18, variants: [v('100 g', 6500, { weightGrams: 100 }), v('200 g', 12000, { weightGrams: 200 })] },
      { key: 'dishwash', name: 'Dishwash Liquid', category: 'Cleaning', unit: 'ml', taxPercent: 18, variants: [v('500 ml', 11000)] },
      { key: 'namkeen', name: 'Namkeen Mix', category: 'Snacks & Drinks', unit: 'g', taxPercent: 12, variants: [v('200 g', 5000, { weightGrams: 200 }), v('400 g', 9500, { weightGrams: 400 })] },
      { key: 'soft-drink', name: 'Soft Drink', category: 'Snacks & Drinks', unit: 'ml', taxPercent: 28, variants: [v('250 ml', 2000), v('750 ml', 4500)] },
      { key: 'notebook', name: 'Notebook', category: 'Stationery', unit: 'pcs', taxPercent: 12, variants: [v('100 pages', 4000)] },
    ],
  },
};

export const INDUSTRIES = Object.keys(INDUSTRY_TEMPLATES);

/** The summary list for the template picker. */
export const templateSummaries = () =>
  INDUSTRIES.map((key) => {
    const template = INDUSTRY_TEMPLATES[key];
    return {
      industry: key,
      label: template.label,
      categoryCount: template.categories.length,
      productCount: template.products.length,
      defaults: template.defaults,
    };
  });

/**
 * The template that matches a shop type (stores.shop_category), if any — used
 * to give a new store its starter categories. 'other' has none.
 */
export function templateForShopCategory(shopCategory) {
  const key = INDUSTRIES.find((industry) => INDUSTRY_TEMPLATES[industry].shopCategory === shopCategory);
  return key ? { industry: key, ...INDUSTRY_TEMPLATES[key] } : null;
}
