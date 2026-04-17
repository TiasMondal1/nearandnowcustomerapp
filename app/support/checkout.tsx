import { useRazorpay } from "@codearcade/expo-razorpay";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { getProductStoreDistance } from "../../lib/distanceUtils";
import { createOrder } from "../../lib/orderService";
import { getAllProducts, type Product } from "../../lib/productService";
import { createRazorpayOrder } from "../../lib/razorpayService";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type PaymentMode = "upi" | "cod";

const RAZORPAY_KEY = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "";

export default function CheckoutScreen() {
  const { items, appliedCoupon, removeCoupon, discount, clearCart, addItem, updateQty } = useCart();
  const { user, customer } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [placing, setPlacing] = useState(false);
  const { location } = useLocation();
  const [maxDistance, setMaxDistance] = useState<number>(2);
  const [loadingDistance, setLoadingDistance] = useState(false);

  const [gstinClaim, setGstinClaim] = useState(false);
  const [gstin, setGstin] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [tipPreset, setTipPreset] = useState<10 | 20 | 30 | 50 | "custom" | null>(null);
  const [customTip, setCustomTip] = useState("");

  // "Ordering for someone else" — toggle + expandable details
  const [orderingForSomeoneElse, setOrderingForSomeoneElse] = useState(false);
  const [showRecipientDetails, setShowRecipientDetails] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientLocation, setRecipientLocation] = useState("");

  const [acceptCancellation, setAcceptCancellation] = useState(false);
  const [recommended, setRecommended] = useState<Product[]>([]);
  const [loadingRecommended, setLoadingRecommended] = useState(false);
  const [payment, setPayment] = useState<PaymentMode>("upi");
  const { openCheckout, closeCheckout, RazorpayUI } = useRazorpay();

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
        const distances = await Promise.all(
          items.map((item) =>
            getProductStoreDistance(item.product_id, location.latitude, location.longitude),
          ),
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
    const loadRecommended = async () => {
      if (!location || items.length === 0) {
        setRecommended([]);
        return;
      }
      try {
        setLoadingRecommended(true);

        // Get all available products
        const allProducts = await getAllProducts({ lat: location.latitude, lng: location.longitude });
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
        setRecommended([]);
      } finally {
        setLoadingRecommended(false);
      }
    };
    loadRecommended();
  }, [items, location]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const totalItems = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const { platformFee, handlingFee, convFee, deliveryFee, projected } = useMemo(
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

  const toggleRecipientDetails = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowRecipientDetails((v) => !v);
  };

  const toggleOrderingForSomeoneElse = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !orderingForSomeoneElse;
    setOrderingForSomeoneElse(next);
    if (!next) {
      setShowRecipientDetails(false);
      setRecipientName("");
      setRecipientPhone("");
      setRecipientLocation("");
    }
  };

  const doCreateOrder = async (paymentStatus: "pending" | "paid") => {
    if (!user?.id || !location) return;
    const notesParts: string[] = [];
    if (gstinClaim && gstin.trim()) {
      notesParts.push(
        `GSTIN: ${gstin.trim()}${invoiceName ? ` (Name: ${invoiceName.trim()})` : ""}`,
      );
    }
    if (deliveryInstructions.trim()) {
      notesParts.push(`Delivery Instructions: ${deliveryInstructions.trim()}`);
    }
    if (orderingForSomeoneElse) {
      const parts = [];
      if (recipientName.trim()) parts.push(`Name: ${recipientName.trim()}`);
      if (recipientPhone.trim()) parts.push(`Phone: ${recipientPhone.trim()}`);
      if (recipientLocation.trim()) parts.push(`Location: ${recipientLocation.trim()}`);
      if (parts.length) notesParts.push(`Recipient — ${parts.join(", ")}`);
    }
    if (tipAmount > 0) notesParts.push(`Tip for delivery partner: ₹${tipAmount.toFixed(2)}`);

    await createOrder({
      user_id: user.id,
      customer_name: user.name || "Customer",
      customer_phone: user.phone || customer?.phone || "",
      customer_email: user.email || undefined,
      payment_method: payment,
      payment_status: paymentStatus,
      subtotal,
      delivery_fee: deliveryFee,
      order_total: finalPayable,
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
    });
    clearCart();
    setShowSuccess(true);
  };

  const placeOrder = async () => {
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
    if (orderingForSomeoneElse) {
      if (!recipientName.trim()) {
        Alert.alert("Recipient name required", "Please enter the name of the person you're ordering for.");
        return;
      }
      if (recipientPhone.length !== 10) {
        Alert.alert("Recipient phone required", "Please enter a valid 10-digit mobile number for the recipient.");
        return;
      }
    }
    if (!acceptCancellation) {
      Alert.alert(
        "Cancellation policy",
        "Please review and accept the cancellation & policy information before placing your order.",
      );
      return;
    }
    setPlacing(true);
    try {
      if (payment === "cod") {
        await doCreateOrder("pending");
      } else {
        if (!RAZORPAY_KEY) {
          Alert.alert("Payment not configured", "Razorpay keys are missing. Please contact support.");
          setPlacing(false);
          return;
        }
        const amountPaise = Math.round(finalPayable * 100);
        const { order_id } = await createRazorpayOrder(amountPaise);
        closeCheckout?.();
        openCheckout(
          {
            key: RAZORPAY_KEY,
            amount: amountPaise,
            currency: "INR",
            order_id,
            name: "Near & Now",
            description: "Order payment",
            prefill: {
              name: user.name || "Customer",
              email: user.email || "",
              contact: user.phone || customer?.phone || "",
            },
            theme: { color: C.primary },
          },
          {
            onSuccess: async () => {
              closeCheckout?.();
              try {
                await doCreateOrder("paid");
              } catch (err: any) {
                Alert.alert(
                  "Order failed",
                  err?.message || "Payment succeeded but order could not be created. Please contact support.",
                );
              } finally {
                setPlacing(false);
              }
            },
            onFailure: (error: { description?: string }) => {
              closeCheckout?.();
              setPlacing(false);
              Alert.alert("Payment failed", error?.description || "Payment could not be completed.");
            },
            onClose: () => {
              setPlacing(false);
            },
          },
        );
        return;
      }
    } catch (err: any) {
      console.error("PLACE_ORDER_ERROR", err);
      Alert.alert("Order failed", err?.message || "Something went wrong. Please try again.");
    } finally {
      if (payment === "cod") setPlacing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
            {location
              ? location.address
                ? `${(location.label || "Home").toUpperCase()} · ${location.address}`
                : location.label || "Selected location"
              : "Delivery Address"}
          </Text>
          <Text style={styles.headerSub}>
            {totalItems} item{totalItems !== 1 ? "s" : ""}
          </Text>
        </View>
        <View style={{ width: 38 }} />
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
                  <Image source={{ uri: item.image_url }} style={styles.itemImage} />
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
                    <Image source={{ uri: p.image_url }} style={styles.recoImage} resizeMode="contain" />
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

        {/* ─── No Bag Toggle ─── */}
        <View style={styles.card}>
          <View style={styles.noBagRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.noBagTitle}>I don't need a bag!</Text>
                <Text style={styles.noBagEmoji}>♻️</Text>
              </View>
              <Text style={styles.noBagSub}>
                Take the pledge for a greener future – opt{"\n"}for a no bag delivery!
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={toggleOrderingForSomeoneElse}
            >
              <View style={[styles.toggleSwitch, orderingForSomeoneElse && styles.toggleSwitchOn]}>
                <View style={[styles.toggleKnob, orderingForSomeoneElse && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

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
          <BillRow label="Handling Fee" value={handlingFee} strikeValue={Math.ceil(handlingFee * 1.6)} showStrike={handlingFee < 10} />
          {convFee > 0 && <BillRow label="Small Cart Fee" value={convFee} note="No small cart fee on orders above ₹99" />}
          {tipAmount > 0 && <BillRow label="Delivery Partner Tip" value={tipAmount} />}
          <View style={styles.deliveryFeeRow}>
            <Text style={styles.billLabel}>Delivery Partner Fee</Text>
            <Text style={styles.billValue}>₹{deliveryFee.toFixed(0)}</Text>
          </View>
          {deliveryFee === 0 && (
            <Text style={styles.freeDeliveryNote}>
              Add items worth ₹80 to avail your Free Delivery on this order
            </Text>
          )}
          <View style={styles.billGstRow}>
            <Text style={styles.billLabel}>GST and Charges</Text>
            <Text style={styles.billValue}>₹{platformFee.toFixed(2)}</Text>
          </View>
          <View style={styles.billDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>To Pay</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {discount > 0 && (
                <Text style={styles.totalStrike}>₹{(finalPayable + discount).toFixed(0)}</Text>
              )}
              <Text style={styles.totalValue}>₹{finalPayable.toFixed(0)}</Text>
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

        {/* ─── Ordering for Someone Else ─── */}
        {orderingForSomeoneElse && (
          <View style={styles.card}>
            <View style={styles.recipientBox}>
              <View style={styles.recipientBoxHeader}>
                <MaterialCommunityIcons name="gift-outline" size={15} color={C.primary} />
                <Text style={styles.recipientBoxTitle}>Recipient Details</Text>
                <Text style={styles.recipientBoxNote}>Shared with delivery partner</Text>
              </View>

              <View style={styles.recipientFieldRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <View style={styles.inputIconRow}>
                    <MaterialCommunityIcons name="account-outline" size={14} color={C.textSub} />
                    <Text style={styles.fieldLabel}>Name <Text style={{ color: C.error ?? "#e53e3e" }}>*</Text></Text>
                  </View>
                  <TextInput
                    placeholder="Recipient's full name"
                    placeholderTextColor={C.textLight}
                    value={recipientName}
                    onChangeText={setRecipientName}
                    style={[styles.textInput, recipientName.trim().length > 0 && styles.textInputFilled]}
                    returnKeyType="next"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <View style={styles.inputIconRow}>
                  <MaterialCommunityIcons name="phone-outline" size={14} color={C.textSub} />
                  <Text style={styles.fieldLabel}>Phone <Text style={{ color: C.error ?? "#e53e3e" }}>*</Text></Text>
                </View>
                <View style={styles.phoneInputRow}>
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phonePrefixText}>🇮🇳 +91</Text>
                  </View>
                  <TextInput
                    placeholder="10-digit mobile number"
                    placeholderTextColor={C.textLight}
                    keyboardType="phone-pad"
                    value={recipientPhone}
                    onChangeText={(t) => setRecipientPhone(t.replace(/[^0-9]/g, ""))}
                    style={[styles.textInput, styles.phoneInputField, recipientPhone.length === 10 && styles.textInputFilled]}
                    maxLength={10}
                    returnKeyType="next"
                  />
                </View>
                {recipientPhone.length > 0 && recipientPhone.length < 10 && (
                  <Text style={styles.fieldHint}>
                    <MaterialCommunityIcons name="information-outline" size={11} color={C.textLight} />
                    {" "}{10 - recipientPhone.length} more digits needed
                  </Text>
                )}
              </View>

              <View style={styles.inputGroup}>
                <View style={styles.inputIconRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={14} color={C.textSub} />
                  <Text style={styles.fieldLabel}>Delivery note for recipient</Text>
                  <Text style={styles.optionalTag}>Optional</Text>
                </View>
                <TextInput
                  placeholder="e.g. Ring bell twice, call on arrival, 3rd floor…"
                  placeholderTextColor={C.textLight}
                  value={recipientLocation}
                  onChangeText={setRecipientLocation}
                  style={[styles.textInput, styles.multilineInput, recipientLocation.trim().length > 0 && styles.textInputFilled]}
                  multiline
                  numberOfLines={2}
                />
              </View>

              {(recipientName.trim() || recipientPhone.length === 10) && (
                <View style={styles.recipientPreview}>
                  <MaterialCommunityIcons name="check-circle-outline" size={14} color={C.success} />
                  <Text style={styles.recipientPreviewText}>
                    Delivering to <Text style={{ fontWeight: "800", color: C.text }}>{recipientName.trim() || "recipient"}</Text>
                    {recipientPhone.length === 10 ? ` · +91 ${recipientPhone}` : ""}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

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

        {/* ─── Accept Policy ─── */}
        <View style={[styles.card, { flexDirection: "row", alignItems: "flex-start", gap: 10 }]}>
          <TouchableOpacity
            style={[styles.checkbox, acceptCancellation && styles.checkboxActive]}
            onPress={() => setAcceptCancellation((v) => !v)}
            activeOpacity={0.8}
          >
            {acceptCancellation && (
              <MaterialCommunityIcons name="check" size={13} color="#fff" />
            )}
          </TouchableOpacity>
          <Text style={styles.acceptText}>
            I've reviewed and accept the cancellation policy & FAQs.
          </Text>
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ─── Pay Dock ─── */}
      <View style={styles.payDock}>
        {/* Payment method row */}
        <TouchableOpacity style={styles.payMethodRow} activeOpacity={0.8}>
          <View style={styles.payMethodLeft}>
            <MaterialCommunityIcons name="cellphone" size={18} color={C.text} />
            <View style={{ marginLeft: 8 }}>
              <Text style={styles.payMethodLabel}>Pay using</Text>
              <Text style={styles.payMethodValue}>
                {payment === "cod" ? "Cash on Delivery" : "Paytm UPI"}
              </Text>
            </View>
          </View>
          <View style={styles.payMethodChange}>
            <Text style={styles.payMethodChangeText}>Change</Text>
            <MaterialCommunityIcons name="chevron-right" size={16} color={C.primary} />
          </View>
        </TouchableOpacity>

        {/* Payment toggle */}
        <View style={styles.paymentToggleRow}>
          <TouchableOpacity
            style={[styles.paymentToggleBtn, payment === "upi" && styles.paymentToggleBtnActive]}
            onPress={() => setPayment("upi")}
            activeOpacity={0.8}
          >
            <Text style={[styles.paymentToggleText, payment === "upi" && styles.paymentToggleTextActive]}>
              UPI / Card
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.paymentToggleBtn, payment === "cod" && styles.paymentToggleBtnActive]}
            onPress={() => setPayment("cod")}
            activeOpacity={0.8}
          >
            <Text style={[styles.paymentToggleText, payment === "cod" && styles.paymentToggleTextActive]}>
              Cash on Delivery
            </Text>
          </TouchableOpacity>
        </View>

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
              <Text style={styles.payButtonText}>
                {payment === "cod" ? "Place Order" : `Slide to Pay | ₹${finalPayable.toFixed(0)}`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {RazorpayUI}

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
                setTimeout(() => router.replace("../(tabs)/orders"), 200);
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
}: {
  label: string;
  value: number;
  highlight?: boolean;
  strikeValue?: number;
  showStrike?: boolean;
  note?: string;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={styles.billRow}>
        <Text style={[styles.billLabel, highlight && { color: C.success }]}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {showStrike && strikeValue !== undefined && (
            <Text style={styles.billStrike}>₹{strikeValue.toFixed(0)}</Text>
          )}
          <Text style={[styles.billValue, highlight && { color: C.success, fontWeight: "700" }]}>
            {value < 0 ? `−₹${Math.abs(value).toFixed(0)}` : `₹${value.toFixed(2)}`}
          </Text>
        </View>
      </View>
      {note && <Text style={styles.billNote}>{note}</Text>}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f0f0f5" },
  scrollContent: { paddingBottom: 200 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
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
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { color: C.text, fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  headerSub: { color: C.textSub, fontSize: 11, marginTop: 1 },

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

  // No bag toggle
  noBagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  noBagTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  noBagEmoji: { fontSize: 14 },
  noBagSub: { color: C.textSub, fontSize: 12, marginTop: 3, lineHeight: 17 },
  toggleSwitch: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.border,
    padding: 2,
    justifyContent: "center",
  },
  toggleSwitchOn: { backgroundColor: C.primary },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleKnobOn: { alignSelf: "flex-end" },

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
  inputGroup: { marginBottom: 12 },
  inputIconRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 7 },
  fieldLabel: { color: C.textSub, fontSize: 12, fontWeight: "700" },
  textInputFilled: { borderColor: C.primary },
  fieldHint: { color: C.textLight, fontSize: 11, marginTop: 4, marginLeft: 2 },

  // Section
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  sectionTitle: { color: C.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.3, textTransform: "uppercase" },
  optionalTag: {
    color: C.textLight,
    fontSize: 10,
    fontWeight: "600",
    backgroundColor: C.bgSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
  },

  // Recipient
  recipientBox: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
    gap: 2,
  },
  recipientBoxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  recipientBoxTitle: { color: C.text, fontSize: 13, fontWeight: "800", flex: 1 },
  recipientBoxNote: {
    color: C.textLight,
    fontSize: 10,
    fontWeight: "500",
    backgroundColor: C.bgSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
  },
  recipientFieldRow: { flexDirection: "row", gap: 10 },
  phoneInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  phonePrefix: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  phonePrefixText: { fontSize: 13, fontWeight: "600", color: C.text },
  phoneInputField: { flex: 1, marginBottom: 0 },
  recipientPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    backgroundColor: "#f0fff4",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  recipientPreviewText: { color: C.textSub, fontSize: 12, flex: 1 },

  // Accept checkbox
  acceptRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxActive: { backgroundColor: C.primary, borderColor: C.primary },
  acceptText: { color: C.textSub, fontSize: 12, flex: 1, lineHeight: 18 },

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
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  payMethodLeft: { flexDirection: "row", alignItems: "center" },
  payMethodLabel: { color: C.textSub, fontSize: 10, fontWeight: "600" },
  payMethodValue: { color: C.text, fontSize: 13, fontWeight: "700" },
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