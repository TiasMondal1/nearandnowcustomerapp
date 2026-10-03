// Saved-address row shared by /select-location (selectable, radio), /location (inside AddressCard's swipe)
// and the checkout address line. Geometry is ListRow size="lg" iconBg="transparent" byte-for-byte
// (ph16 pv16 gap14, 44 px bare glyph, title 15/700, subtitle 13/400, pressed C.bgSoft, 0.98 row scale,
// divider OUTSIDE the scaled view) so it sits flush with the "Use current location" / "Add new address"
// ListRows above and below it. It is composed here rather than rendered through ListRow because ListRow's
// title and subtitle are string-only: the "Default" Badge must sit inline with the label and the address
// must clamp to two lines (W15-location-foundations, 2026-10-03 — see the crossFileNotes for the ListRow
// `titleAccessory` / `subtitleLines` follow-up that lets this collapse onto ListRow in W3).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { Badge, IconWrap, PressableScale, dur, spr, useMotionReduced, type IconName } from "../ui";
import { C } from "../../constants/colors";
import { border, fontFamily, motion, text } from "../../constants/ui";
import type { SavedAddress } from "../../lib/addressService";

export type AddressRowProps = {
  address: SavedAddress;
  /** Renders a 20 px radio on the right and `accessibilityRole="radio"` (the select-location sheet). */
  selectable?: boolean;
  /** Fills the radio (C.primary ring + 10 px dot popping in on `motion.spring.pop`). */
  selected?: boolean;
  /** Trailing "2.3 km" value (13/400 C.textSub); omitted when null/undefined/non-finite. */
  distanceKm?: number | null;
  /** Without it the row is a plain View (not a button) — no chevron, no press feedback. */
  onPress?: () => void;
  /** Applied to the row itself (the Pressable when pressable): padding overrides, background. */
  style?: StyleProp<ViewStyle>;
  /** Optional extra: 1 px C.border hairline under the row, drawn outside the scaled view (`divider={!isLast}`). */
  divider?: boolean;
  /** Optional extra: custom actions for screen readers (AddressCard exposes its swipe actions here). */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  testID?: string;
};

const RADIO_SIZE = 20;
const RADIO_DOT = 10;
const GLYPH_SIZE = 44;
const GLYPH_ICON = 22;

/** home-outline / office-building-outline / map-marker-outline by label (case-insensitive; "office" counts as work). */
export function addressGlyph(label: string): IconName {
  const lower = label.trim().toLowerCase();
  if (lower.includes("home")) return "home-outline";
  if (lower.includes("work") || lower.includes("office")) return "office-building-outline";
  return "map-marker-outline";
}

/** 20 px radio: idle 1.5 px C.border ring; selected C.primary ring + dot scaled in with the pop spring. Decorative (the row carries the role/state). */
function Radio({ selected }: { selected: boolean }): React.JSX.Element {
  const reduced = useMotionReduced();
  const sel = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      sel.set(selected ? 1 : 0);
      return;
    }
    sel.set(selected ? withSpring(1, spr(motion.spring.pop)) : withTiming(0, { duration: dur(motion.duration.fast) }));
  }, [selected, reduced, sel]);

  const ringStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(Math.min(sel.get(), 1), [0, 1], [C.border, C.primary]),
  }));
  const dotStyle = useAnimatedStyle(() => {
    const s = sel.get();
    return { opacity: s > 0.02 ? 1 : 0, transform: [{ scale: Math.max(s, 0.001) }] };
  });

  return (
    <Animated.View style={[styles.radioRing, ringStyle]} importantForAccessibility="no" accessibilityElementsHidden>
      <Animated.View style={[styles.radioDot, dotStyle]} />
    </Animated.View>
  );
}

/**
 * ListRow-lg address row: bare glyph by label, label 15/700 + "Default" Badge (tone neutral, size sm — the
 * default flag is never worded as a selection, C26) when `is_default`, address 13/400 clamped to two lines,
 * optional distance value, then a radio
 * (`selectable`) or the chevron (pressable). Silent on press: picking an address is the SCREEN's state change
 * (it plays `feedback.toggle(true)`); the row itself only navigates / selects.
 */
export function AddressRow({
  address,
  selectable = false,
  selected = false,
  distanceKm,
  onPress,
  style,
  divider = false,
  accessibilityActions,
  onAccessibilityAction,
  testID,
}: AddressRowProps): React.JSX.Element {
  const label = address.label?.trim() || "Address";
  const line = address.address ?? "";
  const hasDistance = typeof distanceKm === "number" && Number.isFinite(distanceKm);
  const accessibilityLabel = `${label}, ${line}${address.is_default ? ", default" : ""}`;
  const accessibilityState = selectable ? { selected, checked: selected } : undefined;

  const content = (
    <>
      <IconWrap size={GLYPH_SIZE} bg="transparent" icon={addressGlyph(label)} iconSize={GLYPH_ICON} iconColor={C.primary} />
      <View style={styles.textCol}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {label}
          </Text>
          {address.is_default ? <Badge tone="neutral" size="sm" label="Default" /> : null}
        </View>
        {line ? (
          <Text style={styles.subtitle} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {line}
          </Text>
        ) : null}
      </View>
      {hasDistance ? (
        <Text style={styles.value} maxFontSizeMultiplier={1.3}>
          {`${distanceKm.toFixed(1)} km`}
        </Text>
      ) : null}
      {selectable ? (
        <Radio selected={selected} />
      ) : onPress ? (
        <MaterialCommunityIcons name="chevron-right" size={20} color={C.textLight} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={divider ? styles.divider : undefined}>
        <View
          style={[styles.row, style]}
          accessible={!!accessibilityActions}
          accessibilityLabel={accessibilityLabel}
          accessibilityState={accessibilityState}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          testID={testID}
        >
          {content}
        </View>
      </View>
    );
  }

  return (
    <View style={divider ? styles.divider : undefined}>
      <PressableScale
        scale={motion.scale.row}
        innerStyle={[styles.row, style]}
        pressedStyle={styles.pressed}
        onPress={onPress}
        accessibilityRole={selectable ? "radio" : "button"}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={onAccessibilityAction}
        testID={testID}
      >
        {content}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  // ListRow lg geometry (the barrel's ListRow `rowLg`).
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  pressed: { backgroundColor: C.bgSoft },
  divider: { borderBottomWidth: 1, borderBottomColor: C.border },
  textCol: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: C.text, fontSize: 15, fontFamily: fontFamily.bold, flexShrink: 1 },
  subtitle: { fontFamily: fontFamily.regular, color: C.textSub, fontSize: 13, lineHeight: 18, marginTop: 2 },
  value: { ...text.rowValue },
  radioRing: {
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: RADIO_SIZE / 2,
    borderWidth: border.input,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: RADIO_DOT, height: RADIO_DOT, borderRadius: RADIO_DOT / 2, backgroundColor: C.primary },
});
