// codename: mira
// ArrivalHero — the tracking screen's hero card (design/blinkit-parity §3.13, BP-23; antares countdown copy; cobalt
// offline line). "ARRIVING IN" → minutes (AnimatedNumber roll, per-minute from the LivePill clock) → status copy →
// StepProgress; "Any moment now" at ≤ 1 min, "Running late" past the ETA; delivered → check circle + "Delivered at
// HH:MM" + "Rate order" (the strongest rating entry) + "Back to Home". Under `Dev_Mira_inhibit_Feature` the legacy
// "Estimated delivery by HH:MM" line replaces countdown + progress. Fires no feedback (machine events — motion doc C8).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { C } from "../../constants/colors";
import { getStatusMeta } from "../../constants/orderStatus";
import { fontFamily, layout, text as typo } from "../../constants/ui";
import { useDevFlag } from "../../lib/devFlags";
import { AnimatedNumber, Card, IconWrap, PrimaryButton, enter } from "../ui";
import { formatClock, useTrackingNow } from "./LivePill";
import { StepProgress } from "./StepProgress";

export type ArrivalHeroProps = {
  /** The order status (never a cancelled one — the screen renders those on an EmptyState). */
  status: string;
  /** ISO `estimated_delivery_time`; without it the hero shows the status label instead of a countdown. */
  estimatedDeliveryTime?: string | null;
  /** ISO time of the `order_delivered` event, for "Delivered at HH:MM". */
  deliveredAt?: string | null;
  /** Rider name for the "Delivered by …" line. */
  deliveredBy?: string | null;
  /** True while offline / paused or after a failed poll with data on screen → "Signal lost · last update HH:MM" + Retry. */
  signalLost: boolean;
  /** `useOrderTracking().lastUpdatedAt` — the "last update" clock of the signal-lost line. */
  lastUpdatedAt: number | null;
  onRetry: () => void;
  /** Delivered state: "Rate order" (lg primary). */
  onRate: () => void;
  /** Delivered state: "Back to Home" (ghost). */
  onHome: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Past the ETA by less than this still reads "Any moment now"; beyond it, "Running late" (2026-10-03, mira). */
const LATE_GRACE_MS = 60_000;

function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatMinutes(n: number): string {
  return `${n} min`;
}

/**
 * `Card size="lg"` (r16, hairline) with margin 16. Minutes = `max(1, ceil((eta − now) / 60 s))`, re-evaluated once a
 * minute through `useTrackingNow()` (the LivePill's clock — only this component re-renders on a tick). a11y: the
 * headline is a polite live region (updates per minute only); the minutes carry "Arriving in N minutes".
 */
export function ArrivalHero({
  status,
  estimatedDeliveryTime,
  deliveredAt,
  deliveredBy,
  signalLost,
  lastUpdatedAt,
  onRetry,
  onRate,
  onHome,
  style,
  testID,
}: ArrivalHeroProps): React.JSX.Element {
  const legacy = useDevFlag("Dev_Mira_inhibit_Feature");
  const hideProgress = useDevFlag("Dev_Mira_inhibit_ProgressBar");
  const cobaltInhibited = useDevFlag("Dev_Cobalt_inhibit_Feature");
  const now = useTrackingNow();

  const meta = getStatusMeta(status);
  const etaMs = useMemo(() => parseIso(estimatedDeliveryTime), [estimatedDeliveryTime]);
  const remainingMs = etaMs === null ? null : etaMs - now;
  const late = remainingMs !== null && remainingMs < -LATE_GRACE_MS;
  const minutes = remainingMs === null ? null : Math.max(1, Math.ceil(remainingMs / 60_000));
  const anyMoment = minutes !== null && minutes <= 1 && !late;
  const etaClock = formatClock(estimatedDeliveryTime);

  if (status === "order_delivered") {
    const at = formatClock(deliveredAt);
    return (
      <Card size="lg" borderColor={C.hairline} style={[styles.card, style]} testID={testID}>
        <Animated.View entering={enter.rise()} style={styles.delivered}>
          <IconWrap circle size={64} icon="check" iconSize={34} bg={C.successLight} iconColor={C.success} />
          <Text style={styles.deliveredTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            {at ? `Delivered at ${at}` : "Delivered"}
          </Text>
          <Text style={styles.body} maxFontSizeMultiplier={1.3}>
            {deliveredBy ? `Delivered by ${deliveredBy}. Enjoy!` : meta.description}
          </Text>
          <PrimaryButton size="lg" label="Rate order" icon="star-outline" onPress={onRate} style={styles.rateBtn} />
          <PrimaryButton variant="ghost" label="Back to Home" onPress={onHome} />
        </Animated.View>
      </Card>
    );
  }

  let eyebrow = "Arriving in";
  let headline: React.ReactNode;
  if (legacy || etaMs === null) {
    eyebrow = "Order status";
    headline = (
      <Text style={styles.h1} maxFontSizeMultiplier={1.3}>
        {meta.label}
      </Text>
    );
  } else if (late) {
    eyebrow = "Delivery update";
    headline = (
      <Text style={[styles.h1, styles.late]} maxFontSizeMultiplier={1.3}>
        Running late
      </Text>
    );
  } else if (anyMoment) {
    headline = (
      <Text style={styles.h1} maxFontSizeMultiplier={1.3}>
        Any moment now
      </Text>
    );
  } else {
    headline = (
      <AnimatedNumber
        value={minutes ?? 1}
        format={formatMinutes}
        mode="roll"
        style={styles.display}
        accessibilityLabel={`Arriving in ${minutes} minutes`}
      />
    );
  }

  const bodyCopy = late ? `We're on it. ${meta.description}` : meta.description;

  return (
    <Card size="lg" borderColor={C.hairline} style={[styles.card, style]} testID={testID}>
      <View accessibilityLiveRegion="polite">
        <Text style={styles.eyebrow} maxFontSizeMultiplier={1.3}>
          {eyebrow}
        </Text>
        {headline}
      </View>
      <Text style={styles.body} maxFontSizeMultiplier={1.3}>
        {bodyCopy}
      </Text>

      {legacy && etaClock ? (
        <View style={styles.legacyRow}>
          <MaterialCommunityIcons name="clock-time-four-outline" size={16} color={C.textSub} />
          <Text style={styles.legacyText} maxFontSizeMultiplier={1.3}>
            Estimated delivery by <Text style={styles.legacyTime}>{etaClock}</Text>
          </Text>
        </View>
      ) : null}

      {!legacy && !hideProgress ? <StepProgress status={status} style={styles.progress} /> : null}

      {signalLost && !cobaltInhibited ? (
        <View style={styles.signalRow}>
          <MaterialCommunityIcons name="wifi-off" size={14} color={C.warningText} />
          <Text style={styles.signalText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {lastUpdatedAt ? `Signal lost · last update ${formatClock(lastUpdatedAt)}` : "Signal lost"}
          </Text>
          <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={onRetry} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: layout.gutter, marginTop: layout.gutter },
  eyebrow: { ...typo.eyebrow, marginBottom: 6 },
  display: { ...typo.display },
  h1: { ...typo.h1 },
  late: { color: C.warningText },
  body: { ...typo.body, marginTop: 8 },
  progress: { marginTop: 16 },
  legacyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  legacyText: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },
  legacyTime: { color: C.text },
  signalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  signalText: { flex: 1, fontFamily: fontFamily.medium, fontSize: 12, color: C.warningText },
  delivered: { alignItems: "center", gap: 8, paddingVertical: 8 },
  deliveredTitle: { ...typo.h1, textAlign: "center", marginTop: 6 },
  rateBtn: { marginTop: 10 },
});
