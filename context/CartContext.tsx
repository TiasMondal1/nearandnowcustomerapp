import AsyncStorage from "@react-native-async-storage/async-storage";
import { logSilentFailure } from "../lib/logSilentFailure";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";

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
  // Loose/weighed products (e.g. produce sold by weight) step in 0.25 kg
  // increments instead of whole units — matches the website cart and the
  // backend's own validateQuantity(), which now accepts fractional
  // quantities for these products.
  isLoose?: boolean;
};

export type Coupon = {
  id: string;
  code: string;
  type: "flat" | "percent";
  value: number;
  max_discount?: number;
  min_order_value?: number;
};

type CartContextType = {
  items: CartItem[];
  isHydrated: boolean;
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  incrementQty: (productId: string, delta: number) => void;
  clearCart: () => void;
  subtotal: number;

  appliedCoupon: Coupon | null;
  applyCoupon: (coupon: Coupon) => void;
  removeCoupon: () => void;
  discount: number;
  // False once the cart's subtotal drops below the applied coupon's own
  // min_order_value (e.g. after removing an item) — the coupon stays
  // "applied" so the customer can top the cart back up and reclaim it, but
  // discount is 0 and coupon_id is withheld from order placement while this
  // is false.
  isCouponEligible: boolean;
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
    AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)).catch((err) =>
      logSilentFailure("Persist cart", err),
    );
  }, [items, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    if (appliedCoupon) {
      AsyncStorage.setItem(
        COUPON_STORAGE_KEY,
        JSON.stringify(appliedCoupon),
      ).catch((err) => logSilentFailure("Persist applied coupon", err));
    } else {
      AsyncStorage.removeItem(COUPON_STORAGE_KEY).catch((err) =>
        logSilentFailure("Clear persisted coupon", err),
      );
    }
  }, [appliedCoupon, isHydrated]);

  // Handlers are intentionally wrapped in useCallback so consumers that depend on them via
  // useEffect/useMemo don't re-fire when unrelated cart state changes.
  const addItem = useCallback((product: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find((p) => p.product_id === product.product_id);
      const step = product.isLoose ? 0.25 : 1;
      if (existing) {
        if (existing.quantity >= MAX_QUANTITY_PER_ITEM) return prev;
        return prev.map((p) =>
          p.product_id === product.product_id
            ? { ...p, quantity: Math.round((p.quantity + step) * 100) / 100 }
            : p,
        );
      }
      return [...prev, { ...product, quantity: step }];
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

  // Unlike updateQty (which sets an absolute value the caller computed from
  // a render-time snapshot — safe for direct numeric input, but racy for
  // +/- steppers, where two taps landing before a re-render both compute
  // the same target from the same stale quantity), this reads the current
  // quantity from inside the setItems updater itself, so N rapid taps
  // always net exactly N regardless of React's batching/render timing.
  //
  // `direction` is a sign, not a magnitude — every call site passes ±1 to
  // mean "one step up/down." The actual step size (0.25 kg for loose
  // products, matching the website cart and the backend's own
  // validateQuantity(); 1 unit otherwise) is resolved here from the item's
  // own isLoose flag, so callers don't need to know or care about it.
  const incrementQty = useCallback((productId: string, direction: number) => {
    setItems((prev) => {
      const existing = prev.find((p) => p.product_id === productId);
      if (!existing) return prev;
      const step = existing.isLoose ? 0.25 : 1;
      const nextQty = existing.quantity + Math.sign(direction) * step;
      // Round off float drift from repeated 0.25 addition/subtraction.
      const rounded = Math.round(nextQty * 100) / 100;
      if (rounded <= 0) return prev.filter((p) => p.product_id !== productId);
      const clampedQty = Math.min(rounded, MAX_QUANTITY_PER_ITEM);
      return prev.map((p) =>
        p.product_id === productId ? { ...p, quantity: clampedQty } : p,
      );
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setAppliedCoupon(null);
  }, []);

  // Clears the cart on a genuine logout (true -> false transition only, not
  // on initial mount while auth is still restoring) — otherwise a shared/
  // reused device keeps showing the previous customer's cart to whoever
  // logs in next. CartProvider is rendered inside AuthProvider (see
  // app/_layout.tsx), so this is safe with no circular-dependency issue.
  const { isAuthenticated } = useAuth();
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
    } else if (wasAuthenticatedRef.current) {
      wasAuthenticatedRef.current = false;
      clearCart();
    }
  }, [isAuthenticated, clearCart]);

  const applyCoupon = useCallback((coupon: Coupon) => setAppliedCoupon(coupon), []);
  const removeCoupon = useCallback(() => setAppliedCoupon(null), []);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items],
  );

  const isCouponEligible = useMemo(() => {
    if (!appliedCoupon) return false;
    if (!appliedCoupon.min_order_value) return true;
    return subtotal >= appliedCoupon.min_order_value;
  }, [appliedCoupon, subtotal]);

  const discount = useMemo(() => {
    if (!appliedCoupon || !isCouponEligible) return 0;
    if (appliedCoupon.type === "flat") return Math.min(appliedCoupon.value, subtotal);
    if (appliedCoupon.type === "percent") {
      const raw = (subtotal * appliedCoupon.value) / 100;
      return appliedCoupon.max_discount
        ? Math.min(raw, appliedCoupon.max_discount)
        : raw;
    }
    return 0;
  }, [appliedCoupon, isCouponEligible, subtotal]);

  // Memoize the context value so downstream consumers only re-render when the *fields they
  // actually use* change (combined with React.memo on list items, this keeps cart taps cheap).
  const value = useMemo<CartContextType>(
    () => ({
      items,
      isHydrated,
      addItem,
      removeItem,
      updateQty,
      incrementQty,
      clearCart,
      subtotal,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      discount,
      isCouponEligible,
    }),
    [
      items,
      isHydrated,
      addItem,
      removeItem,
      updateQty,
      incrementQty,
      clearCart,
      subtotal,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      discount,
      isCouponEligible,
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
