import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { layout, space, text } from "../../constants/ui";
import { BrandPhoto } from "./BrandPhoto";
import { hasPhoto, type PhotoSlot } from "./photos";

export type BrandStoryCardProps = {
  /** Photo slot drawn as a 2.25:1 card (radius 16). The whole card returns null when it is unfilled. */
  slot: PhotoSlot;
  /** text.cardTitle (15/800), 12 dp under the photo. */
  title: string;
  /** text.bodySm (13/19), 4 dp under the title. */
  body?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * A photo with a title and a line of copy under it, on the page ground (text is never on the
 * photo). Gutter 16. Not pressable. Read as one element: "<title>. <body>".
 */
export function BrandStoryCard({ slot, title, body, style, testID }: BrandStoryCardProps) {
  if (!hasPhoto(slot)) return null;
  return (
    <View
      style={[styles.root, style]}
      accessible
      accessibilityLabel={body ? `${title}. ${body}` : title}
      testID={testID}
    >
      <BrandPhoto slot={slot} shape="card" />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: layout.gutter },
  title: { ...text.cardTitle, marginTop: space[12] },
  body: { ...text.bodySm, marginTop: space[4] },
});
