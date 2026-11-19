// AisleRow — Home's "Explore the aisles" row: portrait photo tiles that open real categories. The screen pairs each
// bundled aisle photo with a live category (`matchAisles` in constants/aisles.ts); a tile shows that category's own
// name and opens its own slug. Every tile press is navigation and therefore silent. The row is memoised on a
// signature string, so a catalogue repaint with the same aisles never re-renders the photos.
import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { layout } from "../../constants/ui";
import type { PhotoSlot } from "../brand";
import { PhotoTile, SectionHeader } from "../cards";

export type HomeAisle = { id: string; photo: PhotoSlot; name: string; slug: string };

export type AisleRowProps = {
  /** The aisles joined as `id:slug:name` with `|`. The memo compares this, not the array. */
  signature: string;
  aisles: readonly HomeAisle[];
  /** Tile press (the screen pushes `/category/${slug}`). Keep it stable. */
  onSelect: (slug: string) => void;
  /** Root testID; tiles get `${testID}-${aisle.id}`. */
  testID?: string;
};

const TILE_GAP = 10;

// ─── Stable per-slug handlers ─────────────────────────────────────────────────
// Module-level (same pattern as CategoryTileGrid): one closure per slug, rebuilt only when `onSelect` changes
// identity, so a memoised tile never gets a new `onPress`.

let boundSelect: ((slug: string) => void) | null = null;
const handlerBySlug = new Map<string, () => void>();

function handlerFor(slug: string, onSelect: (slug: string) => void): () => void {
  if (boundSelect !== onSelect) {
    boundSelect = onSelect;
    handlerBySlug.clear();
  }
  let handler = handlerBySlug.get(slug);
  if (!handler) {
    handler = () => onSelect(slug);
    handlerBySlug.set(slug, handler);
  }
  return handler;
}

function AisleRowBase({ aisles, onSelect, testID }: AisleRowProps) {
  return (
    <View testID={testID}>
      <SectionHeader title="Explore the aisles" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {aisles.map((aisle) => (
          <PhotoTile
            key={aisle.id}
            slot={aisle.photo}
            label={aisle.name}
            accessibilityLabel={aisle.name}
            onPress={handlerFor(aisle.slug, onSelect)}
            testID={testID ? `${testID}-${aisle.id}` : undefined}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Memo on the signature string + `onSelect` + `testID`: a new `aisles` array with the same content is free. */
export const AisleRow = React.memo(
  AisleRowBase,
  (a, b) => a.signature === b.signature && a.onSelect === b.onSelect && a.testID === b.testID,
);
AisleRow.displayName = "AisleRow";

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, gap: TILE_GAP, paddingBottom: 4 },
});
