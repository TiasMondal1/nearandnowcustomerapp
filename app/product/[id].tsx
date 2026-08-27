import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
    LayoutAnimation,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { Image } from "expo-image";

import StarRating from "../../components/StarRating";
import {
    Badge,
    BottomDock,
    EmptyState,
    PrimaryButton,
    Screen,
    ScreenHeader,
    Skeleton,
} from "../../components/ui";
import { C } from "../../constants/colors";
import { useCart } from "../../context/CartContext";
import { cdnImage } from "../../lib/imageUrl";
import { getProductById, type Product } from "../../lib/productService";
import { formatQuantityDisplay } from "../../lib/quantityFormat";

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addItem, items, incrementQty } = useCart();

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);

  const cartItem = items.find((i) => i.product_id === product?.id);

  // Discards a slower-resolving response from a previously-viewed product —
  // without this, opening product A then quickly navigating to product B
  // could let A's response land after B's and show A's data under B's route.
  const requestIdRef = useRef(0);

  useEffect(() => {
    fetchProduct();
  }, [id]);

  const fetchProduct = async () => {
    const myId = ++requestIdRef.current;
    try {
      setLoading(true);
      if (!id) { setProduct(null); return; }

      const data = await getProductById(id as string);
      if (myId !== requestIdRef.current) return;
      setProduct(data);
    } catch {
      if (myId !== requestIdRef.current) return;
      setProduct(null);
    } finally {
      if (myId === requestIdRef.current) setLoading(false);
    }
  };

  const hasDiscount = product?.original_price != null && product.original_price > product.price;
  const discountPct = hasDiscount
    ? Math.round(((product!.original_price! - product!.price) / product!.original_price!) * 100)
    : 0;

  if (loading) {
    // Skeleton mirrors the real layout (hero → title → price → meta pills) so
    // the page doesn't jump when data lands, and the back button stays usable.
    return (
      <Screen>
        <ScreenHeader title="" align="left" onBack={() => router.back()} />
        <View style={styles.heroSkeleton} />
        <View style={styles.detailsCard}>
          <Skeleton width="72%" height={22} />
          <Skeleton width="42%" height={14} style={styles.skeletonGapSm} />
          <Skeleton width={120} height={28} style={styles.skeletonGapMd} />
          <View style={styles.skeletonPills}>
            <Skeleton width={112} height={28} radius={999} />
            <Skeleton width={92} height={28} radius={999} />
          </View>
        </View>
      </Screen>
    );
  }

  if (!product) {
    return (
      <Screen>
        <EmptyState fill icon="alert-circle-outline" iconSize={48} title="Product not found">
          <TouchableOpacity
            style={styles.backLink}
            onPress={() => router.back()}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.backLinkText}>Go back</Text>
          </TouchableOpacity>
        </EmptyState>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title={product.name}
        align="left"
        onBack={() => router.back()}
        titleStyle={styles.headerTitle}
        right={
          !product.in_stock ? (
            <Badge tone="danger" label="Out of Stock" style={styles.oosTag} textStyle={styles.oosTagText} />
          ) : undefined
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.imageWrap}>
          {product.image_url ? (
            <Image
              source={{ uri: cdnImage(product.image_url, 800) }}
              style={styles.heroImage}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={180}
              priority="high"
            />
          ) : (
            <View style={[styles.heroImage, styles.imageFallback]}>
              <MaterialCommunityIcons name="image-off-outline" size={48} color={C.textLight} />
            </View>
          )}
          {hasDiscount && (
            <Badge
              label={`${discountPct}% OFF`}
              bg={C.deal}
              color={C.card}
              style={styles.discountBadge}
              textStyle={styles.discountText}
            />
          )}
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.name}>{product.name}</Text>

          {typeof product.avgRating === "number" && product.avgRating > 0 && (
            <View style={styles.ratingRow}>
              <StarRating rating={product.avgRating} reviewCount={product.reviewCount} starSize={14} />
            </View>
          )}

          <View style={styles.priceRow}>
            <Text style={styles.price}>₹{product.price}</Text>
            {hasDiscount && (
              <Text style={styles.originalPrice}>₹{product.original_price}</Text>
            )}
            <Text style={styles.unit}>/ {product.unit}</Text>
            {hasDiscount && (
              <Badge
                bg={C.dealLight}
                color={C.dealDark}
                label={`Save ₹${(product.original_price! - product.price).toFixed(0)}`}
                style={styles.savingBadge}
              />
            )}
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <MaterialCommunityIcons name="tag-outline" size={13} color={C.primary} />
              <Text style={[styles.metaText, styles.metaTextCategory]} numberOfLines={1}>
                {product.category}
              </Text>
            </View>
            <View style={[styles.metaPill, !product.in_stock && styles.metaPillDanger]}>
              <MaterialCommunityIcons
                name={product.in_stock ? "check-circle-outline" : "close-circle-outline"}
                size={13}
                color={product.in_stock ? C.success : C.danger}
              />
              <Text style={[styles.metaText, !product.in_stock && styles.metaTextDanger]}>
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

      <BottomDock style={styles.bottomBar}>
        {!product.in_stock ? (
          <View style={styles.soldOutBar}>
            <MaterialCommunityIcons name="close-circle-outline" size={20} color={C.textSub} />
            <Text style={styles.soldOutBarText}>Currently unavailable</Text>
          </View>
        ) : !cartItem ? (
          <PrimaryButton
            size="lg"
            icon="cart-plus"
            label="ADD TO CART"
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              addItem({
                product_id: product.id,
                name: product.name,
                price: product.price,
                unit: product.unit,
                image_url: product.image_url,
                isLoose: product.isLoose,
              });
            }}
          />
        ) : (
          <View style={styles.qtyContainer}>
            <View style={styles.qtyLeft}>
              <Text style={styles.qtyLabel}>In your cart</Text>
              <Text style={styles.qtySubLabel}>₹{(product.price * cartItem.quantity).toFixed(2)}</Text>
            </View>
            <View style={styles.qtyControls}>
              <TouchableOpacity
                style={styles.qtyBtn}
                hitSlop={6}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  incrementQty(cartItem.product_id, -1);
                }}
              >
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qty}>{formatQuantityDisplay(cartItem.quantity, product.isLoose)}</Text>
              <TouchableOpacity
                style={styles.qtyBtn}
                hitSlop={6}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                onPress={() => incrementQty(cartItem.product_id, 1)}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomDock>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backLink: {
    marginTop: 8,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: C.primaryXLight,
  },
  backLinkText: { color: C.primary, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" },

  // Product names are long — left-aligned, one line, slightly smaller than the
  // 18/800 screen-title scale.
  headerTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 16 },
  oosTag: { paddingVertical: 4, alignSelf: "center" },
  oosTagText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 11 },

  // flexGrow lets the white details card stretch to the bottom bar when the
  // description is short (no grey band); the 140 clearance for the absolute
  // BottomDock now lives in detailsCard.paddingBottom.
  scrollContent: { flexGrow: 1 },
  imageWrap: { position: "relative", backgroundColor: C.bgSoft },
  heroImage: { width: "100%", height: 280 },
  heroSkeleton: { height: 280, backgroundColor: C.bgSoft },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  discountBadge: { position: "absolute", top: 16, left: 16, paddingVertical: 6 },
  discountText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 13 },

  detailsCard: {
    flex: 1,
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
    padding: 20,
    paddingBottom: 140,
  },
  skeletonGapSm: { marginTop: 8 },
  skeletonGapMd: { marginTop: 12 },
  skeletonPills: { flexDirection: "row", gap: 8, marginTop: 16 },
  name: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 22, lineHeight: 28 },
  ratingRow: { marginTop: 8 },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    flexWrap: "wrap",
  },
  price: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 28 },
  originalPrice: { fontFamily: "PlusJakartaSans_500Medium", color: C.textLight, fontSize: 16, textDecorationLine: "line-through" },
  unit: { fontFamily: "PlusJakartaSans_500Medium", color: C.textSub, fontSize: 14 },
  savingBadge: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: "center" },

  metaRow: { flexDirection: "row", gap: 8, marginTop: 16, flexWrap: "wrap" },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    backgroundColor: C.bgSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
  },
  metaPillDanger: { borderColor: C.dangerLight, backgroundColor: C.dangerLight },
  metaText: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.textSub, fontSize: 12 },
  metaTextCategory: { flexShrink: 1 },
  metaTextDanger: { color: C.danger },

  section: { marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.border },
  sectionTitle: { fontFamily: "PlusJakartaSans_700Bold", color: C.text, fontSize: 15, marginBottom: 8 },
  desc: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 14, lineHeight: 22 },

  bottomBar: { paddingTop: 16 },
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
  soldOutBarText: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 15 },

  qtyContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  qtyLeft: { gap: 2 },
  qtyLabel: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.textSub, fontSize: 12 },
  qtySubLabel: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 16 },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
  qtyBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.card, fontSize: 20 },
  qty: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 20, minWidth: 28, textAlign: "center" },
});
