import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, layout, surface, text } from "../../constants/ui";
import { BrandFrame } from "../brand";
import type { IconName } from "../ui";
import { SectionHeader } from "./SectionHeader";

export type TrustItem = { icon: IconName; title: string; body: string };

export type TrustTrioProps = {
  /** SectionHeader title. No header when omitted. */
  title?: string;
  /** Three items. Each states something the app already states elsewhere. */
  items: readonly TrustItem[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Above this font scale, or under this window width (dp), the cards stack in a column. */
const STACK_FONT_SCALE = 1.05;
const STACK_WIDTH = 360;

/**
 * A header and a row of flat cards (surface.card, padding 12), each with a 36 dp doorway glyph, a
 * 13/18 bold title and an 11/14 body. Not pressable; each card reads as one element.
 */
function TrustTrioBase({ title, items, style, testID }: TrustTrioProps) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale > STACK_FONT_SCALE || width < STACK_WIDTH;
  return (
    <View style={style} testID={testID}>
      {title ? <SectionHeader title={title} /> : null}
      <View style={stacked ? styles.column : styles.row}>
        {items.map((item) => (
          <View
            key={item.title}
            style={stacked ? styles.cardStacked : styles.card}
            accessible
            accessibilityLabel={`${item.title}. ${item.body}`}
          >
            <BrandFrame size={36} style={styles.frame}>
              <MaterialCommunityIcons name={item.icon} size={20} color={C.primary} />
            </BrandFrame>
            <View style={stacked ? styles.copyStacked : styles.copy}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.body} numberOfLines={5}>
                {item.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export const TrustTrio = React.memo(TrustTrioBase);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", paddingHorizontal: layout.gutter, gap: 8 },
  column: { paddingHorizontal: layout.gutter, gap: 8 },
  card: { ...surface.card, flex: 1, padding: 12, gap: 6 },
  cardStacked: { ...surface.card, flexDirection: "row", alignItems: "center", padding: 12, gap: 12 },
  frame: { alignSelf: "flex-start" },
  copy: { gap: 6 },
  copyStacked: { flex: 1, gap: 2 },
  title: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 18, color: C.text },
  body: { ...text.caption },
});
