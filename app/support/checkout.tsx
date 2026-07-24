import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    LayoutAnimation,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PaymentProcessingOverlay } from "../../components/PaymentProcessingOverlay";
import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { usePaymentFlow } from "../../hooks/usePaymentFlow";
import { getBatchProductStoreDistances } from "../../lib/distanceUtils";
import { cdnImage } from "../../lib/imageUrl";
import { markOrderPlaced } from "../../lib/orderHistoryFlag";
import { createOrder, type Order } from "../../lib/orderService";
import {
    getPaymentSelection,
    subscribePaymentSelection,
    type PaymentSelection,
} from "../../lib/paymentSelection";
import {
    getAllProducts,
    getMemoryHomeCache,
    type Product,
} from "../../lib/productService";
import { clearSavedPaymentMethodsCache } from "../../lib/razorpayService";

export default function CheckoutScreen() {
  const { items, appliedCoupon, removeCoupon, discount, clearCart, addItem, updateQty } = useCart();
  const { user, customer } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [placing, setPlacing] = useState(false);
  // Synchronous lock, checked/set before any React re-render — `placing` state
  // alone isn't enough to stop a fast double-tap, since the button doesn't
  // actually re-render as disabled until after the first tap's state update
  // commits, leaving a window where a second tap can still fire placeOrder().
  const placingRef = useRef(false);
  const { location } = useLocation();
  const [maxDistance, setMaxDistance] = useState<number>(2);
  const [loadingDistance, setLoadingDistance] = useState(false);

  const [gstinClaim, setGstinClaim] = useState(false);
  const [gstin, setGstin] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [tipPreset, setTipPreset] = useState<10 | 20 | 30 | 50 | "custom" | null>(null);
  const [customTip, setCustomTip] = useState("");

  // Who is this order for? Captured here (not on the saved address) so the
  // same address can serve both self-delivery and "ordering for someone else".
  const [orderFor, setOrderFor] = useState<"self" | "others">("self");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverAddress, setReceiverAddress] = useState("");

  // Seed recommended from the already-warm home cache so the "Did you forget?"
  // strip paints on frame 1 instead of waiting on a network round-trip. Falls
  // back to an async fetch only if the cache is empty.
  const [recommended, setRecommended] = useState<Product[]>(() => {
    const cache = getMemoryHomeCache();
    if (!cache) return [];
    const flat: Product[] = [];
    for (const arr of Object.values(cache.productsByCategory)) flat.push(...arr);
    return flat.slice(0, 9);
  });

  // NOTE: we intentionally do NOT hold the payment selection in React state
  // on this screen. Subscribing here would re-render the entire (large)
  // checkout tree every time the user picks a payment method, which was
  // causing a visible hang when returning from the payment-options page.
  // Instead, the small `<PayMethodRow>` component near the bottom of this
  // file subscribes on its own and re-renders in isolation, and the
  // placeOrder handler reads the latest selection synchronously via
  // `getPaymentSelection()`.
  const { phase: paymentPhase, payForOrder, RazorpayUI } = usePaymentFlow();

  const successAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (showSuccess) {
      Animated.spring(successAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 8,
      }).start();
    } else {
      successAnim.setValue(0);
    }
  }, [showSuccess]);

  useEffect(() => {
    if (!location || items.length === 0) {
      setMaxDistance(2);
      return;
    }
    const calculateMaxDistance = async () => {
      setLoadingDistance(true);
      try {
        // Single batched query instead of one DB round-trip per cart item.
        const distances = await getBatchProductStoreDistances(
          items.map((item) => item.product_id),
          location.latitude,
          location.longitude,
        );
        const max = Math.max(...distances);
        setMaxDistance(Math.min(max, 4));
      } catch {
        setMaxDistance(2);
      } finally {
        setLoadingDistance(false);
      }
    };
    calculateMaxDistance();
  }, [location, items]);

  useEffect(() => {
    // Kick off scoring immediately. We no longer gate on `location` being
    // ready — the user already picked items, so we have everything we need to
    // render a sensible "Did you forget?" strip on frame 1. If the memory
    // cache from the home screen is warm we skip the network entirely; if
    // not, we fall back to a single round-trip while the rest of the page
    // stays interactive.
    const loadRecommended = async () => {
      if (items.length === 0) {
        setRecommended([]);
        return;
      }
      try {
        const cache = getMemoryHomeCache();
        let allProducts: Product[];
        if (cache) {
          const flat: Product[] = [];
          for (const arr of Object.values(cache.productsByCategory)) flat.push(...arr);
          allProducts = flat;
        } else {
          allProducts = await getAllProducts();
        }
        const cartIds = new Set(items.map((i) => i.product_id));

        // Get cart products with their details
        const cartProducts = allProducts.filter((p) => cartIds.has(p.id));

        // Extract categories from cart items, weighted by quantity
        const categoryWeights = new Map<string, number>();
        cartProducts.forEach((product) => {
          const cartItem = items.find((i) => i.product_id === product.id);
          const weight = cartItem ? cartItem.quantity : 1;
          if (product.category) {
            categoryWeights.set(product.category, (categoryWeights.get(product.category) || 0) + weight);
          }
        });

        // Sort categories by weight (most frequently purchased)
        const sortedCategories = Array.from(categoryWeights.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([category]) => category);

        // Get products not in cart
        const availableProducts = allProducts.filter((p) => !cartIds.has(p.id));

        // Score products based on:
        // 1. Same category as cart items (higher score for categories with more weight)
        // 2. Similar price range to cart items
        // 3. In stock
        // 4. Good ratings
        const cartAvgPrice = cartProducts.length > 0
          ? cartProducts.reduce((sum, p) => {
              const cartItem = items.find((i) => i.product_id === p.id);
              const quantity = cartItem ? cartItem.quantity : 1;
              return sum + (p.price * quantity);
            }, 0) / items.reduce((sum, i) => sum + i.quantity, 0)
          : 0;

        const scoredProducts = availableProducts
          .filter((p) => p.in_stock)
          .map((product) => {
            let score = 0;

            // Category matching (highest priority)
            if (product.category && sortedCategories.includes(product.category)) {
              const categoryIndex = sortedCategories.indexOf(product.category);
              const categoryWeight = categoryWeights.get(product.category) || 0;
              score += (sortedCategories.length - categoryIndex) * 10 + categoryWeight * 2;
            }

            // Price similarity (moderate priority)
            if (cartAvgPrice > 0) {
              const priceDiff = Math.abs(product.price - cartAvgPrice);
              const priceSimilarity = Math.max(0, 1 - priceDiff / cartAvgPrice);
              score += priceSimilarity * 5;
            }

            // Rating bonus (low priority)
            if (product.avgRating) {
              score += product.avgRating * 2;
            }

            // Review count bonus
            if (product.reviewCount) {
              score += Math.min(product.reviewCount / 10, 3);
            }

            return { product, score };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 9)
          .map(({ product }) => product);

        setRecommended(scoredProducts);
      } catch {
        // Keep whatever we seeded from the cache; better than a jarring empty strip.
      }
    };
    loadRecommended();
  }, [items, location]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const totalItems = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const { platformFee, handlingFee, deliveryFee, gst, projected } = useMemo(
    () => calcOrderTotal(subtotal, totalItems, maxDistance),
    [subtotal, totalItems, maxDistance],
  );
  const baseFinalPayable = useMemo(() => Math.max(projected - discount, 0), [projected, discount]);

  const tipAmount = useMemo(() => {
    if (!tipPreset) return 0;
    if (tipPreset === "custom") {
      const val = parseFloat(customTip.replace(/[^0-9.]/g, ""));
      if (Number.isNaN(val) || !Number.isFinite(val)) return 0;
      return Math.max(val, 0);
    }
    return tipPreset;
  }, [tipPreset, customTip]);

  const finalPayable = useMemo(() => baseFinalPayable + tipAmount, [baseFinalPayable, tipAmount]);

  /**
   * Creates the internal `customer_orders` row via the backend.
   *
   * Two callers:
   *   - COD path: uses the optimistic flag so the success UI fires *immediately*
   *     and the network call runs in the background.
   *   - Online path: cannot be optimistic (we must show the Razorpay sheet first
   *     and only show success after `verifyPayment` returns), so it passes
   *     `optimistic = false` and awaits the real Order back.
   */
  const doCreateOrder = async (
    paymentStatus: "pending" | "paid",
    options: { optimistic?: boolean } = {},
  ): Promise<Order | undefined> => {
    if (!user?.id || !location) return undefined;
    const notesParts: string[] = [];
    if (gstinClaim && gstin.trim()) {
      notesParts.push(
        `GSTIN: ${gstin.trim()}${invoiceName ? ` (Name: ${invoiceName.trim()})` : ""}`,
      );
    }
    if (deliveryInstructions.trim()) {
      notesParts.push(`Delivery Instructions: ${deliveryInstructions.trim()}`);
    }
    if (orderFor === "others") {
      const rxParts: string[] = [];
      if (receiverName.trim()) rxParts.push(receiverName.trim());
      if (receiverPhone.trim()) rxParts.push(`+91${receiverPhone.trim()}`);
      if (receiverAddress.trim()) rxParts.push(receiverAddress.trim());
      if (rxParts.length) {
        notesParts.push(`Deliver to: ${rxParts.join(" | ")}`);
      }
    }
    if (tipAmount > 0) notesParts.push(`Tip for delivery partner: ₹${tipAmount.toFixed(2)}`);

    const sel = getPaymentSelection();
    const orderPayload = {
      user_id: user.id,
      customer_name: user.name || "Customer",
      customer_phone: user.phone || customer?.phone || "",
      customer_email: user.email || undefined,
      payment_method: sel.mode,
      payment_status: paymentStatus,
      subtotal,
      delivery_fee: deliveryFee,
      order_total: Math.round(finalPayable),
      delivery_address: location.address ?? location.label ?? "",
      delivery_latitude: location.latitude,
      delivery_longitude: location.longitude,
      items: items.map((i) => ({
        product_id: i.product_id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        image: i.image_url,
        unit: i.unit,
      })),
      notes: notesParts.length ? notesParts.join(" | ") : undefined,
      gstin: gstinClaim && gstin.trim() ? gstin.trim() : undefined,
      tip_amount: tipAmount > 0 ? tipAmount : undefined,
      coupon_id: appliedCoupon?.id,
    };

    if (options.optimistic) {
      // COD path — navigate to confirmation page after order is created.
      try {
        const created = await createOrder(orderPayload);
        // Flip the "has placed an order" flag so the Preferred Payment card
        // on the payment-options screen unlocks on the NEXT checkout flow.
        // Fire-and-forget; failing to persist this is non-fatal.
        markOrderPlaced().catch(() => {});
        // Navigate to order confirmation page with 40-second add-more window
        // Cart is NOT cleared here - user can add more items during the window
        router.replace(`/order/confirmation/${created.id}` as any);
        return created;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Something went wrong placing your order.";
        if (message.toLowerCase().includes("verify your email")) {
          Alert.alert("Email verification required", message, [
            { text: "Verify Now", onPress: () => router.push("/settings/profile") },
            { text: "Cancel", style: "cancel" },
          ]);
        } else {
          Alert.alert("Order failed", `${message}\n\nYour cart is safe — please try again.`);
        }
        throw err;
      }
    }

    // Online path — caller awaits the real Order so it can pass `id` to Razorpay.
    return createOrder(orderPayload);
  };

  const placeOrder = async () => {
    if (placingRef.current) return;
    if (!location) {
      Alert.alert("No location", "Please select a delivery location.");
      return;
    }
    if (items.length === 0) {
      Alert.alert("Empty cart", "Add items to your cart before checking out.");
      return;
    }
    if (!user?.id) {
      Alert.alert("Session expired", "Please login again.");
      return;
    }
    if (orderFor === "others") {
      if (!receiverName.trim()) {
        Alert.alert("Missing details", "Please enter the receiver's name.");
        return;
      }
      if (receiverPhone.trim().length !== 10) {
        Alert.alert(
          "Invalid phone",
          "Please enter a valid 10-digit mobile number for the receiver.",
        );
        return;
      }
    }
    placingRef.current = true;
    setPlacing(true);
    try {
      const currentSelection = getPaymentSelection();
      if (currentSelection.mode === "cod") {
        // Optimistic flow: success modal renders before the API call returns.
        await doCreateOrder("pending", { optimistic: true });
        return;
      }

      // ─── Online payment (Razorpay) ────────────────────────────────────────
      // Mirrors near-and-now/frontend/src/pages/CheckoutPage.tsx exactly:
      //   1. Create the internal customer_orders row with payment_status='pending'.
      //   2. Hand off to usePaymentFlow.payForOrder, which:
      //      a. POSTs /api/payment/create  (backend uses DB amount as truth)
      //      b. Opens the Razorpay sheet
      //      c. POSTs /api/payment/verify with the signature
      //      d. If verify hiccups, polls the DB for ~10s in case the webhook lands first
      // The processing overlay is driven by `paymentPhase`, so the user always
      // sees clear "Setting up… / Verifying… / Confirming with bank…" states
      // instead of a frozen-looking checkout screen.

      const internalOrder = await doCreateOrder("pending");
      if (!internalOrder?.id) {
        throw new Error("Could not create order");
      }

      const result = await payForOrder({
        internalOrderId: internalOrder.id,
        amount: finalPayable,
        customer: {
          name: user.name || "Customer",
          email: user.email || undefined,
          phone: user.phone || customer?.phone || undefined,
        },
        // Honour the rail the user chose on the payment-options screen so
        // the Razorpay sheet lands on that tab (UPI / Card / Wallet /
        // Netbanking). EMI isn't used by our checkout, so filter it out.
        preferredMethod:
          currentSelection.method && currentSelection.method !== "emi"
            ? currentSelection.method
            : undefined,
      });

      if (result.status === "paid") {
        // Flip the "has placed an order" flag so the Preferred Payment card
        // on the payment-options screen unlocks on the NEXT checkout flow.
        markOrderPlaced().catch(() => {});
        // Bust the saved-methods cache so the token Razorpay just minted
        // for this payment shows up on the very next visit to the
        // payment-options screen (instead of the stale empty cache).
        clearSavedPaymentMethodsCache();
        // Navigate to order confirmation page with 40-second add-more window
        router.replace(`/order/confirmation/${internalOrder.id}` as any);
        return;
      }

      // Anything other than 'paid' means the order is saved but payment isn't
      // confirmed. Clear the cart (order is in DB, customer can pay from
      // Orders) and route them there with a message tuned to the failure mode.
      clearCart();

      if (result.status === "error") {
        Alert.alert(
          "Payment unavailable",
          `${result.message}\n\nYour order has been saved. You can retry payment from your Orders.`,
        );
        router.replace("/orders");
        return;
      }

      // status === 'pending'
      const titleByReason = {
        cancelled: "Payment cancelled",
        failed: "Payment failed",
        verify_failed: "Payment not confirmed",
        unverified: "Payment not confirmed",
      } as const;
      const messageByReason = {
        cancelled:
          "Your order has been saved. You can complete payment anytime from your Orders.",
        failed:
          (result.message ?? "Payment could not be completed.") +
          "\n\nYour order has been saved — retry from your Orders.",
        verify_failed:
          (result.message ?? "Payment could not be verified.") +
          "\n\nIf money was debited it will reflect shortly, or auto-refund within 5–7 days.",
        unverified:
          result.message ??
          "We could not confirm your payment yet. Please check Orders in a minute.",
      } as const;

      Alert.alert(titleByReason[result.reason], messageByReason[result.reason], [
        {
          text: "Go to Orders",
          onPress: () => router.replace("/orders"),
        },
      ]);
      return;
    } catch (err: any) {
      console.error("PLACE_ORDER_ERROR", err);
      const message = err?.message || "Something went wrong. Please try again.";
      if (String(message).toLowerCase().includes("verify your email")) {
        Alert.alert("Email verification required", message, [
          { text: "Verify Now", onPress: () => router.push("/settings/profile") },
          { text: "Cancel", style: "cancel" },
        ]);
      } else {
        Alert.alert("Order failed", message);
      }
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* ─── Header: matches the home screen's "DELIVERY TO" address bar so
          there's no visual jump when navigating between tabs. ─── */}
      <View style={styles.addressBarBg}>
        <LinearGradient
          colors={["#ecfdf5", "#ffffff"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        <View style={styles.appBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={C.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={0.7}
            onPress={() => router.push("/select-location")}
          >
            <View style={styles.deliveryLabelRow}>
              <MaterialCommunityIcons
                name="map-marker-outline"
                size={14}
                color={C.primary}
              />
              <Text style={styles.deliveryLabelText}>Delivery to</Text>
            </View>
            <View style={styles.locationInlineRow}>
              <Text style={styles.deliveryAddressText} numberOfLines={1}>
                {location
                  ? location.address
                    ? `${location.label ? location.label + " · " : ""}${location.address}`
                    : location.label || "Your location"
                  : "Set delivery address"}
              </Text>
              <MaterialCommunityIcons
                name="chevron-down"
                size={16}
                color={C.text}
              />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── Items Card ─── */}
        <View style={styles.card}>
          {items.map((item, idx) => (
            <View key={item.product_id}>
              <View style={styles.itemRow}>
                {item.image_url ? (
                  <Image
                    source={{ uri: cdnImage(item.image_url, 160) }}
                    style={styles.itemImage}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    transition={120}
                  />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <MaterialCommunityIcons name="leaf" size={20} color={C.border} />
                  </View>
                )}
                <View style={styles.itemDetails}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.itemUnit}>{item.unit}</Text>
                </View>
                <View style={styles.quantityControls}>
                  <TouchableOpacity
                    style={styles.quantityBtn}
                    onPress={() => updateQty(item.product_id, item.quantity - 1)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="minus" size={14} color={C.primary} />
                  </TouchableOpacity>
                  <Text style={styles.quantityText}>{item.quantity}</Text>
                  <TouchableOpacity
                    style={styles.quantityBtn}
                    onPress={() => updateQty(item.product_id, item.quantity + 1)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="plus" size={14} color={C.primary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.itemPriceCol}>
                  <Text style={styles.itemTotal}>₹{(item.price * item.quantity).toFixed(0)}</Text>
                </View>
              </View>
              {idx < items.length - 1 && <View style={styles.itemDivider} />}
            </View>
          ))}

          {/* Add more items row */}
          <TouchableOpacity
            style={styles.addMoreRow}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="plus-circle-outline" size={16} color={C.primary} />
            <Text style={styles.addMoreText}>Add more items</Text>
          </TouchableOpacity>
        </View>

        {/* ─── Savings Corner ─── */}
        <View style={styles.card}>
          <View style={styles.savingsHeader}>
            <MaterialCommunityIcons name="tag-outline" size={15} color={C.primary} />
            <Text style={styles.savingsTitle}>SAVINGS CORNER</Text>
          </View>
          <TouchableOpacity
            style={styles.savingsRow}
            activeOpacity={0.85}
            onPress={() => router.push("../product/coupons")}
          >
            <View style={styles.savingsLeft}>
              <MaterialCommunityIcons name="shield-check-outline" size={20} color="#2563eb" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.savingsText}>
                  {appliedCoupon
                    ? `${appliedCoupon.code} applied · −₹${discount.toFixed(0)} saved`
                    : "View all coupons & offers"}
                </Text>
              </View>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={C.textSub} />
          </TouchableOpacity>
        </View>

        {/* ─── Add GSTIN ─── */}
        <View style={styles.card}>
          <View style={styles.gstinRow}>
            <View style={styles.gstinLeft}>
              <View style={styles.gstinIconWrap}>
                <Text style={styles.gstinIconText}>GST</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.gstinTitle}>Add GSTIN</Text>
                <Text style={styles.gstinSub}>Claim GST credit up to 18% on the order</Text>
              </View>
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setGstinClaim((v) => !v);
              }}
            >
              <Text style={styles.gstinAddBtn}>{gstinClaim ? "Done" : "Add"}</Text>
            </TouchableOpacity>
          </View>
          {gstinClaim && (
            <View style={styles.gstinExpanded}>
              <TextInput
                placeholder="Enter 15-digit GSTIN"
                placeholderTextColor={C.textLight}
                value={gstin}
                onChangeText={setGstin}
                style={styles.textInput}
                autoCapitalize="characters"
                maxLength={15}
              />
              <TextInput
                placeholder="Registered Business Name"
                placeholderTextColor={C.textLight}
                value={invoiceName}
                onChangeText={setInvoiceName}
                style={[styles.textInput, { marginTop: 8 }]}
              />
            </View>
          )}
        </View>

        {/* ─── Did you forget? (Recommended) ─── */}
        {recommended.length > 0 && (
          <View style={styles.card}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recoTabsScroll}>
              {["Did you forget?", "Chips & Muchies", "Hungry? Grab"].map((tab, i) => (
                <View key={i} style={[styles.recoTab, i === 0 && styles.recoTabActive]}>
                  <Text style={[styles.recoTabText, i === 0 && styles.recoTabTextActive]}>{tab}</Text>
                </View>
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recoScroll}>
              {recommended.map((p) => (
                <View key={p.id} style={styles.recoCard}>
                  <TouchableOpacity
                    style={styles.recoBookmark}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <MaterialCommunityIcons name="bookmark-outline" size={14} color={C.textSub} />
                  </TouchableOpacity>
                  {p.image_url ? (
                    <Image
                      source={{ uri: cdnImage(p.image_url, 200) }}
                      style={styles.recoImage}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      transition={120}
                      priority="low"
                    />
                  ) : (
                    <View style={styles.recoPlaceholder}>
                      <MaterialCommunityIcons name="image-outline" size={22} color={C.border} />
                    </View>
                  )}
                  <Text style={styles.recoDelivery}>6 MINS</Text>
                  <Text style={styles.recoName} numberOfLines={2}>{p.name}</Text>
                  <Text style={styles.recoWeight}>{p.unit}</Text>
                  {p.original_price && p.original_price > p.price && (
                    <Text style={styles.recoDiscount}>{Math.round(((p.original_price - p.price) / p.original_price) * 100)}% OFF</Text>
                  )}
                  <View style={styles.recoPriceRow}>
                    <Text style={styles.recoPrice}>₹{p.price}</Text>
                    {p.original_price && p.original_price > p.price && (
                      <Text style={styles.recoMrp}>₹{p.original_price}</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.recoAddBtn}
                    activeOpacity={0.85}
                    onPress={() =>
                      addItem({
                        product_id: p.id,
                        name: p.name,
                        price: p.price,
                        unit: p.unit,
                        image_url: p.image_url,
                      })
                    }
                  >
                    <MaterialCommunityIcons name="plus" size={18} color={C.primary} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ─── Delivery Tip ─── */}
        <View style={styles.card}>
          <View style={styles.tipHeaderRow}>
            <Text style={styles.tipTitle}>DELIVERY TIP</Text>
            <MaterialCommunityIcons name="information-outline" size={14} color={C.textSub} />
          </View>
          <Text style={styles.tipSubtitle}>
            A small tip, a big gesture! Tip your delivery{"\n"}partner to show your appreciation for{"\n"}their hard work.
          </Text>
          <View style={styles.tipDeliveryImage}>
            {/* Decorative delivery icon area */}
          </View>
          <View style={styles.tipChipsRow}>
            {([10, 20, 30] as const).map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.tipChip, tipPreset === val && styles.tipChipActive]}
                activeOpacity={0.8}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setTipPreset(tipPreset === val ? null : val);
                }}
              >
                {val === 20 && <Text style={styles.tipMostTipped}>Most tipped</Text>}
                <Text style={[styles.tipChipText, tipPreset === val && styles.tipChipTextActive]}>
                  ₹{val}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.tipChip, tipPreset === "custom" && styles.tipChipActive]}
              activeOpacity={0.8}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setTipPreset("custom");
              }}
            >
              <Text style={[styles.tipChipText, tipPreset === "custom" && styles.tipChipTextActive]}>
                Other
              </Text>
            </TouchableOpacity>
          </View>
          {tipPreset === "custom" && (
            <TextInput
              placeholder="Enter tip amount in ₹"
              placeholderTextColor={C.textLight}
              keyboardType="numeric"
              value={customTip}
              onChangeText={setCustomTip}
              style={[styles.textInput, { marginTop: 10 }]}
            />
          )}
        </View>

        {/* ─── Bill Details ─── */}
        <View style={styles.card}>
          <Text style={styles.billSectionTitle}>BILL DETAILS</Text>
          <BillRow label="Item Total" value={subtotal} strikeValue={subtotal + (discount > 0 ? discount : 0)} showStrike={false} />
          {discount > 0 && <BillRow label="Coupon Discount" value={-discount} highlight />}
          <BillRow
            label="Platform Fee"
            value={platformFee}
            onInfoPress={() =>
              Alert.alert(
                "Platform Fee",
                "A small fee that keeps our app running smoothly so we can keep bringing fresh picks to your door. Thank you for supporting us!",
              )
            }
          />
          <BillRow
            label="Handling Charges"
            value={handlingFee}
            onInfoPress={() =>
              Alert.alert(
                "Handling Charges",
                "This goes towards carefully packing and handling your order so it reaches you just right. Thanks for being part of our journey!",
              )
            }
          />
          <BillRow label="GST charges" value={gst} />
          <BillRow label="Delivery Fee" value={deliveryFee} />
          {tipAmount > 0 && <BillRow label="Delivery Partner Tip" value={tipAmount} />}
          <View style={styles.billDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>To Pay</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.totalValue}>₹{Math.round(finalPayable)}</Text>
            </View>
          </View>
        </View>

        {/* ─── Cancellation Note ─── */}
        <View style={styles.noteCard}>
          <Text style={styles.noteText}>
            <Text style={styles.noteBold}>NOTE: </Text>
            Orders cannot be cancelled and are non-refundable once packed for delivery.{" "}
          </Text>
          <TouchableOpacity onPress={() => router.push("/settings/support")}>
            <Text style={styles.noteLink}>Read cancellation policy</Text>
          </TouchableOpacity>
        </View>

        {/* ─── Who is this order for? ─── */}
        <View style={styles.card}>
          <Text style={styles.billSectionTitle}>WHO IS THIS ORDER FOR?</Text>
          <View style={styles.orderForRow}>
            <TouchableOpacity
              style={[
                styles.orderForChip,
                orderFor === "self" && styles.orderForChipActive,
              ]}
              activeOpacity={0.8}
              onPress={() => setOrderFor("self")}
            >
              <MaterialCommunityIcons
                name={orderFor === "self" ? "radiobox-marked" : "radiobox-blank"}
                size={18}
                color={orderFor === "self" ? C.primary : C.textSub}
              />
              <Text
                style={[
                  styles.orderForChipText,
                  orderFor === "self" && styles.orderForChipTextActive,
                ]}
              >
                Myself
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.orderForChip,
                orderFor === "others" && styles.orderForChipActive,
              ]}
              activeOpacity={0.8}
              onPress={() => setOrderFor("others")}
            >
              <MaterialCommunityIcons
                name={orderFor === "others" ? "radiobox-marked" : "radiobox-blank"}
                size={18}
                color={orderFor === "others" ? C.primary : C.textSub}
              />
              <Text
                style={[
                  styles.orderForChipText,
                  orderFor === "others" && styles.orderForChipTextActive,
                ]}
              >
                Someone else
              </Text>
            </TouchableOpacity>
          </View>

          {orderFor === "others" && (
            <View style={{ marginTop: 12, gap: 10 }}>
              <TextInput
                placeholder="Receiver's name *"
                placeholderTextColor={C.textLight}
                value={receiverName}
                onChangeText={setReceiverName}
                style={styles.textInput}
              />
              <TextInput
                placeholder="Receiver's 10-digit phone *"
                placeholderTextColor={C.textLight}
                value={receiverPhone}
                onChangeText={(t) => setReceiverPhone(t.replace(/\D/g, ""))}
                keyboardType="number-pad"
                maxLength={10}
                style={styles.textInput}
              />
              <TextInput
                placeholder="Receiver's address details (Optional)"
                placeholderTextColor={C.textLight}
                value={receiverAddress}
                onChangeText={setReceiverAddress}
                style={[styles.textInput, styles.multilineInput]}
                multiline
                numberOfLines={2}
              />
            </View>
          )}
        </View>

        {/* ─── Delivery Instructions ─── */}
        <View style={styles.card}>
          <Text style={styles.billSectionTitle}>DELIVERY INSTRUCTIONS</Text>
          <TextInput
            placeholder="e.g. Don't ring the bell, call on arrival, gate code…"
            placeholderTextColor={C.textLight}
            value={deliveryInstructions}
            onChangeText={setDeliveryInstructions}
            style={[styles.textInput, styles.multilineInput]}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ─── Pay Dock ─── */}
      <View style={styles.payDock}>
        <PayMethodRow />

        {/* Slide to Pay button */}
        <TouchableOpacity
          style={[styles.payButton, placing && styles.payButtonPlacing]}
          onPress={placeOrder}
          disabled={placing}
          activeOpacity={0.85}
        >
          {placing ? (
            <>
              <MaterialCommunityIcons name="loading" size={20} color="#fff" />
              <Text style={styles.payButtonText}>Placing your order…</Text>
            </>
          ) : (
            <>
              <View style={styles.paySlideArrow}>
                <MaterialCommunityIcons name="chevron-double-right" size={22} color="#fff" />
              </View>
              <PayButtonLabel finalPayable={finalPayable} />
            </>
          )}
        </TouchableOpacity>
      </View>

      {RazorpayUI}

      <PaymentProcessingOverlay phase={paymentPhase} />

      {/* ─── Success Overlay ─── */}
      {showSuccess && (
        <Animated.View
          style={[
            styles.successOverlay,
            {
              opacity: successAnim,
              transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
            },
          ]}
        >
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <MaterialCommunityIcons name="check-circle" size={52} color={C.success} />
            </View>
            <Text style={styles.successTitle}>Order Placed!</Text>
            <Text style={styles.successSub}>
              Your order is on its way to the store. We'll notify you once it's accepted.
            </Text>
            <TouchableOpacity
              style={styles.successBtn}
              activeOpacity={0.85}
              onPress={() => {
                setShowSuccess(false);
                setTimeout(() => router.replace("/orders"), 200);
              }}
            >
              <MaterialCommunityIcons name="map-clock-outline" size={18} color="#fff" />
              <Text style={styles.successBtnText}>Track Order</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BillRow({
  label,
  value,
  highlight,
  strikeValue,
  showStrike,
  note,
  onInfoPress,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  strikeValue?: number;
  showStrike?: boolean;
  note?: string;
  onInfoPress?: () => void;
}) {
  // Only integer-valued fees collapse cleanly; preserve decimals (9.5, 0.75 …)
  // so the breakdown stays faithful. The final "To Pay" row is the one place
  // we round to the nearest rupee.
  const formatAmount = (n: number) => {
    const abs = Math.abs(n);
    const hasDecimals = Math.abs(abs - Math.round(abs)) > 0.0001;
    return hasDecimals ? abs.toFixed(2) : String(Math.round(abs));
  };
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={styles.billRow}>
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, gap: 4 }}>
          <Text style={[styles.billLabel, highlight && { color: C.success }]}>{label}</Text>
          {onInfoPress && (
            <TouchableOpacity
              onPress={onInfoPress}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`More info about ${label}`}
            >
              <MaterialCommunityIcons
                name="information-outline"
                size={14}
                color={C.textSub}
              />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {showStrike && strikeValue !== undefined && (
            <Text style={styles.billStrike}>₹{formatAmount(strikeValue)}</Text>
          )}
          <Text style={[styles.billValue, highlight && { color: C.success, fontWeight: "700" }]}>
            {value < 0 ? `−₹${formatAmount(value)}` : `₹${formatAmount(value)}`}
          </Text>
        </View>
      </View>
      {note && <Text style={styles.billNote}>{note}</Text>}
    </View>
  );
}

