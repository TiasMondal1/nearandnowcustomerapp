import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  IconButton,
  ListRow,
  notify,
  Screen,
  SectionLabel,
  Skeleton,
  SkeletonScreen,
  Toggle,
} from "../components/ui";
import { C } from "../constants/colors";
import { layout, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { useForceSkeleton } from "../hooks/useSlowLoad";
import { useFeedbackPrefs } from "../lib/feedback";
import { logSilentFailure } from "../lib/logSilentFailure";
import { getNotificationPreferences, setNotificationPreferences } from "../lib/notificationService";

// Notifications & sounds (tango owns the screen, sirius owns the two feedback rows — design/delight §2.7,
// blinkit-parity §3.18). Presented as a modal route (containedModal on iOS, app/_layout.tsx) and styled as a
// sheet: title + close, two eyebrow groups separated by an 8 px band, flat `ListRow size="lg"` rows with a
// `Toggle` on the right. No Card, no hand-styled Switch, no Alert.
//
// Exactly ONE server toggle. Only `orderUpdates` is gated server-side (notification.service.ts's
// isCustomerNotificationEnabled; missing/unset = enabled) and `setNotificationPreferences` PUTs exactly
// that key. Marketing / wallet-credit toggles are deliberately NOT added: the backend ignores any other key,
// so such a switch would revert or silently do nothing — a fake control (BRIEF ask 9, DECISIONS D6).
// Do not re-add them without a backend change.

// ─── Copy ─────────────────────────────────────────────────────────────────────

const SOUNDS_SUBTITLE =
  "Short clicks for cart, success and errors. Muted by your phone's silent switch on iPhone; follows media volume on Android.";
const HAPTICS_SUBTITLE = "Gentle vibration on taps and confirmations.";

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationPreferencesScreen() {
  const { userId } = useAuth();
  // Device-scoped prefs (nn:prefs:sounds / nn:prefs:haptics): instant, no network, survive logout.
  // This screen never calls a user-scoped clear.
  const [prefs, setFeedbackPref] = useFeedbackPrefs();

  // null = loading (Skeleton twin); the server's own default is `true`.
  const [orderUpdates, setOrderUpdates] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setOrderUpdates(true);
      return;
    }
    (async () => {
      try {
        // Resolves the default (and logs) on failure — the row stays enabled with the default (CONTRACTS §2.23 rev).
        const result = await getNotificationPreferences(userId);
        if (!cancelled) setOrderUpdates(result.orderUpdates);
      } catch (err) {
        logSilentFailure("Fetch notification preferences", err);
        if (!cancelled) {
          setOrderUpdates(true);
          notify({ title: "Couldn't load your preferences", message: "Showing the default for now", tone: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleOrderUpdates = useCallback(
    async (next: boolean) => {
      if (!userId || saving) return;
      const previous = orderUpdates ?? true;
      // Optimistic: the Toggle plays its own `toggle` feedback after this applies; a failure rolls back + toasts.
      setOrderUpdates(next);
      setSaving(true);
      try {
        await setNotificationPreferences(userId, { orderUpdates: next });
      } catch (err) {
        logSilentFailure("Update notification preferences", err);
        setOrderUpdates(previous);
        notify({ title: "Couldn't save preference", message: "Check your connection and try again.", tone: "error" });
      } finally {
        setSaving(false);
      }
    },
    [userId, saving, orderUpdates],
  );

  const handleSounds = useCallback(
    (next: boolean) => {
      void setFeedbackPref("sounds", next);
    },
    [setFeedbackPref],
  );
  const handleHaptics = useCallback(
    (next: boolean) => {
      void setFeedbackPref("haptics", next);
    },
    [setFeedbackPref],
  );

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/notifications");
  }, []);

  // Dev_Onyx_inhibit_SkeletonExit forces the skeleton like every other screen (W3 R3-08).
  const showSkeleton = useForceSkeleton(orderUpdates === null);
  return (
    <Screen bg={C.card}>
      {/* Sheet title row — the modal supplies the only top inset; nothing is padded twice. */}
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          Notifications & sounds
        </Text>
        <IconButton icon="close" bg="transparent" accessibilityLabel="Close" onPress={close} />
      </View>

      <SectionLabel style={styles.groupLabel}>Push notifications</SectionLabel>
      <View style={styles.group}>
        {showSkeleton ? (
          <SkeletonScreen label="Loading notification preferences…">
            <View style={styles.skeletonRow}>
              <View style={styles.skeletonGlyphSlot}>
                <Skeleton width={22} height={22} radius={6} />
              </View>
              <View style={styles.skeletonText}>
                <Skeleton width="40%" height={14} />
                <Skeleton width="72%" height={12} />
              </View>
              <Skeleton width={51} height={31} radius={16} />
            </View>
          </SkeletonScreen>
        ) : (
          <ListRow
            size="lg"
            iconBg="transparent"
            iconColor={C.text}
            icon="package-variant"
            title="Order updates"
            subtitle="Status changes for your orders"
            right={
              <Toggle
                value={orderUpdates ?? true}
                onValueChange={(next) => void handleOrderUpdates(next)}
                disabled={saving || !userId}
                accessibilityLabel="Order updates"
              />
            }
          />
        )}
      </View>

      <View style={styles.band} />

      <SectionLabel style={styles.groupLabel}>In-app feedback</SectionLabel>
      <View style={styles.group}>
        {/* Toggle fires feedback.toggle(next) AFTER the pref applies, so turning Sounds on previews the click. */}
        <ListRow
          size="lg"
          iconBg="transparent"
          iconColor={C.text}
          icon="volume-high"
          title="Sounds"
          subtitle={SOUNDS_SUBTITLE}
          divider
          right={<Toggle value={prefs.sounds} onValueChange={handleSounds} accessibilityLabel="Sounds" />}
        />
        <ListRow
          size="lg"
          iconBg="transparent"
          iconColor={C.text}
          icon="vibrate"
          title="Haptics"
          subtitle={HAPTICS_SUBTITLE}
          right={<Toggle value={prefs.haptics} onValueChange={handleHaptics} accessibilityLabel="Haptics" />}
        />
      </View>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingLeft: layout.gutter + 4,
    paddingRight: layout.gutter - 4,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { ...text.screenTitle, flex: 1 },

  // Label at 20 + 2 (SectionLabel ph2) … rows at group ph4 + ListRow lg ph16 = 20, the ProfileMenu alignment.
  groupLabel: { paddingHorizontal: layout.gutter + 4, paddingTop: 12, marginBottom: 2 },
  group: { paddingHorizontal: 4, paddingBottom: 8 },
  band: { height: 8, backgroundColor: C.surfaceBand },

  // Twin of ListRow lg (ph16 pv16 gap14) with a 22 px glyph slot, two lines and a Switch-sized block.
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 16 },
  skeletonGlyphSlot: { width: 44, alignItems: "center" },
  skeletonText: { flex: 1, gap: 8 },
});
