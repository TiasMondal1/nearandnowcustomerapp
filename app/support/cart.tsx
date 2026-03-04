import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCart } from "../../context/CartContext";

const BG = "#f9fafb";
const CARD = "#ffffff";
const PRIMARY = "#059669";
const SECONDARY = "#047857";
const GREEN = "#10b981";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";

export default function CartScreen() {
  const { items, updateQty, removeItem, clearCart } = useCart();
  const [showInfo, setShowInfo] = useState(false);
  const CHECKOUT_HEIGHT = 104;

  const derivedSubtotal = useMemo(() => {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [items]);

  const convFee = useMemo(() => {
    if (derivedSubtotal <= 0) return 0;
    if (derivedSubtotal < 100) return 60;
    if (derivedSubtotal <= 300) return 30;
    return 0;
  }, [derivedSubtotal]);

  const totalItems = useMemo(() => {
    return items.reduce((sum, i) => sum + i.quantity, 0);
  }, [items]);

  const packagingFee = useMemo(() => {
    if (totalItems === 0) return 0;
    return Math.ceil(totalItems / 3) * 5;
  }, [totalItems]);

  const deliveryFee = 30;

  const projectedAmount = useMemo(() => {
    return derivedSubtotal + convFee + packagingFee + deliveryFee;
  }, [derivedSubtotal, convFee, packagingFee]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1f2937" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Your Cart</Text>

        {items.length > 0 ? (
          <TouchableOpacity onPress={clearCart}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="cart-outline" size={64} color={MUTED} />
          <Text style={styles.emptyText}>Your cart is empty</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.product_id}
            contentContainerStyle={{ paddingBottom: CHECKOUT_HEIGHT + 48 }}
            renderItem={({ item }) => {
              const itemTotal = item.price * item.quantity;

              return (
                <View style={styles.itemCard}>
                  {item.image_url ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={styles.image}
                    />
                  ) : (
                    <View style={styles.imagePlaceholder} />
                  )}

                  <View style={styles.itemInfo}>
                    <Text style={styles.name} numberOfLines={2}>
                      {item.name}
                    </Text>

                    <Text style={styles.unitPrice}>
                      ₹{item.price} / {item.unit}
                    </Text>

                    <View style={styles.bottomRow}>
                      <View style={styles.qtyRow}>
                        <TouchableOpacity
                          style={styles.qtyBtn}
                          onPress={() =>
                            updateQty(item.product_id, item.quantity - 1)
                          }
                        >
                          <Text style={styles.qtyText}>−</Text>
                        </TouchableOpacity>

                        <Text style={styles.qty}>{item.quantity}</Text>

                        <TouchableOpacity
                          style={styles.qtyBtn}
                          onPress={() =>
                            updateQty(item.product_id, item.quantity + 1)
                          }
                        >
                          <Text style={styles.qtyText}>+</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.itemTotal}>
                        ₹{itemTotal.toFixed(2)}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => removeItem(item.product_id)}
                  >
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={20}
                      color="#ef4444"
                    />
                  </TouchableOpacity>
                </View>
              );
            }}
          />

          <View style={[styles.checkoutBar, { height: CHECKOUT_HEIGHT }]}>
            <View>
              <View style={styles.projectedRow}>
                <Text style={styles.projectedLabel}>Projected Amount</Text>
                <TouchableOpacity onPress={() => setShowInfo(true)}>
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={16}
                    color={GREEN}
                  />
                </TouchableOpacity>
              </View>

              <Text style={styles.projectedAmount}>
                ₹{projectedAmount.toFixed(2)}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.checkoutBtn}
              onPress={() => router.push("../support/checkout")}
            >
              <Text style={styles.checkoutText}>Checkout</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Modal transparent animationType="fade" visible={showInfo}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowInfo(false)}
        >
          <Pressable style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Charges Breakdown</Text>
              <TouchableOpacity onPress={() => setShowInfo(false)}>
                <MaterialCommunityIcons name="close" size={22} color="#1f2937" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalItem}>🧾 Convenience Fee</Text>
              <Text style={styles.modalDesc}>Below ₹100 → ₹60</Text>
              <Text style={styles.modalDesc}>₹100 – ₹300 → ₹30</Text>
              <Text style={styles.modalDesc}>Above ₹300 → Free</Text>

              <View style={styles.divider} />

              <Text style={styles.modalItem}>Packaging Fee</Text>
              <Text style={styles.modalDesc}>₹5 per 3 items (rounded up)</Text>

              <View style={styles.divider} />

              <Text style={styles.modalItem}>Delivery Fee</Text>
              <Text style={styles.modalDesc}>Flat ₹30</Text>

              <View style={styles.divider} />

              <Text style={styles.modalItem}> META Calculation</Text>
              <Text style={styles.modalDesc}>
                Items: ₹{derivedSubtotal.toFixed(2)}
              </Text>
              <Text style={styles.modalDesc}>Conv: ₹{convFee}</Text>
              <Text style={styles.modalDesc}>Pack: ₹{packagingFee}</Text>
              <Text style={styles.modalDesc}>Delivery: ₹{deliveryFee}</Text>

              <Text style={[styles.modalDesc, { color: GREEN, marginTop: 6 }]}>
                Projected Amount: ₹{projectedAmount.toFixed(2)}
              </Text>

              <Text style={styles.modalNote}>
                Final charges are confirmed at checkout.
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1f2937" },
  clearText: { color: PRIMARY, fontSize: 14, fontWeight: "600" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { color: MUTED, fontSize: 15 },

  itemCard: {
    flexDirection: "row",
    backgroundColor: CARD,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },

  image: { width: 72, height: 72, borderRadius: 8 },
  imagePlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },

  itemInfo: { flex: 1, marginLeft: 12 },
  name: { color: "#1f2937", fontSize: 15, fontWeight: "600" },
  unitPrice: { color: MUTED, fontSize: 13, marginTop: 4 },

  bottomRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  qtyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },

  qtyText: { color: PRIMARY, fontSize: 18, fontWeight: "700" },
  qty: { color: "#1f2937", fontSize: 15, fontWeight: "600", minWidth: 24, textAlign: "center" },
  itemTotal: { color: PRIMARY, fontSize: 16, fontWeight: "700" },
  deleteBtn: { paddingLeft: 8 },

  checkoutBar: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: BORDER,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 8,
  },

  projectedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  projectedLabel: { color: MUTED, fontSize: 13, fontWeight: "600" },
  projectedAmount: { color: "#1f2937", fontSize: 22, fontWeight: "800", marginTop: 2 },

  inlineFees: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },

  inlineFeeText: {
    color: MUTED,
    fontSize: 11,
  },

  checkoutBtn: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 32,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  checkoutText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },

  modalCard: { 
    backgroundColor: CARD, 
    borderRadius: 16, 
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },

  modalTitle: { color: "#1f2937", fontSize: 18, fontWeight: "800" },
  modalBody: { gap: 8 },
  modalItem: { color: "#1f2937", fontSize: 15, fontWeight: "700", marginTop: 8 },
  modalDesc: { color: MUTED, fontSize: 14 },
  modalNote: { color: MUTED, fontSize: 13, marginTop: 12, fontStyle: "italic" },

  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
});
