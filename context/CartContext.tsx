import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const CART_STORAGE_KEY = "nn_cart_items";
const COUPON_STORAGE_KEY = "nn_cart_coupon";

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
      } catch {}
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
      AsyncStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(appliedCoupon)).catch(() => {});
    } else {
      AsyncStorage.removeItem(COUPON_STORAGE_KEY).catch(() => {});
    }
  }, [appliedCoupon, isHydrated]);

  const addItem = (product: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find((p) => p.product_id === product.product_id);
      if (existing) {
        return prev.map((p) =>
          p.product_id === product.product_id
            ? { ...p, quantity: p.quantity + 1 }
            : p,
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeItem = (productId: string) => {
    setItems((prev) => prev.filter((p) => p.product_id !== productId));
  };

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      removeItem(productId);
      return;
    }
    setItems((prev) =>
      prev.map((p) =>
        p.product_id === productId ? { ...p, quantity: qty } : p,
      ),
    );
  };

  const clearCart = () => {
    setItems([]);
    setAppliedCoupon(null);
  };

  const applyCoupon = (coupon: Coupon) => setAppliedCoupon(coupon);
  const removeCoupon = () => setAppliedCoupon(null);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items],
  );

  const discount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === "flat") return Math.min(appliedCoupon.value, subtotal);
    if (appliedCoupon.type === "percent") {
      const raw = (subtotal * appliedCoupon.value) / 100;
      return appliedCoupon.max_discount ? Math.min(raw, appliedCoupon.max_discount) : raw;
    }
    return 0;
  }, [appliedCoupon, subtotal]);

  return (
    <CartContext.Provider
      value={{
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
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
