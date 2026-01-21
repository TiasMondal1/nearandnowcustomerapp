// utils/groupCartByStore.ts
import { CartItem } from "../cart/CartContext";

export function groupCartByStore(items: CartItem[]) {
  const map: Record<string, CartItem[]> = {};

  items.forEach((item) => {
    if (!map[item.store_id]) {
      map[item.store_id] = [];
    }
    map[item.store_id].push(item);
  });

  return Object.entries(map).map(([store_id, items]) => ({
    store_id,
    items,
  }));
}
