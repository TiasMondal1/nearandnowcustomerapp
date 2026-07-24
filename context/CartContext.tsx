import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const CART_STORAGE_KEY = "nn_cart_items";
const COUPON_STORAGE_KEY = "nn_cart_coupon";

// Client-side ceiling only — the backend independently enforces each
// product's own master_products.min_quantity/max_quantity at order-creation
// time, which is the real security boundary. This is just so the cart itself
// can never be pushed to an absurd quantity in the UI.
const MAX_QUANTITY_PER_ITEM = 99;

export type CartItem = {
  product_id: string;
  name: string;
  price: number;
  unit?: string;
  image_url?: string;
  quantity: number;
};

export type Coupon = {
  id: string;
  code: string;
  type: "flat" | "percent";
  value: number;
  max_discount?: number;
};

type CartContextType = {
  items: CartItem[];
  isHydrated: boolean;
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  subtotal: number;

  appliedCoupon: Coupon | null;
  applyCoupon: (coupon: Coupon) => void;
  removeCoupon: () => void;
  discount: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedItems, savedCoupon] = await Promise.all([
          AsyncStorage.getItem(CART_STORAGE_KEY),
          AsyncStorage.getItem(COUPON_STORAGE_KEY),
        ]);
        if (savedItems) setItems(JSON.parse(savedItems));
        if (savedCoupon) setAppliedCoupon(JSON.parse(savedCoupon));
      } catch {
        /* cart hydration is best-effort */
      }
      setIsHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)).catch(() => {});
  }, [items, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    if (appliedCoupon) {
      AsyncStorage.setItem(
        COUPON_STORAGE_KEY,
        JSON.stringify(appliedCoupon),
      ).catch(() => {});
    } else {
      AsyncStorage.removeItem(COUPON_STORAGE_KEY).catch(() => {});
    }
  }, [appliedCoupon, isHydrated]);

  // Handlers are intentionally wrapped in useCallback so consumers that depend on them via
  // useEffect/useMemo don't re-fire when unrelated cart state changes.
  const addItem = useCallback((product: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find((p) => p.product_id === product.product_id);
      if (existing) {
        if (existing.quantity >= MAX_QUANTITY_PER_ITEM) return prev;
        return prev.map((p) =>
          p.product_id === product.product_id
            ? { ...p, quantity: p.quantity + 1 }
            : p,
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((p) => p.product_id !== productId));
  }, []);

  const updateQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((p) => p.product_id !== productId));
      return;
    }
    const clampedQty = Math.min(qty, MAX_QUANTITY_PER_ITEM);
    setItems((prev) =>
      prev.map((p) =>
        p.product_id === productId ? { ...p, quantity: clampedQty } : p,
      ),
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setAppliedCoupon(null);
  }, []);

  const applyCoupon = useCallback((coupon: Coupon) => setAppliedCoupon(coupon), []);
  const removeCoupon = useCallback(() => setAppliedCoupon(null), []);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items],
  );

  const discount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === "flat") return Math.min(appliedCoupon.value, subtotal);
    if (appliedCoupon.type === "percent") {
      const raw = (subtotal * appliedCoupon.value) / 100;
      return appliedCoupon.max_discount
        ? Math.min(raw, appliedCoupon.max_discount)
        : raw;
    }
    return 0;
  }, [appliedCoupon, subtotal]);

  // Memoize the context value so downstream consumers only re-render when the *fields they
  // actually use* change (combined with React.memo on list items, this keeps cart taps cheap).
  const value = useMemo<CartContextType>(
    () => ({
      items,
      isHydrated,
      addItem,
      removeItem,
      updateQty,
      clearCart,
      subtotal,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      discount,
    }),
    [
      items,
      isHydrated,
      addItem,
      removeItem,
      updateQty,
      clearCart,
      subtotal,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      discount,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}

/**
 * Lightweight selector hook: returns a Map of product_id → cart item. Consumers should
 * memoize their lookups against this to avoid scanning `items` in every list cell.
 */
export function useCartItemMap(): Map<string, CartItem> {
  const { items } = useCart();
  return useMemo(() => {
    const m = new Map<string, CartItem>();
    for (const it of items) m.set(it.product_id, it);
    return m;
  }, [items]);
}
