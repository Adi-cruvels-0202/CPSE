-- More kinds of shop, each with its own starter categories and products
-- (src/lib/industryTemplates.js). Adding enum values is additive: existing
-- stores keep their type.
alter type shop_category add value if not exists 'dairy';
alter type shop_category add value if not exists 'fruits_vegetables';
alter type shop_category add value if not exists 'meat_fish';
alter type shop_category add value if not exists 'hardware';
alter type shop_category add value if not exists 'home_kitchen';
alter type shop_category add value if not exists 'beauty';
alter type shop_category add value if not exists 'footwear';
alter type shop_category add value if not exists 'toys_gifts';
alter type shop_category add value if not exists 'pet_supplies';
