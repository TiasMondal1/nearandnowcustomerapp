import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { Image } from "expo-image";

import { C } from "../../constants/colors";
import { useCartItemMap, useCart } from "../../context/CartContext";
import { useLocation } from "../../context/LocationContext";
import { cdnImage } from "../../lib/imageUrl";
import { searchProducts, type Product } from "../../lib/productService";
import { getNearbyProductFilter } from "../../lib/storeService";
import StarRating from "../../components/StarRating";
import { BackButton, Badge, EmptyState, PrimaryButton, Screen, Skeleton } from "../../components/ui";

// Placeholder rows shown while a search is in flight — same card shape as a result.
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

export default function SearchScreen() {
  const { location } = useLocation();
  // Cache the nearby product filter so we don't re-call Supabase on every keystroke.
  const nearbyIdsRef = useRef<Set<string> | undefined>(undefined);
  const lastLocationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!location) {
      // No location yet (fresh install, geolocation denied, direct deep
      // link into this screen) — the 0-4 km radius filter can't run without
      // coordinates. Search against an empty set rather than falling back
      // to every active store's catalog platform-wide, which would defeat
      // the radius restriction. See bug_fixes doc, 2026-09-03.
      nearbyIdsRef.current = new Set();
      return;
    }
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    if (lastLocationKeyRef.current === key) return;
    lastLocationKeyRef.current = key;
    getNearbyProductFilter(location.latitude, location.longitude).then((filter) => {
      nearbyIdsRef.current = filter?.productIds;
    });
  }, [location?.latitude, location?.longitude]);
  const { addItem, incrementQty } = useCart();
  const cartItemsByProductId = useCartItemMap();
  // Allow `/support/search?q=Amul+Milk` (used by the Order Again fallback card
  // when the item is no longer in the live catalog).
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQuery = typeof params.q === "string" ? params.q : "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const inputRef = useRef<TextInput>(null);

  // Monotonically-increasing request id so a slow stale response can't overwrite
  // a fresher one. Critical when typing fast on a slow network.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      // Bump request id so any in-flight slower response is discarded.
      requestIdRef.current += 1;
      return;
    }

    // Show the loading state instantly even though the network call is debounced —
    // this gives the user feedback that *something* is happening on the very first keystroke
    // after the threshold.
    setLoading(true);
    const myId = ++requestIdRef.current;

    const timeout = setTimeout(async () => {
      try {
        const data = await searchProducts(trimmed, { nearbyIds: nearbyIdsRef.current });
        // Discard stale responses: another query has been typed since this one started.
        if (myId !== requestIdRef.current) return;
        setResults(data);
        setSearched(true);
        setSearchError(false);
      } catch {
        // Previously indistinguishable from a genuine "no results" —
        // searchProducts() already swallows its own errors and resolves []
        // (see lib/productService.ts), so this catch only ever fires for
        // something thrown before that, but keeping a real error state here
        // means the render below doesn't have to guess.
        if (myId !== requestIdRef.current) return;
        setResults([]);
        setSearched(true);
        setSearchError(true);
      } finally {
        if (myId === requestIdRef.current) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [query, location, retryNonce]);

  const doSearch = () => {
    // Keep onSubmitEditing wired to dismiss keyboard / no-op (debounced effect runs on its own).
    inputRef.current?.blur();
  };

  const retrySearch = () => setRetryNonce((n) => n + 1);

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />

        <View style={styles.inputWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color={C.textLight} />
          <TextInput
            ref={inputRef}
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search groceries, snacks, dairy…"
            placeholderTextColor={C.textLight}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={doSearch}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
              hitSlop={10}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <MaterialCommunityIcons name="close-circle" size={18} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.list}>
          {SKELETON_ROWS.map((i) => (
            <View key={i} style={styles.resultCard}>
              <Skeleton width={64} height={64} radius={10} />
              <View style={styles.info}>
                <Skeleton width="80%" height={14} />
                <Skeleton width="40%" height={12} style={styles.skeletonGap} />
                <Skeleton width="30%" height={10} style={styles.skeletonGap} />
              </View>
              <Skeleton width={60} height={32} radius={10} />
            </View>
          ))}
        </View>
      ) : !searched && query.length < 2 ? (
        <EmptyState
          icon="magnify"
          iconSize={48}
          title="Search products"
          text="Type at least 2 characters to search"
        />
      ) : searchError ? (
        <EmptyState
          icon="alert-circle-outline"
          iconSize={48}
          title="Couldn't load results"
          text="Something went wrong — try again"
          action={{ label: "Try again", onPress: retrySearch }}
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon="emoticon-sad-outline"
          iconSize={48}
          title={`No results for "${query}"`}
          text="Try a different keyword or browse categories"
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            const cartItem = cartItemsByProductId.get(item.id);
            const hasDiscount = item.original_price != null && item.original_price > item.price;

            return (
              <TouchableOpacity
                style={styles.resultCard}
                onPress={() => router.push(`../product/${item.id}`)}
                activeOpacity={0.85}
              >
                {item.image_url ? (
                  <Image
                    source={{ uri: cdnImage(item.image_url, 240) }}
                    style={styles.image}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    transition={120}
                    priority="low"
                  />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <MaterialCommunityIcons name="image-off-outline" size={22} color={C.textLight} />
                  </View>
                )}

                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.price}>₹{item.price}</Text>
                    {hasDiscount && (
                      <Text style={styles.originalPrice}>₹{item.original_price}</Text>
                    )}
                    <Text style={styles.unit} numberOfLines={1}>{item.unit}</Text>
                  </View>

                  <View style={styles.ratingWrap}>
                    <StarRating
                      rating={item.avgRating ?? 0}
                      reviewCount={item.reviewCount}
                      starSize={12}
                    />
                  </View>

                  <Text style={styles.category} numberOfLines={1}>{item.category}</Text>
                </View>

                {!item.in_stock ? (
                  <Badge
                    label="Out of Stock"
                    bordered
                    borderColor={C.border}
                    style={styles.soldOutTag}
                    textStyle={styles.soldOutTagText}
                  />
                ) : cartItem ? (
                  <View style={styles.qtyRow}>
                    <TouchableOpacity
                      style={styles.qtyBtnWrap}
                      hitSlop={6}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease quantity"
                      onPress={() => incrementQty(item.id, -1)}
                    >
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyValue}>{cartItem.quantity}</Text>
                    <TouchableOpacity
                      style={styles.qtyBtnWrap}
                      hitSlop={6}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Increase quantity"
                      onPress={() => incrementQty(item.id, 1)}
                    >
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <PrimaryButton
                    size="xs"
                    shadow={false}
                    label="ADD"
                    style={styles.addBtn}
                    textStyle={styles.addText}
                    onPress={() =>
                      addItem({
                        product_id: item.id,
                        name: item.name,
                        price: item.price,
                        unit: item.unit,
                        image_url: item.image_url,
                        isLoose: item.isLoose,
                      })
                    }
                  />
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  input: { fontFamily: "PlusJakartaSans_500Medium",
    flex: 1,
    fontSize: 15,
    color: C.text,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: "center",
  },

  // paddingBottom 40 so the last row clears the home indicator once the keyboard is down.
  list: { padding: 16, paddingBottom: 40, gap: 12 },

  resultCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.card,
    padding: 12,
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

  image: { width: 64, height: 64, borderRadius: 10 },
  imagePlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  info: { flex: 1 },
  skeletonGap: { marginTop: 8 },
  name: { color: C.text, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", marginBottom: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  price: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 15 },
  originalPrice: { fontFamily: "PlusJakartaSans_500Medium", color: C.textLight, fontSize: 12, textDecorationLine: "line-through" },
  unit: { fontFamily: "PlusJakartaSans_500Medium", color: C.textSub, fontSize: 12, flexShrink: 1 },
  ratingWrap: { marginTop: 6 },
  category: { fontFamily: "PlusJakartaSans_600SemiBold", color: C.textLight, fontSize: 11, marginTop: 4 },

  soldOutTag: { paddingVertical: 6, alignSelf: "center" },
  soldOutTagText: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 11 },

  addBtn: { paddingVertical: 8, minHeight: 36 },
  addText: { fontFamily: "PlusJakartaSans_800ExtraBold" },

  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryXLight,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  qtyBtnWrap: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: C.primary,
  },
  qtyBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.card, fontSize: 16 },
  qtyValue: { fontFamily: "PlusJakartaSans_700Bold", color: C.text, fontSize: 14, minWidth: 18, textAlign: "center" },
});
