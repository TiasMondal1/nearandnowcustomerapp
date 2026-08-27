import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    LayoutAnimation,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    BackButton,
    BottomDock,
    Card,
    Divider,
    PrimaryButton,
    Screen,
    ScreenHeader,
    SectionLabel,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { calcOrderTotal, DELIVERY_FEE, HANDLING_FEE, PLATFORM_FEE } from "../../constants/fees";
import { useCart } from "../../context/CartContext";
import { cdnImage } from "../../lib/imageUrl";
import { formatQuantityDisplay } from "../../lib/quantityFormat";

export default function CartScreen() {
  const { items, isHydrated, incrementQty, removeItem, clearCart } = useCart();
  const [showInfo, setShowInfo] = useState(false);

  // Empty cart → home (mirrors website checkout redirect). Gated on
  // isHydrated so a real, non-empty persisted cart that just hasn't finished
  // loading from AsyncStorage yet (e.g. this screen reached via deep link or
  // restored navigation state) doesn't get incorrectly kicked to Home.
  useEffect(() => {
    if (isHydrated && items.length === 0) {
      router.replace("/(tabs)/home");
    }
  }, [isHydrated, items.length]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items],
  );
  const totalItems = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items],
  );
  const { platformFee, handlingFee, deliveryFee, projected } = useMemo(
    () => calcOrderTotal(subtotal, totalItems),
    [subtotal, totalItems],
  );

  if (items.length === 0) {
    // Hydration / redirect frame: keep the header so there is no blank flash
    // while AsyncStorage hydrates or the redirect effect above navigates away.
    return (
      <Screen>
        <ScreenHeader title="Your Cart" onBack={() => router.back()} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={C.primary} />
        </View>
      </Screen>
    );
  }

  const itemCountLabel = `${items.length} item${items.length === 1 ? "" : "s"}`;

  return (
    <Screen>
      <ScreenHeader
        title="Your Cart"
        subtitle={itemCountLabel}
        left={
          <View style={styles.headerSlot}>
            <BackButton onPress={() => router.back()} />
          </View>
        }
        right={
          <TouchableOpacity
            style={[styles.headerSlot, styles.clearBtn]}
            onPress={clearCart}
            hitSlop={8}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.clearText}>Clear all</Text>
          </TouchableOpacity>
        }
      />

      <FlatList
            data={items}
            keyExtractor={(item) => item.product_id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              <View style={styles.billSection}>
                <SectionLabel>Bill Summary</SectionLabel>
                <Card style={styles.billCard}>
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
                      <Text style={styles.billLabel}>Delivery fee</Text>
                      <TouchableOpacity
                        onPress={() => setShowInfo(true)}
                        hitSlop={10}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="How delivery fee is calculated"
                      >
                        <MaterialCommunityIcons name="information-outline" size={16} color={C.textLight} />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.billValue}>
                      {deliveryFee === 0 ? "Free" : `₹${deliveryFee.toFixed(2)}`}
                    </Text>
                  </View>
                  <Divider spacing={12} />
                  <View style={[styles.billRow, styles.billRowLast]}>
                    <Text style={styles.billTotal}>Estimated Total</Text>
                    <Text style={styles.billTotalValue}>₹{projected.toFixed(2)}</Text>
                  </View>
                </Card>
              </View>
            }
            renderItem={({ item }) => (
              <Card shadow="card" style={styles.itemCard}>
                {item.image_url ? (
                  <Image
                    source={{ uri: cdnImage(item.image_url, 200) }}
                    style={styles.image}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    transition={120}
                  />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <MaterialCommunityIcons name="image-off-outline" size={22} color={C.textLight} />
                  </View>
                )}
                <View style={styles.itemInfo}>
                  <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.unitPrice} numberOfLines={1}>₹{item.price} / {item.unit}</Text>
                  <View style={styles.bottomRow}>
                    <View style={styles.qtyRow}>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        hitSlop={6}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Decrease quantity"
                        onPress={() => {
                          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                          incrementQty(item.product_id, -1);
                        }}
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qty}>{formatQuantityDisplay(item.quantity, item.isLoose)}</Text>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        hitSlop={6}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Increase quantity"
                        onPress={() => incrementQty(item.product_id, 1)}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.itemTotal}>₹{(item.price * item.quantity).toFixed(2)}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  hitSlop={6}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    removeItem(item.product_id);
                  }}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={C.danger} />
                </TouchableOpacity>
              </Card>
            )}
          />

          <BottomDock style={styles.checkoutBar}>
            <View>
              <Text style={styles.projectedLabel}>Estimated total</Text>
              <Text style={styles.projectedAmount}>₹{projected.toFixed(2)}</Text>
            </View>
            <PrimaryButton
              label="Proceed to Checkout"
              iconRight="arrow-right"
              iconSize={18}
              fullWidth={false}
              onPress={() => router.push("../support/checkout")}
              style={styles.checkoutBtn}
              textStyle={styles.checkoutText}
            />
          </BottomDock>

      <Modal transparent animationType="slide" visible={showInfo}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowInfo(false)}>
          <Pressable style={styles.modalCard}>
            <View style={styles.grabber} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How fees are calculated</Text>
              <TouchableOpacity
                onPress={() => setShowInfo(false)}
                hitSlop={10}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <MaterialCommunityIcons name="close" size={22} color={C.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalSectionTitle}>Platform Fee</Text>
              <Text style={styles.modalDesc}>Fixed ₹{PLATFORM_FEE.toFixed(2)} per order</Text>
              <Divider />
              <Text style={styles.modalSectionTitle}>Handling Fee</Text>
              <Text style={styles.modalDesc}>Fixed ₹{HANDLING_FEE.toFixed(2)} per order</Text>
              <Divider />
              <Text style={styles.modalSectionTitle}>Delivery Fee</Text>
              <Text style={styles.modalDesc}>
                {DELIVERY_FEE > 0 ? `Fixed ₹${DELIVERY_FEE.toFixed(2)} per order` : "Always free — ₹0"}
              </Text>
              <Divider />
              <Text style={styles.modalNote}>All fees are calculated and confirmed at checkout.</Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  // Symmetric 64px header slots so the centred title is truly centred even
  // though "Clear all" is wider than the 38px back button.
  headerSlot: { width: 64 },
  clearBtn: { minHeight: 38, alignItems: "flex-end", justifyContent: "center" },
  clearText: { color: C.danger, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" },

  listContent: { paddingTop: 12, paddingBottom: 160, paddingHorizontal: 16 },

  itemCard: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
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
  name: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.text, fontSize: 14, lineHeight: 19 },
  unitPrice: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textSub, fontSize: 12, marginTop: 4 },
  bottomRow: {
    marginTop: 12,
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
  qtyBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.card, fontSize: 16 },
  qty: { fontFamily: "PlusJakartaSans_700Bold", color: C.text, fontSize: 14, minWidth: 28, textAlign: "center" },
  itemTotal: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 15 },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },

  billSection: { marginTop: 4 },
  billCard: { marginBottom: 12 },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  billRowLast: { marginBottom: 0 },
  billLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  billLabel: { fontFamily: "PlusJakartaSans_500Medium", color: C.textSub, fontSize: 14 },
  billValue: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.text, fontSize: 14 },
  billTotal: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 15 },
  billTotalValue: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 18 },

  checkoutBar: {
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  projectedLabel: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.textSub, fontSize: 12 },
  projectedAmount: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 22, marginTop: 2 },
  checkoutBtn: { height: 50, paddingVertical: 0 },
  checkoutText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 14 },

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
    paddingTop: 12,
    paddingBottom: 36,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 17 },
  modalBody: { gap: 8 },
  modalSectionTitle: { fontFamily: "PlusJakartaSans_700Bold", color: C.text, fontSize: 14, marginTop: 4 },
  modalDesc: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 13, lineHeight: 20 },
  modalNote: { fontFamily: "PlusJakartaSans_400Regular", color: C.textLight, fontSize: 12, marginTop: 8, fontStyle: "italic", lineHeight: 18 },
});
