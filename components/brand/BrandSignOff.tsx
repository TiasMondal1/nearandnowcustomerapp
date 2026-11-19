import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, space, text } from "../../constants/ui";
import { BRAND_TAGLINE } from "./brand";
import { BrandLogo } from "./BrandLogo";
import { Sprout } from "./Sprout";

export type BrandSignOffProps = {
  /** Optional closing line above the logo, with a 16 dp sprout before it. 12/600 C.textSub. */
  line?: string;
  /** Logo height in dp. Default 24 (width 91). */
  logoHeight?: number;
  /** Show the tagline under the logo. Default true. */
  tagline?: boolean;
  /** Extra lines under the tagline (the version line in the account sheet). */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The brand's closing signature: horizontal logo over the tagline. Not pressable, no role on its root. */
export function BrandSignOff({ line, logoHeight = 24, tagline = true, children, style, testID }: BrandSignOffProps) {
  return (
    <View style={[styles.root, style]} testID={testID}>
      {line ? (
        <View style={styles.lineRow}>
          <Sprout width={16} />
          <Text style={styles.line}>{line}</Text>
        </View>
      ) : null}
      <BrandLogo variant="horizontal" height={logoHeight} decorative={false} />
      {tagline ? (
        <Text style={styles.tagline} maxFontSizeMultiplier={1.3}>
          {BRAND_TAGLINE}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: space[6], marginBottom: space[12] },
  line: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 16, color: C.textSub, flexShrink: 1 },
  tagline: { ...text.caption, color: C.textLight, marginTop: space[4], textAlign: "center" },
});
