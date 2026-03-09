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

import { C } from "../../constants/colors";
import { calcOrderTotal } from "../../constants/fees";
import { useCart } from "../../context/CartContext";

export default function CartScreen() {
  const { items, updateQty, removeItem, clearCart } = useCart();
  const [showInfo, setShowInfo] = useState(false);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items],
  );
  const totalItems = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items],
  );
  const { platformFee, handlingFee, convFee, packagingFee, deliveryFee, projected } = useMemo(
    () => calcOrderTotal(subtotal, totalItems),
    [subtotal, totalItems],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Cart</Text>
        {items.length > 0 ? (
          <TouchableOpacity onPress={clearCart}>
            <Text style={styles.clearText}>Clear all</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 56 }} />
        )}
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="cart-off" size={64} color={C.textLight} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>Add products from the home screen</Text>
          <TouchableOpacity style={styles.shopBtn} onPress={() => router.back()}>
            <Text style={styles.shopBtnText}>Start Shopping</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.product_id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              <View style={styles.billCard}>
                <Text style={styles.billTitle}>Bill Summary</Text>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Items subtotal</Text>
                  <Text style={styles.billValue}>₹{subtotal.toFixed(2)}</Text>
                </View>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Platform fee</Text>
                  <Text style={styles.billValue}>₹{platformFee.toFixed(2)}</Text>
                </View>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Handling fee</Text>
                  <Text style={styles.billValue}>₹{handlingFee.toFixed(2)}</Text>
                </View>
                <View style={styles.billRow}>
                  <View style={styles.billLabelRow}>
                    <Text style={styles.billLabel}>Convenience fee</Text>
                    <TouchableOpacity onPress={() => setShowInfo(true)}>
                      <MaterialCommunityIcons name="information-outline" size={14} color={C.textLight} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.billValue}>₹{convFee}</Text>
                </View>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Packaging fee</Text>
                  <Text style={styles.billValue}>₹{packagingFee}</Text>
                </View>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Delivery fee</Text>
                  <Text style={styles.billValue}>₹{deliveryFee}</Text>
                </View>
                <View style={styles.billDivider} />
                <View style={styles.billRow}>
                  <Text style={styles.billTotal}>Estimated Total</Text>
                  <Text style={styles.billTotalValue}>₹{projected.toFixed(2)}</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.itemCard}>
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={styles.image} />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <MaterialCommunityIcons name="image-off-outline" size={22} color={C.textLight} />
                  </View>
                )}
                <View style={styles.itemInfo}>
                  <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.unitPrice}>₹{item.price} / {item.unit}</Text>
                  <View style={styles.bottomRow}>
                    <View style={styles.qtyRow}>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => updateQty(item.product_id, item.quantity - 1)}
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qty}>{item.quantity}</Text>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => updateQty(item.product_id, item.quantity + 1)}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.itemTotal}>₹{(item.price * item.quantity).toFixed(2)}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => removeItem(item.product_id)}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={C.danger} />
                </TouchableOpacity>
              </View>
            )}
          />

          <View style={styles.checkoutBar}>
            <View>
              <Text style={styles.projectedLabel}>Estimated total</Text>
              <Text style={styles.projectedAmount}>₹{projected.toFixed(2)}</Text>
            </View>
            <TouchableOpacity
              style={styles.checkoutBtn}
              activeOpacity={0.9}
              onPress={() => router.push("../support/checkout")}
            >
              <Text style={styles.checkoutText}>Proceed to Checkout</Text>
              <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </>
      )}

      <Modal transparent animationType="slide" visible={showInfo}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowInfo(false)}>
          <Pressable style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How fees are calculated</Text>
              <TouchableOpacity onPress={() => setShowInfo(false)}>
                <MaterialCommunityIcons name="close" size={22} color={C.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalSectionTitle}>Platform Fee</Text>
              <Text style={styles.modalDesc}>Fixed ₹9.50 per order</Text>
              <View style={styles.divider} />
              <Text style={styles.modalSectionTitle}>Handling Fee</Text>
              <Text style={styles.modalDesc}>Fixed ₹5.50 per order</Text>
              <View style={styles.divider} />
              <Text style={styles.modalSectionTitle}>Convenience Fee</Text>
              <Text style={styles.modalDesc}>Order below ₹100 → ₹60</Text>
              <Text style={styles.modalDesc}>Order ₹100–₹300 → ₹30</Text>
              <Text style={styles.modalDesc}>Order above ₹300 → Free</Text>
              <View style={styles.divider} />
              <Text style={styles.modalSectionTitle}>Packaging Fee</Text>
              <Text style={styles.modalDesc}>₹5 per 3 items (rounded up)</Text>
              <View style={styles.divider} />
              <Text style={styles.modalSectionTitle}>Delivery Fee (Distance-based)</Text>
              <Text style={styles.modalDesc}>0-1 km → ₹15</Text>
              <Text style={styles.modalDesc}>1-2 km → ₹20</Text>
              <Text style={styles.modalDesc}>2-3 km → ₹25</Text>
              <Text style={styles.modalDesc}>3-4 km → ₹30 (maximum)</Text>
              <View style={styles.divider} />
              <Text style={styles.modalNote}>Delivery fee is calculated based on the farthest store from your location. Final charges are confirmed at checkout.</Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  clearText: { color: C.danger, fontSize: 14, fontWeight: "600" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  emptyText: { color: C.textSub, fontSize: 14, textAlign: "center" },
  shopBtn: {
    marginTop: 8,
    backgroundColor: C.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  shopBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  listContent: { paddingTop: 12, paddingBottom: 160, paddingHorizontal: 16 },

  itemCard: {
    flexDirection: "row",
    backgroundColor: C.card,
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  image: { width: 68, height: 68, borderRadius: 10 },
  imagePlaceholder: {
    width: 68,
    height: 68,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  itemInfo: { flex: 1, marginLeft: 12 },
  name: { color: C.text, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  unitPrice: { color: C.textSub, fontSize: 12, marginTop: 3 },
  bottomRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    backgroundColor: C.primaryXLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.primaryLight,
    overflow: "hidden",
  },
  qtyBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  qtyBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  qty: { color: C.text, fontSize: 14, fontWeight: "700", minWidth: 28, textAlign: "center" },
  itemTotal: { color: C.primary, fontSize: 15, fontWeight: "800" },
  deleteBtn: { paddingLeft: 10 },

  billCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  billTitle: { color: C.text, fontSize: 15, fontWeight: "800", marginBottom: 14 },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  billLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  billLabel: { color: C.textSub, fontSize: 14 },
  billValue: { color: C.text, fontSize: 14, fontWeight: "600" },
  billDivider: { height: 1, backgroundColor: C.border, marginVertical: 10 },
  billTotal: { color: C.text, fontSize: 15, fontWeight: "800" },
  billTotalValue: { color: C.primary, fontSize: 18, fontWeight: "900" },

  checkoutBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.card,
    paddingHorizontal: 20,
    paddingVertical: 14,
    paddingBottom: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: C.border,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 10,
  },
  projectedLabel: { color: C.textSub, fontSize: 12, fontWeight: "600" },
  projectedAmount: { color: C.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  checkoutBtn: {
    backgroundColor: C.primary,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  checkoutText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  modalBody: { gap: 6 },
  modalSectionTitle: { color: C.text, fontSize: 14, fontWeight: "700", marginTop: 4 },
  modalDesc: { color: C.textSub, fontSize: 13, lineHeight: 20 },
  modalNote: { color: C.textLight, fontSize: 12, marginTop: 8, fontStyle: "italic", lineHeight: 18 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
});
