// AddressBlock — the checkout's sticky "Delivering to" strip (design/blinkit-parity §3.7; quartz returnTo flow).
// Rendered INSIDE the pay dock, above the pay row, so `useDockHeight()` covers it (scroll padding, ToastHost
// offset and the keyboard lift all stay correct). "Change" / "Select" is pure navigation and therefore silent:
// it pushes /select-location with `returnTo=/support/checkout`, which W2-location-screens honours through
// `parseReturnTo` + `router.dismissTo`. The whole strip sits in a `Shake` so a Pay tap without an address can
// point at it (M32) instead of bouncing to an Alert.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius } from "../../constants/ui";
import { PressableScale, Shake } from "../ui";

/** Lifts the 13 px text button to a ≥ 44 pt target without widening the visible pill. */
const CHANGE_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

export type AddressBlockProps = {
  /** Saved label ("Home", "Work"); null when no delivery location is set. */
  label: string | null;
  /** One-line address under the label, ellipsised; null when unknown. */
  address: string | null;
  /** Monotonic counter — increment to shake the strip (the validation target when no address is set). */
  shakeTrigger?: number;
  /** Paints the "Add a delivery address" line and glyph C.danger after a failed Pay tap. */
  error?: boolean;
  testID?: string;
};

function openSelectLocation(): void {
  router.push({ pathname: "/select-location", params: { returnTo: "/support/checkout" } });
}

function AddressBlockBase({ label, address, shakeTrigger = 0, error = false, testID }: AddressBlockProps): React.JSX.Element {
  const hasLocation = !!(label || address);
  const title = hasLocation ? `Delivering to ${label || "your location"}` : "Add a delivery address";
  const cta = hasLocation ? "Change" : "Select";
  const a11yLabel = hasLocation && address ? `${title}. ${address}` : title;

  return (
    <Shake trigger={shakeTrigger} testID={testID}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="map-marker-outline" size={18} color={error ? C.danger : C.primary} />
        <View style={styles.textCol} accessible accessibilityLabel={a11yLabel}>
          <Text style={[styles.title, error && styles.titleError]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {title}
          </Text>
          {hasLocation && address ? (
            <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {address}
            </Text>
          ) : null}
        </View>
        <PressableScale
          scale={motion.scale.chip}
          onPress={openSelectLocation}
          hitSlop={CHANGE_HIT_SLOP}
          innerStyle={styles.cta}
          pressedStyle={styles.ctaPressed}
          accessibilityLabel={hasLocation ? "Change delivery address" : "Select a delivery address"}
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={1.3}>
            {cta}
          </Text>
        </PressableScale>
      </View>
    </Shake>
  );
}

/** Memoised: the dock re-renders on every total change; the address strip only when the location does. */
export const AddressBlock = React.memo(AddressBlockBase);
AddressBlock.displayName = "AddressBlock";

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  textCol: { flex: 1 },
  title: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 18, color: C.text },
  titleError: { color: C.danger },
  address: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 16, color: C.textSub, marginTop: 1 },
  cta: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, minHeight: 32, justifyContent: "center" },
  ctaPressed: { backgroundColor: C.primaryXLight },
  ctaText: { fontFamily: fontFamily.bold, fontSize: 13, color: C.primary },
});
