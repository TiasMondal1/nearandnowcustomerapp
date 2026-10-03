// codename: mira
// StepProgress — the tracking hero's four-step bar (Placed · Packed · On the way · Delivered) on the segmented
// `ProgressBar` (CONTRACTS §4.12): done = C.primary, the active pill pulses once per status change, idle = C.bgSoft.
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily } from "../../constants/ui";
import { ProgressBar } from "../ui";

export const TRACKING_STEPS = ["Placed", "Packed", "On the way", "Delivered"] as const;

/** Status → step index (CONTRACTS card: 0 pending/accepted · 1 preparing/ready · 2 assigned → in_transit · 3 delivered). */
const STEP_BY_STATUS: Record<string, number> = {
  pending_at_store: 0,
  store_accepted: 0,
  preparing_order: 1,
  ready_for_pickup: 1,
  delivery_partner_assigned: 2,
  picking_up: 2,
  order_picked_up: 2,
  in_transit: 2,
  order_delivered: 3,
};

/** 0–3; unknown / future statuses map to 0 (the order is at least placed). */
export function trackingStepIndex(status: string | null | undefined): number {
  if (!status) return 0;
  return STEP_BY_STATUS[status] ?? 0;
}

export type StepProgressProps = {
  /** The order status. */
  status: string;
  /** Default 6 (r3 pills). */
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * `ProgressBar segments={4}` (gap 4, r3) with the four labels under the segments, 11/500: reached steps in `C.text`,
 * the rest in `C.textSub`. Role progressbar + `accessibilityValue` (25/50/75/100 %) come from the bar; the label reads
 * "Order progress: On the way".
 */
export function StepProgress({ status, height = 6, style, testID }: StepProgressProps): React.JSX.Element {
  const active = trackingStepIndex(status);
  const label = TRACKING_STEPS[active];

  return (
    <View style={style} testID={testID}>
      <ProgressBar
        segments={TRACKING_STEPS.length}
        activeIndex={active}
        progress={(active + 1) / TRACKING_STEPS.length}
        height={height}
        accessibilityLabel={`Order progress: ${label}`}
      />
      <View style={styles.labels} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {TRACKING_STEPS.map((step, i) => (
          <Text
            key={step}
            style={[styles.label, i <= active ? styles.labelDone : styles.labelIdle]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {step}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same gap as the segments so each label sits under its own pill.
  labels: { flexDirection: "row", gap: 4, marginTop: 8 },
  label: { flex: 1, textAlign: "center", fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14 },
  labelDone: { color: C.text },
  labelIdle: { color: C.textSub },
});
