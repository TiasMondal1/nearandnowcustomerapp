import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

import { BRAND_NAME, LOGO, type LogoVariant } from "./brand";

export type BrandLogoProps = {
  /** "mark" (n + sprout) | "horizontal" (mark + name) | "stacked" (mark over name). */
  variant: LogoVariant;
  /** Rendered height in dp. Width = round(height x aspect). Default 24. */
  height?: number;
  /** Default true: hidden from assistive tech. false gives role "image" and the label "Near & Now". */
  decorative?: boolean;
  style?: StyleProp<ImageStyle>;
  testID?: string;
};

/**
 * The only way a logo is drawn. Full colour only. Core `Image` (not expo-image) so the crash
 * path gains no dependency.
 */
export function BrandLogo({ variant, height = 24, decorative = true, style, testID }: BrandLogoProps) {
  const logo = LOGO[variant];
  const width = Math.round(height * logo.aspect);
  return (
    <Image
      source={logo.source}
      resizeMode="contain"
      fadeDuration={0}
      accessibilityIgnoresInvertColors
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : BRAND_NAME}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no" : "yes"}
      style={[{ width, height }, style]}
      testID={testID}
    />
  );
}