// ─── Isolated pay-dock subscribers ───────────────────────────────────────────
//
// These components subscribe to the payment-selection store *in isolation* so
// that picking a new method on the payment-options screen only re-renders the
// tiny pay-dock UI, not the entire checkout tree (which has a ScrollView with
// products, recommendations, bill details, etc.). Before extraction, that
// whole-tree re-render coincided with the pop animation and made returning to
// checkout feel like the app was hanging.

function usePaymentSelectionSubscription(): PaymentSelection {
  const [sel, setSel] = useState<PaymentSelection>(() => getPaymentSelection());
  useEffect(() => {
    const unsub = subscribePaymentSelection(setSel);
    setSel(getPaymentSelection());
    return unsub;
  }, []);
  return sel;
}

function PayMethodRow() {
  const sel = usePaymentSelectionSubscription();
  return (
    <TouchableOpacity
      style={styles.payMethodRow}
      activeOpacity={0.8}
      onPress={() => router.push("/support/payment-options")}
    >
      <View style={styles.payMethodLeft}>
        <MaterialCommunityIcons
          name={(sel.icon as any) || "credit-card-outline"}
          size={20}
          color={C.text}
        />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.payMethodLabel}>Pay using</Text>
          <Text style={styles.payMethodValue} numberOfLines={1}>
            {sel.label}
            {sel.subLabel ? ` · ${sel.subLabel}` : ""}
          </Text>
        </View>
      </View>
      <View style={styles.payMethodChange}>
        <Text style={styles.payMethodChangeText}>Change</Text>
        <MaterialCommunityIcons name="chevron-right" size={16} color={C.primary} />
      </View>
    </TouchableOpacity>
  );
}

