import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../../constants/colors";
import { apiFetch } from "../../../lib/apiClient";
import { logSilentFailure } from "../../../lib/logSilentFailure";

interface ReviewableItem {
  productId: string;
  productName: string;
  imageUrl: string | null;
  storeId: string;
  storeName: string;
  alreadyReviewed: boolean;
  existingReview: { rating: number; title: string | null; reviewText: string | null } | null;
}

function formatRating(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const STAR_SIZE = 32;

// Tapping the left half of a star sets the .5 value below it, the right
// half sets the whole number — gives a 1, 1.5, 2, ..., 5 scale from a plain
// row of 5 star icons instead of needing a slider control.
function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value >= n;
        const halfFilled = !filled && value >= n - 0.5;
        return (
          <Pressable
            key={n}
            style={styles.starHit}
            hitSlop={4}
            onPress={(e) => {
              const x = e.nativeEvent.locationX;
              onChange(x < STAR_SIZE / 2 ? n - 0.5 : n);
            }}
          >
            <MaterialCommunityIcons
              name={filled ? "star" : halfFilled ? "star-half-full" : "star-outline"}
              size={28}
              color={filled || halfFilled ? C.warning : C.textLight}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function ReviewItemCard({ item, orderId, onSubmitted }: {
  item: ReviewableItem;
  orderId: string;
  onSubmitted: (productId: string, rating: number) => void;
}) {
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    if (rating < 1) {
      setError("Please pick a star rating.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          productId: item.productId,
          rating,
          reviewText: reviewText.trim() || undefined,
        }),
      });
      onSubmitted(item.productId, rating);
    } catch (err) {
      logSilentFailure("Submit review", err);
      setError(err instanceof Error ? err.message : "Couldn't submit your review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [rating, reviewText, orderId, item.productId, onSubmitted]);

  return (
    <View style={styles.card}>
      <View style={styles.itemRow}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.itemImage} />
        ) : (
          <View style={[styles.itemImage, styles.itemImageFallback]}>
            <MaterialCommunityIcons name="package-variant" size={20} color={C.textLight} />
          </View>
        )}
        <Text style={styles.itemName} numberOfLines={2}>{item.productName}</Text>
      </View>

      {item.alreadyReviewed && item.existingReview ? (
        <View style={styles.submittedRow}>
          <MaterialCommunityIcons name="check-circle" size={16} color={C.primary} />
          <Text style={styles.submittedText}>
            You rated this {formatRating(item.existingReview.rating)} / 5
          </Text>
        </View>
      ) : (
        <>
          <StarPicker value={rating} onChange={(n) => { setRating(n); setError(""); }} />
          <TextInput
            style={styles.textInput}
            placeholder="Share a few words about this product (optional)"
            placeholderTextColor={C.textLight}
            value={reviewText}
            onChangeText={setReviewText}
            multiline
            maxLength={500}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Submit rating</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

export default function RateOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<ReviewableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deliverable, setDeliverable] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await apiFetch<{ success: boolean; deliverable: boolean; items: ReviewableItem[] }>(
        `/api/reviews/orders/${id}/reviewable`,
      );
      setDeliverable(data.deliverable);
      setItems(data.items ?? []);
      setLoadError(false);
    } catch (err) {
      logSilentFailure("Load reviewable items", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const markSubmitted = useCallback((productId: string, rating: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.productId === productId
          ? { ...it, alreadyReviewed: true, existingReview: { rating, title: null, reviewText: null } }
          : it,
      ),
    );
  }, []);

  // Group by store so a multi-store order shows "Store A" with its products
  // and star inputs, then "Store B" with its own, rather than one flat list.
  const groups = useMemo(() => {
    const byStore = new Map<string, { storeId: string; storeName: string; items: ReviewableItem[] }>();
    for (const item of items) {
      const existing = byStore.get(item.storeId);
      if (existing) existing.items.push(item);
      else byStore.set(item.storeId, { storeId: item.storeId, storeName: item.storeName, items: [item] });
    }
    return [...byStore.values()];
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
        <Text style={styles.headerTitle}>Rate your order</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="wifi-off" size={48} color={C.warning} />
          <Text style={styles.emptyTitle}>Couldn&apos;t load this order</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : !deliverable || items.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="star-outline" size={48} color={C.textLight} />
          <Text style={styles.emptyTitle}>Nothing to rate yet</Text>
          <Text style={styles.emptyText}>You can rate products once your order is delivered.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {groups.map((group) => (
            <View key={group.storeId} style={styles.storeGroup}>
              <View style={styles.storeHeader}>
                <MaterialCommunityIcons name="storefront-outline" size={16} color={C.textSub} />
                <Text style={styles.storeHeaderText}>{group.storeName}</Text>
              </View>
              {group.items.map((item) => (
                <ReviewItemCard key={item.productId} item={item} orderId={id!} onSubmitted={markSubmitted} />
              ))}
            </View>
          ))}
        </ScrollView>
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

  list: { padding: 16, paddingBottom: 40 },

  storeGroup: { marginBottom: 20 },
  storeHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingHorizontal: 2 },
  storeHeaderText: { color: C.textSub, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemImage: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.bgSoft },
  itemImageFallback: { alignItems: "center", justifyContent: "center" },
  itemName: { flex: 1, color: C.text, fontSize: 14, fontWeight: "700" },

  starRow: { flexDirection: "row" },
  starHit: { width: STAR_SIZE, height: STAR_SIZE, alignItems: "center", justifyContent: "center" },

  textInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    color: C.text,
    fontSize: 13,
    textAlignVertical: "top",
  },
  errorText: { color: C.danger, fontSize: 12 },

  submitBtn: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  submittedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  submittedText: { color: C.textSub, fontSize: 13, fontWeight: "600" },
});
