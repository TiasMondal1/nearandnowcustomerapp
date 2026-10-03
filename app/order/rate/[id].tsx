// codename: pavo
// Rate your order: GET /api/reviews/orders/:id/reviewable → one flat row per item (thumb · name · StarPicker ·
// optional comment), one Submit in the dock that posts every rated pending item, a thank-you state once the last
// pending item is reviewed. Reachable from the orders list, the order detail and the tracking screen.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { markOrderRated } from "../../../components/orders/OrderRow";
import { StarPicker } from "../../../components/orders/StarPicker";
import StarRating from "../../../components/StarRating";
import {
  BottomDock,
  EmptyState,
  enter,
  Input,
  notify,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  useDockHeight,
} from "../../../components/ui";
import { C } from "../../../constants/colors";
import { layout, motion, radius, text } from "../../../constants/ui";
import { useForceSkeleton, useSlowLoad } from "../../../hooks/useSlowLoad";
import { apiFetch } from "../../../lib/apiClient";
import { getDevFlag } from "../../../lib/devFlags";
import { feedback } from "../../../lib/feedback";
import { cdnImage } from "../../../lib/imageUrl";
import { logError } from "../../../lib/logError";
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

type Draft = { rating: number; comment: string; error: string | null };

const EMPTY_DRAFT: Draft = { rating: 0, comment: "", error: null };
const SKELETON_ROWS = [0, 1] as const;
const STAR_PLACEHOLDERS = [0, 1, 2, 3, 4] as const;
const THUMB = 48;

function formatRating(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/orders");
}

// ─── Row ──────────────────────────────────────────────────────────────────────

type ReviewRowProps = {
  item: ReviewableItem;
  draft: Draft;
  disabled: boolean;
  divider: boolean;
  onRate: (productId: string, rating: number) => void;
  onComment: (productId: string, comment: string) => void;
};

const ReviewRow = React.memo(function ReviewRow({ item, draft, disabled, divider, onRate, onComment }: ReviewRowProps) {
  const uri = cdnImage(item.imageUrl ?? undefined, 120);
  const reviewed = item.alreadyReviewed && item.existingReview;
  return (
    <View style={[styles.itemRow, divider && styles.divider]}>
      <View style={styles.itemTop}>
        <View style={styles.thumb}>
          {uri ? (
            <Image
              source={{ uri }}
              style={styles.thumbImg}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={motion.imageFade}
              recyclingKey={item.productId}
            />
          ) : (
            <MaterialCommunityIcons name="package-variant" size={22} color={C.textLight} />
          )}
        </View>
        <View style={styles.itemText}>
          <Text style={styles.itemName} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {item.productName}
          </Text>
          {reviewed ? (
            <View style={styles.ratedRow}>
              <StarRating rating={item.existingReview!.rating} starSize={16} />
              <Text style={styles.ratedText} maxFontSizeMultiplier={1.3}>
                You rated this {formatRating(item.existingReview!.rating)} / 5
              </Text>
            </View>
          ) : (
            <StarPicker
              value={draft.rating}
              onChange={(n) => onRate(item.productId, n)}
              disabled={disabled}
              accessibilityLabel={`Rate ${item.productName}`}
            />
          )}
        </View>
      </View>
      {reviewed ? (
        item.existingReview!.reviewText ? (
          <Text style={styles.reviewText} numberOfLines={3}>
            “{item.existingReview!.reviewText}”
          </Text>
        ) : null
      ) : (
        <Input
          variant="underline"
          placeholder="Add a comment (optional)"
          value={draft.comment}
          onChangeText={(t) => onComment(item.productId, t)}
          error={draft.error}
          editable={!disabled}
          multiline
          maxLength={500}
          containerStyle={styles.commentWrap}
          accessibilityLabel={`Comment for ${item.productName}`}
        />
      )}
    </View>
  );
});

