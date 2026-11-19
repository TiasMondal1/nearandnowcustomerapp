// Bundled photo slots. Every file here has a row in assets/photos/CREDITS.md.
// Data only: `constants/banners.ts` imports `PhotoSlot` from here as a type.

export type PhotoSlot =
  | "bannerWelcome"
  | "bannerFresh"
  | "emptyOrders"
  | "feedEnd"
  | "orderPlaced"
  | "emptyCart"
  | "bannerReorder"
  | "bannerWallet"
  | "emptyCalm"
  | "emptyWishlist"
  | "aisleFruits"
  | "aisleVegetables"
  | "aisleDairy"
  | "aisleStaples"
  | "aisleSpices"
  | "aisleBakery"
  | "aisleBeverages"
  | "aisleEggs"
  | "headerCategories"
  | "promoSearch"
  | "promoAisles"
  | "welcome"
  | "reorderEnd"
  // Declared but unfilled today: the UI keeps its non-photo fallback.
  | "doorstep"
  | "kirana";

export type PhotoEntry = { source: number; alt: string };

export const PHOTOS: Partial<Record<PhotoSlot, PhotoEntry>> = {
  bannerWelcome: { source: require("../../assets/photos/banner-welcome.webp"), alt: "Fresh oranges with green leaves" },
  bannerFresh: { source: require("../../assets/photos/banner-fresh.webp"), alt: "Fresh tomatoes at a vegetable stall" },
  emptyOrders: { source: require("../../assets/photos/empty-orders.webp"), alt: "A basket of apples" },
  feedEnd: { source: require("../../assets/photos/feed-end.webp"), alt: "Vegetables at a market stall" },
  orderPlaced: { source: require("../../assets/photos/order-placed.webp"), alt: "A basket packed with fresh produce" },
  bannerReorder: { source: require("../../assets/photos/banner-reorder.webp"), alt: "A basket of oranges" },
  bannerWallet: { source: require("../../assets/photos/banner-wallet.webp"), alt: "A small green sprout" },
  emptyCart: { source: require("../../assets/photos/empty-cart.webp"), alt: "Garlic, potatoes and fresh coriander" },
  emptyCalm: { source: require("../../assets/photos/empty-calm.webp"), alt: "A small green sprout" },
  emptyWishlist: { source: require("../../assets/photos/empty-wishlist.webp"), alt: "Oranges and pineapples in a crate" },
  aisleFruits: { source: require("../../assets/photos/aisle-fruits.webp"), alt: "Cut oranges and pomegranates" },
  aisleVegetables: { source: require("../../assets/photos/aisle-vegetables.webp"), alt: "Fresh carrots" },
  aisleDairy: { source: require("../../assets/photos/aisle-dairy.webp"), alt: "Milk in a glass" },
  aisleStaples: { source: require("../../assets/photos/aisle-staples.webp"), alt: "Sacks of beans and pulses" },
  aisleSpices: { source: require("../../assets/photos/aisle-spices.webp"), alt: "Chilli and turmeric powders" },
  aisleBakery: { source: require("../../assets/photos/aisle-bakery.webp"), alt: "A round loaf of bread" },
  aisleBeverages: { source: require("../../assets/photos/aisle-beverages.webp"), alt: "Coffee beans" },
  aisleEggs: { source: require("../../assets/photos/aisle-eggs.webp"), alt: "Brown eggs in a carton" },
  headerCategories: { source: require("../../assets/photos/header-categories.webp"), alt: "Whole spices on a board" },
  promoSearch: { source: require("../../assets/photos/promo-search.webp"), alt: "Corn and pumpkin on a table" },
  promoAisles: { source: require("../../assets/photos/promo-aisles.webp"), alt: "Fresh herbs and a red pepper" },
  welcome: { source: require("../../assets/photos/welcome.webp"), alt: "Young green seedlings" },
  reorderEnd: { source: require("../../assets/photos/reorder-end.webp"), alt: "A loaf of bread with butter" },
};

/** True when a bundled photo exists for the slot. Call sites use it to keep their glyph fallback. */
export function hasPhoto(slot: PhotoSlot): boolean {
  return PHOTOS[slot] != null;
}
