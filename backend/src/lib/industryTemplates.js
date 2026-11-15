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
      { key: 'milk', name: 'Toned Milk', category: 'Dairy & Eggs', unit: 'ml', taxPercent: 0, variants: [v('500 ml', 2800), v('1 litre', 5400)] },
      { key: 'eggs', name: 'Farm Eggs', category: 'Dairy & Eggs', unit: 'dozen', taxPercent: 0, variants: [v('Half dozen', 4200), v('Dozen', 8000)] },
      { key: 'sugar', name: 'Sugar', category: 'Rice & Grains', unit: 'kg', taxPercent: 5, variants: [v('1 kg', 4800, { weightGrams: 1000 }), v('5 kg', 23500, { weightGrams: 5000 })] },
      { key: 'salt', name: 'Iodised Salt', category: 'Spices', unit: 'kg', taxPercent: 0, variants: [v('1 kg', 2800, { weightGrams: 1000 })] },
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
    categories: ['Cakes', 'Breads', 'Cookies', 'Biscuits & Rusk', 'Dairy & Eggs', 'Snacks & Savouries', 'Sweets'],
    products: [
      { key: 'milk', name: 'Toned Milk', category: 'Dairy & Eggs', unit: 'ml', taxPercent: 0, variants: [v('500 ml', 2800), v('1 litre', 5400)] },
      { key: 'white-bread', name: 'White Bread', category: 'Breads', unit: 'pcs', taxPercent: 0, variants: [v('400 g loaf', 4500, { weightGrams: 400 })] },
      { key: 'brown-bread', name: 'Brown Bread', category: 'Breads', unit: 'pcs', taxPercent: 0, variants: [v('400 g loaf', 5500, { weightGrams: 400 })] },
      { key: 'pav', name: 'Ladi Pav', category: 'Breads', unit: 'pack', taxPercent: 0, variants: [v('Pack of 6', 3500)] },
      { key: 'black-forest', name: 'Black Forest Cake', category: 'Cakes', unit: 'kg', taxPercent: 18, variants: [v('500 g', 45000, { weightGrams: 500 }), v('1 kg', 85000, { weightGrams: 1000 })] },
      { key: 'glucose-biscuits', name: 'Glucose Biscuits', category: 'Biscuits & Rusk', unit: 'pack', taxPercent: 18, variants: [v('Small pack', 1000), v('Family pack', 3000)] },
      { key: 'rusk', name: 'Milk Rusk', category: 'Biscuits & Rusk', unit: 'g', taxPercent: 5, variants: [v('200 g', 4000, { weightGrams: 200 }), v('400 g', 7500, { weightGrams: 400 })] },
      { key: 'eggs', name: 'Farm Eggs', category: 'Dairy & Eggs', unit: 'dozen', taxPercent: 0, variants: [v('Half dozen', 4200), v('Dozen', 8000)] },
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
  dairy: {
    label: 'Dairy / Milk Booth',
    shopCategory: 'dairy',
    // Milk turns in a day or two: alert one day ahead.
    defaults: { lowStockThreshold: 10, taxPercent: 0, trackInventory: true, expiryAlertDays: 1 },
    categories: ['Milk', 'Curd & Buttermilk', 'Paneer & Cheese', 'Butter & Ghee', 'Eggs', 'Bread'],
    products: [
      { key: 'toned-milk', name: 'Toned Milk', category: 'Milk', unit: 'ml', taxPercent: 0, variants: [v('500 ml', 2800), v('1 litre', 5400)] },
      { key: 'full-cream-milk', name: 'Full Cream Milk', category: 'Milk', unit: 'ml', taxPercent: 0, variants: [v('500 ml', 3400), v('1 litre', 6600)] },
      { key: 'curd', name: 'Fresh Curd', category: 'Curd & Buttermilk', unit: 'g', taxPercent: 0, variants: [v('400 g', 3500, { weightGrams: 400 }), v('1 kg', 8000, { weightGrams: 1000 })] },
      { key: 'buttermilk', name: 'Buttermilk', category: 'Curd & Buttermilk', unit: 'ml', taxPercent: 0, variants: [v('200 ml', 1500)] },
      { key: 'paneer', name: 'Fresh Paneer', category: 'Paneer & Cheese', unit: 'g', taxPercent: 5, variants: [v('200 g', 9000, { weightGrams: 200 }), v('500 g', 21000, { weightGrams: 500 })] },
      { key: 'cheese-slices', name: 'Cheese Slices', category: 'Paneer & Cheese', unit: 'pack', taxPercent: 12, variants: [v('Pack of 10', 14500)] },
      { key: 'butter', name: 'Salted Butter', category: 'Butter & Ghee', unit: 'g', taxPercent: 12, variants: [v('100 g', 6000, { weightGrams: 100 }), v('500 g', 28000, { weightGrams: 500 })] },
      { key: 'ghee', name: 'Cow Ghee', category: 'Butter & Ghee', unit: 'ml', taxPercent: 12, variants: [v('500 ml', 35000), v('1 litre', 68000)] },
      { key: 'eggs', name: 'Farm Eggs', category: 'Eggs', unit: 'dozen', taxPercent: 0, variants: [v('Half dozen', 4200), v('Dozen', 8000)] },
      { key: 'bread', name: 'White Bread', category: 'Bread', unit: 'pcs', taxPercent: 0, variants: [v('400 g loaf', 4500, { weightGrams: 400 })] },
    ],
  },
  fruits_vegetables: {
    label: 'Fruits & Vegetables',
    shopCategory: 'fruits_vegetables',
    // Fresh produce: sold loose by weight, and it does not keep.
    defaults: { lowStockThreshold: 5, taxPercent: 0, trackInventory: true, expiryAlertDays: 2 },
    categories: ['Daily Vegetables', 'Leafy Greens', 'Fruits', 'Herbs & Seasonings'],
    products: [
      { key: 'onion', name: 'Onion', category: 'Daily Vegetables', unit: 'kg', taxPercent: 0, variants: [v('500 g', 2000, { weightGrams: 500 }), v('1 kg', 3800, { weightGrams: 1000 })] },
      { key: 'potato', name: 'Potato', category: 'Daily Vegetables', unit: 'kg', taxPercent: 0, variants: [v('500 g', 1500, { weightGrams: 500 }), v('1 kg', 2800, { weightGrams: 1000 })] },
      { key: 'tomato', name: 'Tomato', category: 'Daily Vegetables', unit: 'kg', taxPercent: 0, variants: [v('500 g', 2000, { weightGrams: 500 }), v('1 kg', 3800, { weightGrams: 1000 })] },
      { key: 'cauliflower', name: 'Cauliflower', category: 'Daily Vegetables', unit: 'pcs', taxPercent: 0, variants: [v('1 piece', 4000)] },
      { key: 'spinach', name: 'Spinach (Palak)', category: 'Leafy Greens', unit: 'pcs', taxPercent: 0, variants: [v('Bunch', 2000)] },
      { key: 'banana', name: 'Banana', category: 'Fruits', unit: 'dozen', taxPercent: 0, variants: [v('Half dozen', 3000), v('Dozen', 5500)] },
      { key: 'apple', name: 'Apple', category: 'Fruits', unit: 'kg', taxPercent: 0, variants: [v('500 g', 9000, { weightGrams: 500 }), v('1 kg', 17500, { weightGrams: 1000 })] },
      { key: 'coriander', name: 'Coriander Leaves', category: 'Herbs & Seasonings', unit: 'pcs', taxPercent: 0, variants: [v('Bunch', 1000)] },
      { key: 'green-chilli', name: 'Green Chilli', category: 'Herbs & Seasonings', unit: 'g', taxPercent: 0, variants: [v('100 g', 1000, { weightGrams: 100 }), v('250 g', 2200, { weightGrams: 250 })] },
      { key: 'ginger', name: 'Ginger', category: 'Herbs & Seasonings', unit: 'g', taxPercent: 0, variants: [v('100 g', 2000, { weightGrams: 100 }), v('250 g', 4500, { weightGrams: 250 })] },
    ],
  },
  meat_fish: {
    label: 'Meat, Fish & Eggs',
    shopCategory: 'meat_fish',
    // Fresh meat is sold the same day.
    defaults: { lowStockThreshold: 2, taxPercent: 0, trackInventory: true, expiryAlertDays: 1 },
    categories: ['Chicken', 'Mutton', 'Fish & Seafood', 'Eggs', 'Ready to Cook'],
    products: [
      { key: 'chicken-curry-cut', name: 'Chicken Curry Cut', category: 'Chicken', unit: 'kg', taxPercent: 0, variants: [v('500 g', 14000, { weightGrams: 500 }), v('1 kg', 26000, { weightGrams: 1000 })] },
      { key: 'chicken-boneless', name: 'Chicken Boneless', category: 'Chicken', unit: 'kg', taxPercent: 0, variants: [v('500 g', 19000, { weightGrams: 500 }), v('1 kg', 36000, { weightGrams: 1000 })] },
      { key: 'mutton-curry-cut', name: 'Mutton Curry Cut', category: 'Mutton', unit: 'kg', taxPercent: 0, variants: [v('500 g', 42000, { weightGrams: 500 }), v('1 kg', 80000, { weightGrams: 1000 })] },
      { key: 'rohu', name: 'Rohu Fish', category: 'Fish & Seafood', unit: 'kg', taxPercent: 0, variants: [v('500 g', 14000, { weightGrams: 500 }), v('1 kg', 26000, { weightGrams: 1000 })] },
      { key: 'prawns', name: 'Prawns (Cleaned)', category: 'Fish & Seafood', unit: 'kg', taxPercent: 0, variants: [v('250 g', 18000, { weightGrams: 250 }), v('500 g', 34000, { weightGrams: 500 })] },
      { key: 'eggs', name: 'Farm Eggs', category: 'Eggs', unit: 'dozen', taxPercent: 0, variants: [v('Half dozen', 4200), v('Dozen', 8000), v('Tray of 30', 19500)] },
      { key: 'chicken-seekh', name: 'Chicken Seekh Kebab', category: 'Ready to Cook', unit: 'pack', taxPercent: 5, variants: [v('Pack of 6', 22000)] },
    ],
  },
  hardware: {
    label: 'Hardware & Paints',
    shopCategory: 'hardware',
    // Nothing expires; small parts sell by the piece and the pack.
    defaults: { lowStockThreshold: 5, taxPercent: 18, trackInventory: true, expiryAlertDays: 0 },
    categories: ['Hand Tools', 'Fasteners', 'Electrical', 'Plumbing', 'Paints & Supplies', 'Adhesives & Tapes'],
    products: [
      { key: 'hammer', name: 'Claw Hammer', category: 'Hand Tools', unit: 'pcs', taxPercent: 18, variants: [v('250 g', 25000), v('500 g', 38000)] },
      { key: 'screwdriver-set', name: 'Screwdriver Set', category: 'Hand Tools', unit: 'set', taxPercent: 18, variants: [v('6 pieces', 29900)] },
      { key: 'measuring-tape', name: 'Measuring Tape', category: 'Hand Tools', unit: 'pcs', taxPercent: 18, variants: [v('3 m', 15000), v('5 m', 22000)] },
      { key: 'wood-screws', name: 'Wood Screws', category: 'Fasteners', unit: 'pack', taxPercent: 18, variants: [v('Pack of 50', 8000), v('Pack of 100', 15000)] },
      { key: 'wire-nails', name: 'Wire Nails', category: 'Fasteners', unit: 'kg', taxPercent: 18, variants: [v('500 g', 6000, { weightGrams: 500 }), v('1 kg', 11000, { weightGrams: 1000 })] },
      { key: 'insulation-tape', name: 'PVC Insulation Tape', category: 'Electrical', unit: 'roll', taxPercent: 18, variants: [v('Roll', 2500)] },
      { key: 'switch-6a', name: 'Modular Switch 6 A', category: 'Electrical', unit: 'pcs', taxPercent: 18, variants: [v('Piece', 6500)] },
      { key: 'pvc-pipe', name: 'PVC Pipe ½"', category: 'Plumbing', unit: 'pcs', taxPercent: 18, variants: [v('3 m length', 18000)] },
      { key: 'teflon-tape', name: 'Teflon Tape', category: 'Plumbing', unit: 'roll', taxPercent: 18, variants: [v('Roll', 2000)] },
      { key: 'wall-paint', name: 'Interior Wall Paint (White)', category: 'Paints & Supplies', unit: 'l', taxPercent: 18, variants: [v('1 litre', 38000), v('4 litre', 140000)] },
      { key: 'paint-brush', name: 'Paint Brush', category: 'Paints & Supplies', unit: 'pcs', taxPercent: 18, variants: [v('2 inch', 9000), v('4 inch', 16000)] },
      { key: 'fevicol', name: 'White Wood Glue', category: 'Adhesives & Tapes', unit: 'g', taxPercent: 18, variants: [v('250 g', 9000, { weightGrams: 250 }), v('1 kg', 32000, { weightGrams: 1000 })] },
    ],
  },
  home_kitchen: {
    label: 'Home & Kitchen',
    shopCategory: 'home_kitchen',
    defaults: { lowStockThreshold: 3, taxPercent: 18, trackInventory: true, expiryAlertDays: 0 },
    categories: ['Cookware', 'Storage', 'Kitchen Tools', 'Cleaning Supplies', 'Home Decor'],
    products: [
      { key: 'pressure-cooker', name: 'Pressure Cooker', category: 'Cookware', unit: 'pcs', taxPercent: 12, variants: [v('3 litre', 149900), v('5 litre', 199900)] },
      { key: 'kadai', name: 'Iron Kadai', category: 'Cookware', unit: 'pcs', taxPercent: 12, variants: [v('Medium', 69900)] },
      { key: 'steel-containers', name: 'Steel Containers', category: 'Storage', unit: 'set', taxPercent: 18, variants: [v('Set of 3', 59900)] },
      { key: 'water-bottle', name: 'Steel Water Bottle', category: 'Storage', unit: 'pcs', taxPercent: 18, variants: [v('750 ml', 39900), v('1 litre', 49900)] },
      { key: 'knife', name: 'Kitchen Knife', category: 'Kitchen Tools', unit: 'pcs', taxPercent: 18, variants: [v('Piece', 19900)] },
      { key: 'chopping-board', name: 'Chopping Board', category: 'Kitchen Tools', unit: 'pcs', taxPercent: 18, variants: [v('Piece', 24900)] },
      { key: 'broom', name: 'Soft Broom', category: 'Cleaning Supplies', unit: 'pcs', taxPercent: 5, variants: [v('Piece', 15000)] },
      { key: 'mop', name: 'Floor Mop', category: 'Cleaning Supplies', unit: 'pcs', taxPercent: 18, variants: [v('Piece', 34900)] },
      { key: 'scrub-pad', name: 'Scrub Pads', category: 'Cleaning Supplies', unit: 'pack', taxPercent: 18, variants: [v('Pack of 3', 5000)] },
      { key: 'candles', name: 'Decorative Candles', category: 'Home Decor', unit: 'pack', taxPercent: 12, variants: [v('Pack of 6', 19900)] },
    ],
  },
  beauty: {
    label: 'Beauty & Cosmetics',
    shopCategory: 'beauty',
    // Cosmetics carry a shelf life of a year or more.
    defaults: { lowStockThreshold: 3, taxPercent: 18, trackInventory: true, expiryAlertDays: 60 },
    categories: ['Skin Care', 'Hair Care', 'Makeup', 'Fragrance', 'Men’s Grooming'],
    products: [
      { key: 'face-wash', name: 'Face Wash', category: 'Skin Care', unit: 'ml', taxPercent: 18, variants: [v('50 ml', 9900), v('100 ml', 17900)] },
      { key: 'moisturiser', name: 'Moisturising Cream', category: 'Skin Care', unit: 'ml', taxPercent: 18, variants: [v('50 ml', 19900)] },
      { key: 'sunscreen', name: 'Sunscreen SPF 50', category: 'Skin Care', unit: 'ml', taxPercent: 18, variants: [v('50 ml', 34900)] },
      { key: 'shampoo', name: 'Shampoo', category: 'Hair Care', unit: 'ml', taxPercent: 18, variants: [v('180 ml', 19900), v('340 ml', 34900)] },
      { key: 'hair-oil', name: 'Coconut Hair Oil', category: 'Hair Care', unit: 'ml', taxPercent: 18, variants: [v('200 ml', 11000), v('500 ml', 24000)] },
      { key: 'kajal', name: 'Kajal', category: 'Makeup', unit: 'pcs', taxPercent: 18, variants: [v('Stick', 19900)] },
      { key: 'lipstick', name: 'Matte Lipstick', category: 'Makeup', unit: 'pcs', taxPercent: 18, variants: [v('Red', 29900), v('Nude', 29900), v('Pink', 29900)] },
      { key: 'deodorant', name: 'Deodorant Spray', category: 'Fragrance', unit: 'ml', taxPercent: 18, variants: [v('150 ml', 24900)] },
      { key: 'shaving-cream', name: 'Shaving Cream', category: 'Men’s Grooming', unit: 'g', taxPercent: 18, variants: [v('70 g', 9000, { weightGrams: 70 })] },
    ],
  },
  footwear: {
    label: 'Footwear',
    shopCategory: 'footwear',
    // Sizes run out; nothing expires.
    defaults: { lowStockThreshold: 2, taxPercent: 12, trackInventory: true, expiryAlertDays: 0 },
    categories: ["Men's Footwear", "Women's Footwear", "Kids' Footwear", 'Slippers & Sandals', 'Socks & Care'],
    products: [
      { key: 'mens-formal', name: "Men's Formal Shoes", category: "Men's Footwear", unit: 'pair', taxPercent: 12, variants: [v('UK 7', 149900), v('UK 8', 149900), v('UK 9', 149900), v('UK 10', 149900)] },
      { key: 'sports-shoes', name: 'Sports Shoes', category: "Men's Footwear", unit: 'pair', taxPercent: 12, variants: [v('UK 7', 129900), v('UK 8', 129900), v('UK 9', 129900)] },
      { key: 'womens-flats', name: "Women's Flats", category: "Women's Footwear", unit: 'pair', taxPercent: 12, variants: [v('UK 4', 79900), v('UK 5', 79900), v('UK 6', 79900)] },
      { key: 'school-shoes', name: 'School Shoes', category: "Kids' Footwear", unit: 'pair', taxPercent: 12, variants: [v('Size 10', 59900), v('Size 12', 64900), v('Size 1', 69900)] },
      { key: 'flip-flops', name: 'Flip-flops', category: 'Slippers & Sandals', unit: 'pair', taxPercent: 5, variants: [v('UK 7', 19900), v('UK 8', 19900), v('UK 9', 19900)] },
      { key: 'shoe-polish', name: 'Shoe Polish', category: 'Socks & Care', unit: 'pcs', taxPercent: 18, variants: [v('Black', 6000), v('Brown', 6000)] },
    ],
  },
  toys_gifts: {
    label: 'Toys & Gifts',
    shopCategory: 'toys_gifts',
    defaults: { lowStockThreshold: 2, taxPercent: 12, trackInventory: true, expiryAlertDays: 0 },
    categories: ['Toys', 'Games & Puzzles', 'Gift Items', 'Party Supplies', 'Greeting Cards & Wrap'],
    products: [
      { key: 'soft-toy', name: 'Teddy Bear', category: 'Toys', unit: 'pcs', taxPercent: 12, variants: [v('Small', 39900), v('Large', 89900)] },
      { key: 'toy-car', name: 'Pull-back Toy Car', category: 'Toys', unit: 'pcs', taxPercent: 12, variants: [v('Piece', 19900)] },
      { key: 'jigsaw', name: 'Jigsaw Puzzle', category: 'Games & Puzzles', unit: 'box', taxPercent: 12, variants: [v('100 pieces', 29900), v('500 pieces', 59900)] },
      { key: 'board-game', name: 'Ludo & Snakes Board', category: 'Games & Puzzles', unit: 'pcs', taxPercent: 12, variants: [v('Board', 14900)] },
      { key: 'photo-frame', name: 'Photo Frame', category: 'Gift Items', unit: 'pcs', taxPercent: 12, variants: [v('5 × 7 in', 24900), v('8 × 10 in', 39900)] },
      { key: 'coffee-mug', name: 'Printed Coffee Mug', category: 'Gift Items', unit: 'pcs', taxPercent: 12, variants: [v('Mug', 29900)] },
      { key: 'balloons', name: 'Balloons', category: 'Party Supplies', unit: 'pack', taxPercent: 18, variants: [v('Pack of 25', 9900)] },
      { key: 'birthday-candles', name: 'Birthday Candles', category: 'Party Supplies', unit: 'pack', taxPercent: 12, variants: [v('Pack of 12', 4000)] },
      { key: 'gift-wrap', name: 'Gift Wrapping Paper', category: 'Greeting Cards & Wrap', unit: 'pcs', taxPercent: 12, variants: [v('Sheet', 2000)] },
      { key: 'greeting-card', name: 'Greeting Card', category: 'Greeting Cards & Wrap', unit: 'pcs', taxPercent: 12, variants: [v('Card', 9900)] },
    ],
  },
  pet_supplies: {
    label: 'Pet Supplies',
    shopCategory: 'pet_supplies',
    // Pet food carries an expiry; alert a month ahead.
    defaults: { lowStockThreshold: 3, taxPercent: 18, trackInventory: true, expiryAlertDays: 30 },
    categories: ['Dog Food', 'Cat Food', 'Treats', 'Grooming', 'Accessories'],
    products: [
      { key: 'dog-food-adult', name: 'Dog Food (Adult)', category: 'Dog Food', unit: 'kg', taxPercent: 18, variants: [v('1 kg', 32000, { weightGrams: 1000 }), v('3 kg', 89900, { weightGrams: 3000 })] },
      { key: 'puppy-food', name: 'Puppy Food', category: 'Dog Food', unit: 'kg', taxPercent: 18, variants: [v('1 kg', 36000, { weightGrams: 1000 })] },
      { key: 'cat-food', name: 'Cat Food (Dry)', category: 'Cat Food', unit: 'kg', taxPercent: 18, variants: [v('1 kg', 42000, { weightGrams: 1000 })] },
      { key: 'dog-biscuits', name: 'Dog Biscuits', category: 'Treats', unit: 'g', taxPercent: 18, variants: [v('500 g', 22000, { weightGrams: 500 })] },
      { key: 'pet-shampoo', name: 'Pet Shampoo', category: 'Grooming', unit: 'ml', taxPercent: 18, variants: [v('200 ml', 29900)] },
      { key: 'pet-collar', name: 'Pet Collar', category: 'Accessories', unit: 'pcs', taxPercent: 18, variants: [v('Small', 19900), v('Medium', 24900), v('Large', 29900)] },
      { key: 'food-bowl', name: 'Steel Food Bowl', category: 'Accessories', unit: 'pcs', taxPercent: 18, variants: [v('Medium', 24900)] },
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
