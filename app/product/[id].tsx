import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Dimensions,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { useCart } from "../../context/CartContext";
import { getProductById, type Product } from "../../lib/productService";

const { width } = Dimensions.get("window");

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addItem, items, updateQty } = useCart();

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);

  const cartItem = items.find((i) => i.product_id === product?.id);

  useEffect(() => {
    fetchProduct();
  }, [id]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      if (!id) { setProduct(null); return; }

      const data = await getProductById(id as string);
      setProduct(data);
    } catch {
      setProduct(null);
    } finally {
      setLoading(false);
    }
  };

  const hasDiscount = product?.original_price != null && product.original_price > product.price;
  const discountPct = hasDiscount
    ? Math.round(((product!.original_price! - product!.price) / product!.original_price!) * 100)
    : 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={styles.center}>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={C.textLight} />
        <Text style={styles.notFoundText}>Product not found</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{product.name}</Text>
        {!product.in_stock && (
          <View style={styles.oosTag}>
            <Text style={styles.oosTagText}>Out of Stock</Text>
          </View>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={styles.imageWrap}>
          {product.image_url ? (
            <Image source={{ uri: product.image_url }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.imageFallback]}>
              <MaterialCommunityIcons name="image-off-outline" size={48} color={C.textLight} />
            </View>
          )}
          {hasDiscount && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>{discountPct}% OFF</Text>
            </View>
          )}
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.name}>{product.name}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>₹{product.price}</Text>
            {hasDiscount && (
              <Text style={styles.originalPrice}>₹{product.original_price}</Text>
            )}
            <Text style={styles.unit}>/ {product.unit}</Text>
            {hasDiscount && (
              <View style={styles.savingBadge}>
                <Text style={styles.savingText}>Save ₹{(product.original_price! - product.price).toFixed(0)}</Text>
              </View>
            )}
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <MaterialCommunityIcons name="tag-outline" size={13} color={C.primary} />
              <Text style={styles.metaText}>{product.category}</Text>
            </View>
            <View style={[styles.metaPill, !product.in_stock && styles.metaPillDanger]}>
              <MaterialCommunityIcons
                name={product.in_stock ? "check-circle-outline" : "close-circle-outline"}
                size={13}
                color={product.in_stock ? C.success : C.danger}
              />
              <Text style={[styles.metaText, !product.in_stock && { color: C.danger }]}>
                {product.in_stock ? "In Stock" : "Out of Stock"}
              </Text>
            </View>
          </View>

          {product.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About this product</Text>
              <Text style={styles.desc}>{product.description}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        {!product.in_stock ? (
          <View style={styles.soldOutBar}>
            <MaterialCommunityIcons name="close-circle-outline" size={20} color={C.textSub} />
            <Text style={styles.soldOutBarText}>Currently unavailable</Text>
          </View>
        ) : !cartItem ? (
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.addBtn}
            onPress={() =>
              addItem({
                product_id: product.id,
                name: product.name,
                price: product.price,
                unit: product.unit,
                image_url: product.image_url,
              })
            }
          >
            <MaterialCommunityIcons name="cart-plus" size={20} color="#fff" />
            <Text style={styles.addText}>ADD TO CART</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.qtyContainer}>
            <View style={styles.qtyLeft}>
              <Text style={styles.qtyLabel}>In your cart</Text>
              <Text style={styles.qtySubLabel}>₹{(product.price * cartItem.quantity).toFixed(2)}</Text>
            </View>
            <View style={styles.qtyControls}>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => updateQty(cartItem.product_id, cartItem.quantity - 1)}
              >
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qty}>{cartItem.quantity}</Text>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => updateQty(cartItem.product_id, cartItem.quantity + 1)}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 12 },
  notFoundText: { color: C.text, fontSize: 16, fontWeight: "700" },
  backLink: { marginTop: 4 },
  backLinkText: { color: C.primary, fontSize: 14, fontWeight: "600" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  headerTitle: { color: C.text, fontSize: 15, fontWeight: "700", flex: 1 },
  oosTag: {
    backgroundColor: C.dangerLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  oosTagText: { color: C.danger, fontSize: 11, fontWeight: "700" },

  imageWrap: { position: "relative", backgroundColor: C.bgSoft },
  heroImage: { width, height: 280 },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  discountBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    backgroundColor: C.danger,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  discountText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  detailsCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
    padding: 20,
    paddingBottom: 12,
  },
  name: { color: C.text, fontSize: 22, fontWeight: "800", lineHeight: 28 },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    flexWrap: "wrap",
  },
  price: { color: C.primary, fontSize: 28, fontWeight: "900" },
  originalPrice: { color: C.textLight, fontSize: 16, textDecorationLine: "line-through" },
  unit: { color: C.textSub, fontSize: 14 },
  savingBadge: {
    backgroundColor: C.successLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  savingText: { color: C.success, fontSize: 12, fontWeight: "700" },

  metaRow: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.bgSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
  },
  metaPillDanger: { borderColor: C.dangerLight, backgroundColor: C.dangerLight },
  metaText: { color: C.textSub, fontSize: 12, fontWeight: "600" },

  section: { marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.border },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 8 },
  desc: { color: C.textSub, fontSize: 14, lineHeight: 22 },

  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.card,
    padding: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: C.border,
    shadowColor: C.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 },
    elevation: 10,
  },
  soldOutBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    backgroundColor: C.bgSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  soldOutBarText: { color: C.textSub, fontSize: 15, fontWeight: "700" },

  addBtn: {
    backgroundColor: C.primary,
    paddingVertical: 16,
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.3 },

  qtyContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  qtyLeft: { gap: 2 },
  qtyLabel: { color: C.textSub, fontSize: 12, fontWeight: "600" },
  qtySubLabel: { color: C.text, fontSize: 16, fontWeight: "800" },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: C.primaryXLight,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnText: { color: "#fff", fontSize: 20, fontWeight: "800" },
  qty: { color: C.text, fontSize: 20, fontWeight: "800", minWidth: 28, textAlign: "center" },
});
