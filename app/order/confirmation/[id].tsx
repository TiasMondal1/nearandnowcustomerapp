import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../../constants/colors";
import { useAuth } from "../../../context/AuthContext";
import { useCart } from "../../../context/CartContext";
import { getUserOrders, type Order } from "../../../lib/orderService";
import { getAllProducts, type Product } from "../../../lib/productService";

const ADD_MORE_WINDOW_SECONDS = 40;

export default function OrderConfirmationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const { items: cartItems, addItem } = useCart();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(ADD_MORE_WINDOW_SECONDS);
  const [timerExpired, setTimerExpired] = useState(false);
  const [suggestedProducts, setSuggestedProducts] = useState<Product[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;

  // Load order details
  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;

    (async () => {
      try {
        const orders = await getUserOrders(userId);
        const found = orders.find((o) => o.id === id);
        if (!cancelled && found) {
          setOrder(found);
        }
      } catch (err) {
        console.error("Failed to load order:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, userId]);

  // Load suggested products
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const products = await getAllProducts();
        if (!cancelled) {
          // Get random products not in the current order
          const orderProductIds = new Set(order?.items?.map((i) => i.product_id) ?? []);
          const available = products.filter((p) => !orderProductIds.has(p.id));
          const shuffled = available.sort(() => Math.random() - 0.5);
          setSuggestedProducts(shuffled.slice(0, 6));
        }
      } catch (err) {
        console.error("Failed to load suggestions:", err);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [order]);

  // Countdown timer
  useEffect(() => {
    if (timerExpired) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setTimerExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerExpired]);

  // Progress bar animation
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: timeLeft / ADD_MORE_WINDOW_SECONDS,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [timeLeft]);

  // Pulse animation for timer
  useEffect(() => {
    if (timerExpired) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [timerExpired]);

  const handleAddToCart = useCallback(
    (product: Product) => {
      addItem({
        product_id: product.id,
        name: product.name,
        price: product.price,
        image_url: product.image_url,
        unit: product.unit,
      });
    },
    [addItem]
  );

  const handleGoToCart = useCallback(() => {
    router.push("/cart");
  }, []);

  const handleTrackOrder = useCallback(() => {
    router.replace(`/order/track/${id}` as any);
  }, [id]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const timerColor = timeLeft <= 10 ? C.danger : timeLeft <= 20 ? C.warning : C.primary;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading order details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Success Header */}
        <View style={styles.successHeader}>
          <View style={styles.successIconWrap}>
            <MaterialCommunityIcons name="check-circle" size={64} color={C.success} />
          </View>
          <Text style={styles.successTitle}>Order Placed Successfully!</Text>
          <Text style={styles.orderNumber}>
            Order #{order?.order_number || id?.slice(0, 8).toUpperCase()}
          </Text>
          <Text style={styles.successSub}>
            Your order has been received and is being processed.
          </Text>
        </View>

        {/* Add More Timer Card */}
        {!timerExpired ? (
          <View style={styles.timerCard}>
            <View style={styles.timerHeader}>
              <MaterialCommunityIcons name="clock-fast" size={24} color={timerColor} />
              <View style={{ flex: 1 }}>
                <Text style={styles.timerTitle}>Want to add more items?</Text>
                <Text style={styles.timerSub}>
                  Add items now and they'll be delivered with this order!
                </Text>
              </View>
            </View>

            <Animated.View
              style={[
                styles.timerDisplay,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <Text style={[styles.timerText, { color: timerColor }]}>
                {formatTime(timeLeft)}
              </Text>
              <Text style={styles.timerLabel}>remaining</Text>
            </Animated.View>

            <View style={styles.progressBarWrap}>
              <Animated.View
                style={[
                  styles.progressBar,
                  { width: progressWidth, backgroundColor: timerColor },
                ]}
              />
            </View>

            {cartItems.length > 0 && (
              <TouchableOpacity
                style={styles.goToCartBtn}
                activeOpacity={0.85}
                onPress={handleGoToCart}
              >
                <MaterialCommunityIcons name="cart" size={18} color="#fff" />
                <Text style={styles.goToCartText}>
                  Go to Cart ({cartItems.length} items)
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.timerExpiredCard}>
            <MaterialCommunityIcons name="clock-check" size={28} color={C.textSub} />
            <View style={{ flex: 1 }}>
              <Text style={styles.timerExpiredTitle}>Add-more window closed</Text>
              <Text style={styles.timerExpiredSub}>
                Your order is now being prepared for delivery.
              </Text>
            </View>
          </View>
        )}

        {/* Suggested Products */}
        {!timerExpired && (
          <View style={styles.suggestionsSection}>
            <Text style={styles.sectionTitle}>Quick Add</Text>
            <Text style={styles.sectionSub}>
              Popular items you might want to add
            </Text>

            {loadingSuggestions ? (
              <ActivityIndicator
                size="small"
                color={C.primary}
                style={{ marginTop: 20 }}
              />
            ) : (
              <View style={styles.suggestionsGrid}>
                {suggestedProducts.map((product) => (
                  <View key={product.id} style={styles.suggestionCard}>
                    <View style={styles.suggestionInfo}>
                      <Text style={styles.suggestionName} numberOfLines={2}>
                        {product.name}
                      </Text>
                      <Text style={styles.suggestionPrice}>
                        ₹{product.price}
                        {product.unit && (
                          <Text style={styles.suggestionUnit}> / {product.unit}</Text>
                        )}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.addBtn}
                      activeOpacity={0.85}
                      onPress={() => handleAddToCart(product)}
                    >
                      <MaterialCommunityIcons name="plus" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Order Summary */}
        <View style={styles.orderSummary}>
          <Text style={styles.sectionTitle}>Order Summary</Text>

          <View style={styles.summaryCard}>
            {order?.items?.slice(0, 5).map((item, idx) => (
              <View
                key={idx}
                style={[
                  styles.summaryItem,
                  idx < Math.min(order.items!.length, 5) - 1 && styles.summaryItemBorder,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryItemName}>{item.name}</Text>
                  <Text style={styles.summaryItemUnit}>
                    ₹{item.price} × {item.quantity}
                  </Text>
                </View>
                <Text style={styles.summaryItemTotal}>
                  ₹{(item.price * item.quantity).toFixed(2)}
                </Text>
              </View>
            ))}
            {(order?.items?.length ?? 0) > 5 && (
              <Text style={styles.moreItems}>
                +{order!.items!.length - 5} more items
              </Text>
            )}

            <View style={styles.summaryDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>
                ₹{(order?.subtotal ?? 0).toFixed(2)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Delivery Fee</Text>
              <Text style={styles.summaryValue}>
                ₹{(order?.delivery_fee ?? 0).toFixed(2)}
              </Text>
            </View>
            <View style={[styles.summaryRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>
                ₹{(order?.order_total ?? 0).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>

        {/* Track Order Button */}
        <TouchableOpacity
          style={styles.trackOrderBtn}
          activeOpacity={0.85}
          onPress={handleTrackOrder}
        >
          <MaterialCommunityIcons name="map-marker-path" size={20} color="#fff" />
          <Text style={styles.trackOrderText}>Track Your Order</Text>
        </TouchableOpacity>

        {/* Delivery Info */}
        <View style={styles.deliveryInfo}>
          <MaterialCommunityIcons name="information-outline" size={18} color={C.textSub} />
          <Text style={styles.deliveryInfoText}>
            You'll receive a 4-digit PIN once your order is dispatched. Share this PIN
            with the delivery partner to confirm delivery.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { color: C.textSub, fontSize: 14 },
  scrollContent: { paddingBottom: 40 },

  // Success Header
  successHeader: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: C.successLight,
  },
  successIconWrap: {
    marginBottom: 16,
  },
  successTitle: {
    color: "#065f46",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  orderNumber: {
    color: "#065f46",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
    opacity: 0.8,
  },
  successSub: {
    color: "#065f46",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    opacity: 0.75,
    lineHeight: 20,
  },

  // Timer Card
  timerCard: {
    margin: 16,
    padding: 18,
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  timerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  timerTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: "800",
  },
  timerSub: {
    color: C.textSub,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  timerDisplay: {
    alignItems: "center",
    marginVertical: 20,
  },
  timerText: {
    fontSize: 48,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  timerLabel: {
    color: C.textSub,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  progressBarWrap: {
    height: 6,
    backgroundColor: C.bgSoft,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 3,
  },
  goToCartBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  goToCartText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },

  // Timer Expired
  timerExpiredCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    margin: 16,
    padding: 16,
    backgroundColor: C.bgSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  timerExpiredTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
  },
  timerExpiredSub: {
    color: C.textSub,
    fontSize: 13,
    marginTop: 2,
  },

  // Suggestions
  suggestionsSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: "800",
  },
  sectionSub: {
    color: C.textSub,
    fontSize: 13,
    marginTop: 4,
  },
  suggestionsGrid: {
    marginTop: 14,
    gap: 10,
  },
  suggestionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  suggestionInfo: {
    flex: 1,
  },
  suggestionName: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
  },
  suggestionPrice: {
    color: C.primary,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4,
  },
  suggestionUnit: {
    color: C.textSub,
    fontSize: 12,
    fontWeight: "600",
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  // Order Summary
  orderSummary: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  summaryCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  summaryItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  summaryItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  summaryItemName: {
    color: C.text,
    fontSize: 14,
    fontWeight: "600",
  },
  summaryItemUnit: {
    color: C.textSub,
    fontSize: 12,
    marginTop: 2,
  },
  summaryItemTotal: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
  },
  moreItems: {
    color: C.textSub,
    fontSize: 12,
    fontStyle: "italic",
    paddingVertical: 8,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  summaryLabel: {
    color: C.textSub,
    fontSize: 14,
  },
  summaryValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: "600",
  },
  totalRow: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginBottom: 0,
  },
  totalLabel: {
    color: C.text,
    fontSize: 16,
    fontWeight: "800",
  },
  totalValue: {
    color: C.primary,
    fontSize: 18,
    fontWeight: "900",
  },

  // Track Order Button
  trackOrderBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.primary,
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  trackOrderText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },

  // Delivery Info
  deliveryInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    backgroundColor: C.infoLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#93c5fd",
  },
  deliveryInfoText: {
    flex: 1,
    color: "#1e40af",
    fontSize: 13,
    lineHeight: 19,
  },
});
