// codename: indigo
// Amber simulation stripe (CONTRACTS §5, design §4.5): a 2 px `C.warning` line at the very top of the app (inside the
// safe-area top inset) while any registry flag marked `simulates` holds a non-default value — the Flipper/Reactotron
// convention that stops "why is checkout failing?" from costing an hour. Hidden under Dev_Indigo_inhibit_SimulationStripe
// and Dev_Indigo_inhibit_Feature; invisible to assistive tech; never intercepts touches.
import React, { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { isSimulating, subscribeDevFlags, useDevFlag } from "../../lib/devFlags";

/** Stripe thickness in px. */
export const DEV_SIMULATION_STRIPE_HEIGHT = 2;
/** Above ToastHost (60) and the DevPill layer (70) so a simulated state is never hidden by either. */
const STRIPE_Z_INDEX = 80;

/**
 * Renders `null` unless `isSimulating()` (subscribed through `subscribeDevFlags`, so it re-renders on every flag change)
 * and neither Indigo flag hides it. Absolute, `top: insets.top`, `left/right 0`, height 2, `pointerEvents="none"`,
 * hidden from accessibility. Mounted once by `DevPanelHost`.
 */
export function DevSimulationStripe(): React.JSX.Element | null {
  const simulating = useSyncExternalStore(subscribeDevFlags, isSimulating, isSimulating);
  const stripeInhibited = useDevFlag("Dev_Indigo_inhibit_SimulationStripe");
  const featureInhibited = useDevFlag("Dev_Indigo_inhibit_Feature");
  const insets = useSafeAreaInsets();

  if (!simulating || stripeInhibited || featureInhibited) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.stripe, { top: insets.top }]}
      testID="dev-simulation-stripe"
    />
  );
}

const styles = StyleSheet.create({
  stripe: {
    position: "absolute",
    left: 0,
    right: 0,
    height: DEV_SIMULATION_STRIPE_HEIGHT,
    backgroundColor: C.warning,
    zIndex: STRIPE_Z_INDEX,
    elevation: 0,
  },
});
