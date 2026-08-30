import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { apiFetch } from "../lib/apiClient";
import { cdnImage } from "../lib/imageUrl";
import { logSilentFailure } from "../lib/logSilentFailure";

interface WishlistItem {
  wishlistItemId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  basePrice: number;
  discountedPrice: number;
  unit: string;
  isLoose: boolean;
  gstRate: number | null;
  isActive: boolean;
}

// Same GST-inclusive pricing formula as productService.ts's
// masterRowToProduct — the wishlist API returns pre-tax base/discounted
// prices (like every other master_products read), so GST is applied here
// too rather than baking a client-specific tax calc into the shared response.
function priceWithGst(item: WishlistItem) {
  const gstRate = item.isLoose ? 0 : Number(item.gstRate) || 0;
  const price = item.discountedPrice + (item.discountedPrice * gstRate) / 100;
  const originalPrice = item.basePrice > 0 ? item.basePrice + (item.basePrice * gstRate) / 100 : undefined;
  return { price, originalPrice };
}

export default function WishlistScreen() {
  const { isAuthenticated } = useAuth();
  const { addItem } = useCart();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<{ success: boolean; items: WishlistItem[] }>("/api/wishlist");
      setItems(data.items ?? []);
      setLoadError(false);
    } catch (err) {
      logSilentFailure("Load wishlist", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    load();
  }, [isAuthenticated, load]);

  const remove = useCallback(async (productId: string) => {
    setRemovingId(productId);
    const previous = items;
    setItems((prev) => prev.filter((it) => it.productId !== productId));
    try {
      await apiFetch(`/api/wishlist/${productId}`, { method: "DELETE" });
    } catch (err) {
      logSilentFailure("Remove from wishlist", err);
      setItems(previous);
    } finally {
      setRemovingId(null);
    }
  }, [items]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Wishlist</Text>
        <View style={{ width: 38 }} />
      </View>

      {!isAuthenticated ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="heart-outline" size={48} color={C.textLight} />
          <Text style={styles.emptyTitle}>Sign in required</Text>
          <Text style={styles.emptyText}>Log in to view and save items to your wishlist.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.push("/phone")}>
            <Text style={styles.retryBtnText}>Log In</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="wifi-off" size={48} color={C.warning} />
          <Text style={styles.emptyTitle}>Couldn&apos;t load your wishlist</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="heart-outline" size={48} color={C.textLight} />
          <Text style={styles.emptyTitle}>Your wishlist is empty</Text>
          <Text style={styles.emptyText}>Tap the heart on any product to save it here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.wishlistItemId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => router.push(`/product/${item.productId}` as any)}
            >
              {item.imageUrl ? (
                <Image source={{ uri: cdnImage(item.imageUrl, 160) }} style={styles.image} contentFit="cover" />
              ) : (
                <View style={[styles.image, styles.imageFallback]}>
                  <MaterialCommunityIcons name="image-off-outline" size={20} color={C.textLight} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                {!item.isActive ? (
                  <Text style={styles.unavailable}>No longer available</Text>
                ) : (
                  (() => {
                    const { price, originalPrice } = priceWithGst(item);
                    return (
                      <View style={styles.priceRow}>
                        <Text style={styles.price}>₹{price.toFixed(2)}</Text>
                        {originalPrice !== undefined && originalPrice > price && (
                          <Text style={styles.originalPrice}>₹{originalPrice.toFixed(2)}</Text>
                        )}
                        <Text style={styles.unit}>/ {item.unit}</Text>
                      </View>
                    );
                  })()
                )}
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => remove(item.productId)}
                  disabled={removingId === item.productId}
                  style={styles.iconBtn}
                >
                  <MaterialCommunityIcons name="heart" size={20} color={C.danger} />
                </TouchableOpacity>
                {item.isActive && (
                  <TouchableOpacity
                    onPress={() =>
                      addItem({
                        product_id: item.productId,
                        name: item.name,
                        price: priceWithGst(item).price,
                        unit: item.unit,
                        image_url: item.imageUrl ?? undefined,
                        isLoose: item.isLoose,
                      })
                    }
                    style={[styles.iconBtn, styles.cartBtn]}
                  >
                    <MaterialCommunityIcons name="cart-plus" size={18} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bgSoft,
  },
  headerTitle: { flex: 1, color: C.text, fontSize: 18, fontWeight: "900" },

  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 10 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "800" },
  emptyText: { color: C.textSub, fontSize: 13, textAlign: "center" },
  retryBtn: { marginTop: 6, backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  retryBtnText: { color: "#fff", fontWeight: "700" },

  list: { padding: 16, gap: 12 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 12,
  },
  image: { width: 56, height: 56, borderRadius: 10, backgroundColor: C.bgSoft },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  name: { color: C.text, fontSize: 14, fontWeight: "700" },
  unavailable: { color: C.textLight, fontSize: 12, marginTop: 4, fontStyle: "italic" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  price: { color: C.primary, fontSize: 15, fontWeight: "800" },
  originalPrice: { color: C.textLight, fontSize: 12, textDecorationLine: "line-through" },
  unit: { color: C.textSub, fontSize: 11 },

  actions: { gap: 8 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cartBtn: { backgroundColor: C.primary },
});
