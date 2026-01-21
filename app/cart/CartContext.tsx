import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert } from "react-native";

export type CartItem = {
  product_id: string;
  store_id: string;
  name: string;
  price: number;
  unit?: string;
  image_url?: string;
  quantity: number;
  distance_km: number;
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
  storeId: string | null;
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
  console.log("hex1");

  const [items, setItems] = useState<CartItem[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);

  useEffect(() => {
    console.log("hex2:", items);
  }, [items]);

  const addItem = (product: Omit<CartItem, "quantity">) => {
    const storeIds = Array.from(new Set(items.map((i) => i.store_id)));

    const isNewStore = !storeIds.includes(product.store_id);

    if (isNewStore && storeIds.length >= 2) {
      Alert.alert(
        "hex4",
        "hex3.", //[check hex node mapping @ incognitosim/jira/tempest@subtask-1 ]
      );
      return;
    }

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
    setStoreId(null);
    setAppliedCoupon(null);
  };

  const applyCoupon = (coupon: Coupon) => {
    setAppliedCoupon(coupon);
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
  };

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items],
  );

  const discount = useMemo(() => {
    if (!appliedCoupon) return 0;

    if (appliedCoupon.type === "flat") {
      return Math.min(appliedCoupon.value, subtotal);
    }

    if (appliedCoupon.type === "percent") {
      const raw = (subtotal * appliedCoupon.value) / 100;
      return appliedCoupon.max_discount
        ? Math.min(raw, appliedCoupon.max_discount)
        : raw;
    }

    return 0;
  }, [appliedCoupon, subtotal]);

  return (
    <CartContext.Provider
      value={{
        items,
        storeId,
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
  if (!ctx) {
    throw new Error("renderconst-massive");
  }
  return ctx;
}