/** Loading twin: thumb + name + five star placeholders. */
function SkeletonReviewRow() {
  return (
    <View style={[styles.itemRow, styles.divider]}>
      <View style={styles.itemTop}>
        <Skeleton width={THUMB} height={THUMB} radius={radius.lg} />
        <View style={styles.itemText}>
          <Skeleton width="70%" height={14} />
          <View style={styles.skelStars}>
            {STAR_PLACEHOLDERS.map((i) => (
              <Skeleton key={i} width={28} height={28} radius={14} />
            ))}
          </View>
        </View>
      </View>
      <Skeleton width="100%" height={14} />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RateOrderScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const orderId = typeof params.id === "string" ? params.id : "";

  const [items, setItems] = useState<ReviewableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deliverable, setDeliverable] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [thanks, setThanks] = useState(false);
  const seqRef = useRef(0);
  const dockHeight = useDockHeight();

  const load = useCallback(async () => {
    if (!orderId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<{ success: boolean; deliverable: boolean; items: ReviewableItem[] }>(
        `/api/reviews/orders/${encodeURIComponent(orderId)}/reviewable`,
      );
      if (seq !== seqRef.current) return;
      const list = data.items ?? [];
      setDeliverable(data.deliverable);
      setItems(list);
      // Everything already reviewed → the list / detail can stop offering "Rate order".
      if (list.length > 0 && list.every((it) => it.alreadyReviewed)) markOrderRated(orderId);
    } catch (err) {
      if (seq !== seqRef.current) return;
      logError("Load reviewable items", err);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this order");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRate = useCallback((productId: string, rating: number) => {
    setDrafts((prev) => ({ ...prev, [productId]: { ...(prev[productId] ?? EMPTY_DRAFT), rating, error: null } }));
  }, []);
  const onComment = useCallback((productId: string, comment: string) => {
    setDrafts((prev) => ({ ...prev, [productId]: { ...(prev[productId] ?? EMPTY_DRAFT), comment } }));
  }, []);

  const pending = useMemo(() => items.filter((it) => !it.alreadyReviewed), [items]);
  const ratedPending = useMemo(
    () => pending.filter((it) => (drafts[it.productId]?.rating ?? 0) >= 1),
    [pending, drafts],
  );

  // Group by store so a multi-store order shows "Store A" with its products, then "Store B" with its own.
  const groups = useMemo(() => {
    const byStore = new Map<string, { storeId: string; storeName: string; items: ReviewableItem[] }>();
    for (const item of items) {
      const existing = byStore.get(item.storeId);
      if (existing) existing.items.push(item);
      else byStore.set(item.storeId, { storeId: item.storeId, storeName: item.storeName, items: [item] });
    }
    return [...byStore.values()];
  }, [items]);

  const submit = useCallback(async () => {
    if (!orderId || submitting) return;
    const targets = ratedPending;
    if (targets.length === 0) {
      feedback.error();
      notify({ id: "rate-missing", tone: "warning", title: "Pick at least one star rating" });
      return;
    }
    setSubmitting(true);
    const results = await Promise.all(
      targets.map(async (it) => {
        const d = drafts[it.productId] ?? EMPTY_DRAFT;
        try {
          await apiFetch("/api/reviews", {
            method: "POST",
            body: JSON.stringify({
              orderId,
              productId: it.productId,
              rating: d.rating,
              reviewText: d.comment.trim() || undefined,
            }),
          });
          return { productId: it.productId, ok: true as const, rating: d.rating, comment: d.comment.trim() };
        } catch (err) {
          logSilentFailure("Submit review", err);
          return {
            productId: it.productId,
            ok: false as const,
            message: err instanceof Error ? err.message : "Couldn't submit this rating",
          };
        }
      }),
    );
    const okById = new Map<string, { rating: number; comment: string }>();
    const failed: { productId: string; message: string }[] = [];
    for (const r of results) {
      if (r.ok) okById.set(r.productId, { rating: r.rating, comment: r.comment });
      else failed.push({ productId: r.productId, message: r.message });
    }

    setItems((prev) =>
      prev.map((it) => {
        const ok = okById.get(it.productId);
        return ok
          ? { ...it, alreadyReviewed: true, existingReview: { rating: ok.rating, title: null, reviewText: ok.comment || null } }
          : it;
      }),
    );
    // Failed rows keep their stars + comment and show the reason inline; submitted rows drop their draft.
    setDrafts((prev) => {
      const next: Record<string, Draft> = { ...prev };
      for (const f of failed) next[f.productId] = { ...(next[f.productId] ?? EMPTY_DRAFT), error: f.message };
      for (const id of okById.keys()) delete next[id];
      return next;
    });
    setSubmitting(false);

    if (failed.length > 0) {
      feedback.error();
      notify({
        id: "rate-error",
        tone: "error",
        title: failed.length === targets.length ? "Couldn't submit your rating" : `Couldn't submit ${failed.length} of ${targets.length} ratings`,
        message: failed[0].message,
      });
      return;
    }

    const remaining = pending.length - okById.size;
    feedback.tap(); // quiet confirm (W3 F7 / R2-24): light haptic + toast only — `success` is reserved for order placement
    if (remaining > 0) {
      notify({
        id: "rate-thanks",
        tone: "success",
        title: `Rated ${okById.size} item${okById.size === 1 ? "" : "s"}`,
        message: `${remaining} left to rate`,
      });
      return;
    }
    markOrderRated(orderId);
    if (getDevFlag("Dev_Pavo_inhibit_ThankYouState") || getDevFlag("Dev_Pavo_inhibit_Feature")) {
      notify({ id: "rate-thanks", tone: "success", title: "Thanks for rating!" });
      goBack();
      return;
    }
    setThanks(true);
  }, [orderId, submitting, ratedPending, drafts, pending.length]);

  // ─── States ────────────────────────────────────────────────────────────────
  const showSkeleton = useForceSkeleton(loading && items.length === 0);
  const slow = useSlowLoad(showSkeleton);
  const header = <ScreenHeader size="md" title="Rate your order" backFallbackHref="/orders" />;

  if (thanks) {
    return (
      <Screen bg={C.card}>
        {header}
        <Animated.View entering={enter.rise()} style={styles.flex1}>
          <EmptyState
            fill
            iconWrap
            icon="heart"
            title="Thanks for rating!"
            text="It helps nearby stores improve"
            action={{ label: "Done", onPress: goBack }}
          />
        </Animated.View>
      </Screen>
    );
  }

  if (showSkeleton) {
    return (
      <Screen bg={C.card}>
        {header}
        <SkeletonScreen label="Loading items to rate">
          {SKELETON_ROWS.map((i) => (
            <SkeletonReviewRow key={i} />
          ))}
        </SkeletonScreen>
        {slow ? (
          <View style={styles.slowWrap}>
            <Text style={styles.slowText}>Still loading… check your connection</Text>
            <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={load} />
          </View>
        ) : null}
      </Screen>
    );
  }

  if (loadError && items.length === 0) {
    return (
      <Screen bg={C.card}>
        {header}
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Couldn't load this order"
          text={loadError}
          action={{ label: "Retry", icon: "refresh", onPress: load }}
        />
      </Screen>
    );
  }

  if (!deliverable || items.length === 0) {
    return (
      <Screen bg={C.card}>
        {header}
        <EmptyState
          fill
          iconWrap
          icon="star-outline"
          title="Nothing to rate"
          text={deliverable ? "Items you've already rated show here" : "You can rate items once the order is delivered"}
          action={{ label: "Done", onPress: goBack }}
        />
      </Screen>
    );
  }

  const showDock = pending.length > 0;
  const bottomPad = showDock ? dockHeight + 16 : layout.scrollBottom;

  return (
    <Screen bg={C.card} edges={["top"]}>
      {header}
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {groups.map((group) => (
            <View key={group.storeId}>
              {groups.length > 1 ? (
                <View style={styles.storeHeader}>
                  <MaterialCommunityIcons name="storefront-outline" size={14} color={C.textSub} />
                  <Text style={styles.storeHeaderText} numberOfLines={1}>
                    {group.storeName}
                  </Text>
                </View>
              ) : null}
              {group.items.map((item, i) => (
                <ReviewRow
                  key={item.productId}
                  item={item}
                  draft={drafts[item.productId] ?? EMPTY_DRAFT}
                  disabled={submitting}
                  divider={i < group.items.length - 1 || groups.length > 1}
                  onRate={onRate}
                  onComment={onComment}
                />
              ))}
            </View>
          ))}
        </ScrollView>

        {showDock ? (
          <BottomDock>
            <PrimaryButton
              size="lg"
              label={ratedPending.length > 1 ? `Submit ${ratedPending.length} ratings` : "Submit"}
              loading={submitting}
              disabled={ratedPending.length === 0}
              onPress={submit}
            />
          </BottomDock>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  list: { paddingTop: 4 },
  slowWrap: { alignItems: "center", gap: 6, paddingVertical: 12 },
  slowText: { ...text.caption, textAlign: "center" },

  storeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: layout.gutter,
    paddingTop: 16,
    paddingBottom: 4,
  },
  storeHeaderText: { ...text.eyebrow, flex: 1 },

  itemRow: { paddingHorizontal: layout.gutter, paddingVertical: 14, gap: 8 },
  divider: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.lg,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  itemText: { flex: 1, gap: 4 },
  itemName: { ...text.bodyStrong },
  ratedRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  ratedText: { ...text.rowSubtitle },
  reviewText: { ...text.bodySm, fontStyle: "italic" },
  commentWrap: { marginLeft: THUMB + 12 },
  skelStars: { flexDirection: "row", gap: 8 },
});