function PayButtonLabel({ finalPayable }: { finalPayable: number }) {
  const sel = usePaymentSelectionSubscription();
  return (
    <Text style={styles.payButtonText}>
      {sel.mode === "cod" ? "Place Order" : `Slide to Pay | ₹${finalPayable.toFixed(0)}`}
    </Text>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f0f0f5" },
  scrollContent: { paddingBottom: 200 },

  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },

  // "Delivery to" address bar — kept visually in sync with the one on the
  // home screen so navigating checkout ↔ home never feels like two apps.
  addressBarBg: {
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
  },
  deliveryLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 3,
  },
  deliveryLabelText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  deliveryAddressText: {
    fontSize: 16,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.3,
    flex: 1,
  },
  locationInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "95%",
  },

  // Card (Blinkit uses white cards separated by gray gaps)
  card: {
    backgroundColor: C.card,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  // Items
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  itemDivider: { height: 1, backgroundColor: C.border, marginVertical: 2 },
  itemImage: { width: 52, height: 52, borderRadius: 8 },
  imagePlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  itemDetails: { flex: 1 },
  itemName: { color: C.text, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  itemUnit: { color: C.textSub, fontSize: 11, marginTop: 2 },
  itemPriceCol: { alignItems: "flex-end", minWidth: 48 },
  itemTotal: { color: C.text, fontWeight: "700", fontSize: 13 },
  itemMrp: { color: C.textLight, fontSize: 11, textDecorationLine: "line-through", marginTop: 2 },

  // Quantity Controls
  quantityControls: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.primary,
    borderRadius: 8,
    overflow: "hidden",
  },
  quantityBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primaryXLight,
  },
  quantityText: {
    fontSize: 13,
    fontWeight: "700",
    color: C.primary,
    minWidth: 24,
    textAlign: "center",
  },

  // Add more items
  addMoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 12,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  addMoreText: { color: C.primary, fontSize: 13, fontWeight: "700" },

  // Savings corner
  savingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  savingsTitle: {
    color: C.textSub,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  savingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  savingsLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  savingsText: { color: C.text, fontSize: 13, fontWeight: "600" },

  // GSTIN
  gstinRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  gstinLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  gstinIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#e8f0fe",
    alignItems: "center",
    justifyContent: "center",
  },
  gstinIconText: { color: "#2563eb", fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },
  gstinTitle: { color: C.text, fontSize: 13, fontWeight: "700" },
  gstinSub: { color: C.textSub, fontSize: 11, marginTop: 1 },
  gstinAddBtn: { color: C.primary, fontSize: 14, fontWeight: "800" },
  gstinExpanded: { marginTop: 12 },

  // Reco tabs
  recoTabsScroll: { marginBottom: 12, marginHorizontal: -16, paddingHorizontal: 16 },
  recoTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    marginRight: 8,
    backgroundColor: C.card,
  },
  recoTabActive: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  recoTabText: { color: C.textSub, fontSize: 12, fontWeight: "600" },
  recoTabTextActive: { color: C.primary },

  // Reco cards
  recoScroll: { marginHorizontal: -16, paddingHorizontal: 16 },
  recoCard: {
    width: 110,
    backgroundColor: C.card,
    borderRadius: 10,
    padding: 8,
    marginRight: 10,
    borderWidth: 1,
    borderColor: C.border,
    position: "relative",
  },
  recoBookmark: { position: "absolute", top: 6, left: 6, zIndex: 1 },
  recoImage: { width: "100%", height: 70, borderRadius: 8, marginBottom: 6 },
  recoPlaceholder: {
    width: "100%",
    height: 70,
    borderRadius: 8,
    backgroundColor: C.bgSoft,
    marginBottom: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  recoDelivery: { color: C.textLight, fontSize: 9, fontWeight: "700", letterSpacing: 0.3 },
  recoName: { color: C.text, fontSize: 11, fontWeight: "600", lineHeight: 15, minHeight: 30, marginTop: 2 },
  recoWeight: { color: C.textSub, fontSize: 10, marginTop: 1 },
  recoDiscount: { color: C.success, fontSize: 10, fontWeight: "800", marginTop: 2 },
  recoPriceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  recoPrice: { color: C.text, fontSize: 12, fontWeight: "800" },
  recoMrp: { color: C.textLight, fontSize: 10, textDecorationLine: "line-through" },
  recoAddBtn: {
    marginTop: 7,
    borderWidth: 1.5,
    borderColor: C.primary,
    borderRadius: 6,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },

  // Tip
  tipHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  tipTitle: {
    color: C.textSub,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  tipSubtitle: { color: C.textSub, fontSize: 12, lineHeight: 17, marginBottom: 14 },
  tipDeliveryImage: { height: 0 },
  tipChipsRow: { flexDirection: "row", gap: 8 },
  tipChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    paddingTop: 14,
  },
  tipChipActive: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  tipChipText: { fontSize: 13, color: C.text, fontWeight: "700" },
  tipChipTextActive: { color: C.primary },
  tipMostTipped: {
    position: "absolute",
    top: -9,
    alignSelf: "center",
    backgroundColor: C.primary,
    color: "#fff",
    fontSize: 8,
    fontWeight: "800",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },

  // Bill Details
  billSectionTitle: {
    color: C.textSub,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  billRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  billLabel: { color: C.text, fontSize: 13 },
  billValue: { color: C.text, fontSize: 13, fontWeight: "500" },
  billStrike: { color: C.textLight, fontSize: 12, textDecorationLine: "line-through" },
  billNote: { color: C.textSub, fontSize: 11, marginTop: 3 },
  deliveryFeeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  freeDeliveryNote: { color: C.textSub, fontSize: 11, marginBottom: 10, marginTop: -4 },
  billGstRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  billDivider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { color: C.text, fontSize: 16, fontWeight: "900" },
  totalStrike: { color: C.textLight, fontSize: 13, textDecorationLine: "line-through" },
  totalValue: { color: C.text, fontSize: 18, fontWeight: "900" },

  // Note card
  noteCard: {
    backgroundColor: "#fff8e1",
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#ffe082",
  },
  noteText: { color: C.text, fontSize: 12, lineHeight: 18 },
  noteBold: { fontWeight: "800" },
  noteLink: { color: C.primary, fontSize: 12, fontWeight: "700", marginTop: 4 },

  // Inputs
  textInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    paddingHorizontal: 13,
    paddingVertical: 12,
    backgroundColor: C.card,
    color: C.text,
    fontSize: 14,
    height: 44,
  },
  multilineInput: { minHeight: 74, height: undefined, textAlignVertical: "top" },

  // "Who is this order for?" section
  orderForRow: {
    flexDirection: "row",
    gap: 10,
  },
  orderForChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  orderForChipActive: {
    borderColor: C.primary,
    backgroundColor: C.primaryXLight,
  },
  orderForChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text,
  },
  orderForChipTextActive: {
    color: C.primary,
  },
  // Pay dock
  payDock: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.card,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 16,
  },
  payMethodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  payMethodLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 },
  payMethodLabel: { color: C.textSub, fontSize: 11, fontWeight: "600" },
  payMethodValue: { color: C.text, fontSize: 14, fontWeight: "800", marginTop: 1 },
  payMethodChange: { flexDirection: "row", alignItems: "center" },
  payMethodChangeText: { color: C.primary, fontSize: 13, fontWeight: "700" },
  paymentToggleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  paymentToggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    backgroundColor: C.bgSoft,
  },
  paymentToggleBtnActive: { borderColor: C.primary, backgroundColor: C.primaryXLight },
  paymentToggleText: { color: C.textSub, fontSize: 12, fontWeight: "700" },
  paymentToggleTextActive: { color: C.primary },
  payButton: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  payButtonPlacing: { opacity: 0.65 },
  paySlideArrow: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  payButtonText: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },

  // Success overlay
  successOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  successCard: {
    width: "100%",
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.successLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  successTitle: { color: C.text, fontSize: 22, fontWeight: "900" },
  successSub: { color: C.textSub, fontSize: 13, textAlign: "center", lineHeight: 20 },
  successBtn: {
    marginTop: 10,
    backgroundColor: C.primary,
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  successBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});