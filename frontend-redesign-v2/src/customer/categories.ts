import {
  Apple,
  Croissant,
  Pill,
  Lamp,
  Shirt,
  Smartphone,
  Puzzle,
  Hammer,
  Store as StoreIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * The customer directory's shop categories. Same grouping rules as the original
 * Home screen (shopCategory → directory category), plus a visual identity
 * (icon + tint pair) for the redesign.
 */
export type ShopCategoryId =
  | "groceries"
  | "food"
  | "health"
  | "home"
  | "fashion"
  | "electronics"
  | "kids"
  | "hardware";

export type ShopCategory = {
  id: ShopCategoryId;
  label: string;
  short: string;
  icon: LucideIcon;
  tint: string; // background tint class
  ink: string; // matching text class
};

export const SHOP_CATEGORIES: ShopCategory[] = [
  { id: "groceries", label: "Groceries", short: "Groceries", icon: Apple, tint: "bg-tint-grocery", ink: "text-tint-grocery-ink" },
  { id: "food", label: "Food and bakery", short: "Food & bakery", icon: Croissant, tint: "bg-tint-food", ink: "text-tint-food-ink" },
  { id: "health", label: "Health and pharmacy", short: "Pharmacy", icon: Pill, tint: "bg-tint-health", ink: "text-tint-health-ink" },
  { id: "home", label: "Home and household", short: "Household", icon: Lamp, tint: "bg-tint-home", ink: "text-tint-home-ink" },
  { id: "fashion", label: "Fashion and personal care", short: "Fashion & care", icon: Shirt, tint: "bg-tint-fashion", ink: "text-tint-fashion-ink" },
  { id: "electronics", label: "Electronics", short: "Electronics", icon: Smartphone, tint: "bg-tint-electronics", ink: "text-tint-electronics-ink" },
  { id: "kids", label: "Kids, books and hobbies", short: "Kids & hobbies", icon: Puzzle, tint: "bg-tint-kids", ink: "text-tint-kids-ink" },
  { id: "hardware", label: "Hardware and outdoors", short: "Hardware", icon: Hammer, tint: "bg-tint-hardware", ink: "text-tint-hardware-ink" },
];

const HARDWARE_PRODUCT_CATEGORIES = new Set(["tools-repair", "garden-outdoor"]);

export function categoryForStore(store: any): ShopCategoryId | null {
  switch (store?.shopCategory) {
    case "grocery":
      return "groceries";
    case "restaurant":
    case "bakery":
      return "food";
    case "pharmacy":
      return "health";
    case "clothing":
      return "fashion";
    case "electronics":
      return "electronics";
    case "other":
      return "kids";
    case "general":
      return store.productCategories?.some(({ slug }: { slug: string }) => HARDWARE_PRODUCT_CATEGORIES.has(slug))
        ? "hardware"
        : "home";
    default:
      return null;
  }
}

const FALLBACK: ShopCategory = {
  id: "home",
  label: "Shop",
  short: "Shop",
  icon: StoreIcon,
  tint: "bg-secondary",
  ink: "text-foreground",
};

export function visualForStore(store: any): ShopCategory {
  const id = categoryForStore(store);
  return SHOP_CATEGORIES.find((c) => c.id === id) ?? FALLBACK;
}

export function initials(name: string | null | undefined) {
  const words = String(name ?? "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  return (words[0]![0]! + (words[1]?.[0] ?? "")).toUpperCase();
}
