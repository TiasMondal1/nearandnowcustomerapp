// codename: quartz
// Fixed centre pin for the map picker (design/delight-motion-sound M26): a 40 px C.primary `map-marker` whose
// tip rests on a 6 px C.text ground dot at the exact centre of the map. While the map pans (`lifted`) the pin
// rises 10 px and its shadow spreads 4 → 10 (`withTiming(dur(fast))`) and the dot shrinks to 0.6; on settle it
// drops back on `withSpring(0, spr(pop))` (a 2 px bounce). Reduced motion: no lift — the dot turns C.primary
// instead. Pointer events pass through to the map and the overlay is hidden from assistive tech.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { dur, spr, useMotionReduced } from "../ui";
import { C } from "../../constants/colors";
import { motion } from "../../constants/ui";

export type CentrePinProps = {
  /** True while the map is being dragged (`onRegionChange`); false once it settles (`onRegionChangeComplete`). */
  lifted: boolean;
  /** Extra style for the absolute overlay layer (e.g. to inset it under a header). */
  style?: StyleProp<ViewStyle>;
};

const PIN_SIZE = 40;
const DOT_SIZE = 6;
/** How far the glyph's tip sits above the bottom of its 40 px em box; the pin is nudged down by this much. */
const PIN_TIP_INSET = 3;
const LIFT_PX = 10;
const SHADOW_RADIUS_REST = 4;
const SHADOW_RADIUS_LIFTED = 10;
const DOT_SCALE_LIFTED = 0.6;

/** Absolute, non-interactive centre overlay. Mount it as the last child of the map's parent, above the MapView. */
export function CentrePin({ lifted, style }: CentrePinProps): React.JSX.Element {
  const reduced = useMotionReduced();
  const lift = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      lift.set(0);
      return;
    }
    lift.set(lifted ? withTiming(1, { duration: dur(motion.duration.fast) }) : withSpring(0, spr(motion.spring.pop)));
  }, [lifted, reduced, lift]);

  const pinStyle = useAnimatedStyle(() => {
    const t = lift.get();
    return {
      transform: [{ translateY: PIN_TIP_INSET - t * LIFT_PX }],
      shadowRadius: interpolate(t, [0, 1], [SHADOW_RADIUS_REST, SHADOW_RADIUS_LIFTED]),
      shadowOpacity: interpolate(t, [0, 1], [0.18, 0.3]),
      elevation: interpolate(t, [0, 1], [SHADOW_RADIUS_REST, SHADOW_RADIUS_LIFTED]),
    };
  });

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(lift.get(), [0, 1], [1, DOT_SCALE_LIFTED]) }],
  }));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.layer, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.anchor}>
        <Animated.View style={[styles.dot, reduced && lifted ? styles.dotLifted : null, dotStyle]} />
        <Animated.View style={[styles.pin, pinStyle]}>
          <MaterialCommunityIcons name="map-marker" size={PIN_SIZE} color={C.primary} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { alignItems: "center", justifyContent: "center" },
  // A 40 × 40 box whose BOTTOM edge sits on the layer's centre (negative top margin collapses its margin box),
  // so the pin tip and the dot both land on the map's centre coordinate.
  anchor: { width: PIN_SIZE, height: PIN_SIZE, marginTop: -PIN_SIZE, alignItems: "center", justifyContent: "flex-end" },
  dot: {
    position: "absolute",
    bottom: -DOT_SIZE / 2,
    left: (PIN_SIZE - DOT_SIZE) / 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: C.text,
  },
  dotLifted: { backgroundColor: C.primary },
  pin: {
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: SHADOW_RADIUS_REST,
    elevation: SHADOW_RADIUS_REST,
  },
});
