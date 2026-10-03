import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";

import { C } from "../../constants/colors";
import type { IconName } from "./types";

// Retinted 2026-10-03 (codename boreal): the local GREEN / GREEN_X_LIGHT / rgba
// literals that mirrored the tab screens' `T` palettes are gone. Every decorated
// surface now reads the brand tokens, so a palette change in constants/colors.ts
// retints the doodles with it. This file holds NO colour literal.
// W3 (2026-10-03): SoftPanel, PAGE_WALLPAPER_DOODLES and GRID_PANEL_DOODLES had no
// consumers and were removed with their token-derived transparent end stop.

export type DoodleSpec = {
  /** MaterialCommunityIcons glyph name. */
  icon: IconName;
  /** Glyph size in px (18–44 across the shipped scatters). */
  size: number;
  /** Absolute offsets; numbers are px, strings are percentages of the host. */
  top?: DimensionValue;
  bottom?: DimensionValue;
  left?: DimensionValue;
  right?: DimensionValue;
  /** CSS-style rotation, e.g. "-28deg". */
  rotate: string;
  /** Per-glyph opacity override; falls back to the layer's `baseOpacity`. */
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

export type DoodleBackdropProps = {
  /** Hand-tuned scatter (one of the exported *_DOODLES constants or your own). */
  doodles: DoodleSpec[];
  /** Glyph colour. Default `C.primary` (brand green). */
  color?: string;
  /** Opacity applied to every glyph without its own `opacity`. Default 0.08;
   *  wallpapers pass ~0.04–0.05. Keep ≤ 0.09 so text drawn over it stays legible. */
  baseOpacity?: number;
};

/** Scattered grocery line-art (Blinkit-style) rendered as an absolute-fill,
 *  non-interactive layer. Scatters are hand-tuned constants (not randomized)
 *  so a surface renders identically on every launch; percentage offsets keep
 *  them balanced across device widths. At ≤9% opacity the glyphs stay well
 *  below the contrast of any text drawn over them. The host view needs
 *  overflow:"hidden" when glyphs sit on negative offsets. */
export const DoodleBackdrop = React.memo(function DoodleBackdrop({
  doodles,
  color = C.primary,
  baseOpacity = 0.08,
}: DoodleBackdropProps) {
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
