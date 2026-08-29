import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";

// Fresh-green accents shared by every decorated surface (mirrors the tab
// screens' local T palettes — keep in sync with T.green / T.greenXLight).
const GREEN = "#2D7A4F";
const GREEN_X_LIGHT = "#EAF6EE";

export type DoodleSpec = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  size: number;
  top?: DimensionValue;
  bottom?: DimensionValue;
  left?: DimensionValue;
  right?: DimensionValue;
  rotate: string;
  opacity?: number;
};

/** Tab-screen header band (~64-70px tall, full width). Glyphs hug the edges
 *  and the gaps between the title/address text and the trailing controls. */
export const TAB_HEADER_DOODLES: DoodleSpec[] = [
  { icon: "corn", size: 20, top: 2, left: "5%", rotate: "-28deg" },
  { icon: "fruit-watermelon", size: 20, bottom: -4, left: "13%", rotate: "18deg" },
  { icon: "food-apple-outline", size: 20, top: 8, left: "30%", rotate: "-15deg" },
  { icon: "carrot", size: 24, top: 32, left: "41%", rotate: "22deg" },
  { icon: "fruit-grapes-outline", size: 22, top: 2, left: "53%", rotate: "12deg" },
  { icon: "bottle-soda-outline", size: 20, top: 30, left: "64%", rotate: "-18deg" },
  { icon: "baguette", size: 22, top: 6, left: "73%", rotate: "35deg" },
  { icon: "cheese", size: 18, bottom: 2, left: "84%", rotate: "-12deg" },
  { icon: "leaf", size: 26, top: -6, right: -4, rotate: "-24deg", opacity: 0.09 },
];

/** Page wallpaper — big, sparse, extra-faint glyphs across the whole screen.
 *  Sits as a fixed layer behind a scrolling list, so it mostly shows through
 *  the gaps between opaque cards: texture, not decoration. Pass a low
 *  baseOpacity (~0.04-0.05). */
export const PAGE_WALLPAPER_DOODLES: DoodleSpec[] = [
  { icon: "basket-outline", size: 44, top: "9%", left: "6%", rotate: "-14deg" },
  { icon: "fruit-pineapple", size: 38, top: "14%", right: "8%", rotate: "18deg" },
  { icon: "food-croissant", size: 36, top: "24%", left: "42%", rotate: "-22deg" },
  { icon: "egg-outline", size: 32, top: "32%", left: "8%", rotate: "12deg" },
  { icon: "ice-cream", size: 38, top: "37%", right: "6%", rotate: "-16deg" },
  { icon: "noodles", size: 40, top: "48%", left: "28%", rotate: "10deg" },
  { icon: "cup-outline", size: 34, top: "55%", right: "20%", rotate: "-20deg" },
  { icon: "fish", size: 38, top: "63%", left: "9%", rotate: "16deg" },
  { icon: "muffin", size: 34, top: "71%", right: "9%", rotate: "-12deg" },
  { icon: "food-apple-outline", size: 40, top: "80%", left: "38%", rotate: "20deg" },
  { icon: "carrot", size: 36, top: "89%", left: "10%", rotate: "-26deg" },
  { icon: "cookie-outline", size: 32, top: "87%", right: "14%", rotate: "14deg" },
];

/** Corner accents for a SoftPanel behind a tile/card grid. */
export const GRID_PANEL_DOODLES: DoodleSpec[] = [
  { icon: "leaf", size: 22, top: 8, right: 16, rotate: "-20deg" },
  { icon: "basket-outline", size: 22, bottom: 8, left: 16, rotate: "14deg" },
  { icon: "fruit-cherries", size: 18, bottom: 12, right: "27%", rotate: "-12deg" },
];

/** Scattered grocery line-art (Blinkit-style) rendered as an absolute-fill,
 *  non-interactive layer. Scatters are hand-tuned constants (not randomized)
 *  so a surface renders identically on every launch; percentage offsets keep
 *  them balanced across device widths. At ≤9% opacity the glyphs stay well
 *  below the contrast of any text drawn over them. The host view needs
 *  overflow:"hidden" when glyphs sit on negative offsets. */
export const DoodleBackdrop = React.memo(function DoodleBackdrop({
  doodles,
  color = GREEN,
  baseOpacity = 0.08,
}: {
  doodles: DoodleSpec[];
  color?: string;
  baseOpacity?: number;
}) {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {doodles.map((d, i) => (
        <MaterialCommunityIcons
          key={i}
          name={d.icon}
          size={d.size}
          color={color}
          style={{
            position: "absolute",
            top: d.top,
            bottom: d.bottom,
            left: d.left,
            right: d.right,
            opacity: d.opacity ?? baseOpacity,
            transform: [{ rotate: d.rotate }],
          }}
        />
      ))}
    </View>
  );
});

/** Inset rounded green wash with a hairline border — grounds a tile grid or
 *  carousel as a "container box" on a cream/white band (the zoning treatment
 *  introduced on home's shop-by-category grid). Absolutely positioned behind
 *  its siblings; pass `style` to override the default 2/8 insets. */
export function SoftPanel({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient
      colors={[GREEN_X_LIGHT, "rgba(234,246,238,0)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[styles.panel, style]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 2,
    bottom: 2,
    left: 8,
    right: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(45,122,79,0.10)",
  },
});
