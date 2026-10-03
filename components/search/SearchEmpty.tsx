// SearchEmpty — what the search screen shows before a query (codename lyra · design/blinkit-parity §3.5 / BP-07 ·
// speed-and-ease #16): "Recent searches" (h3 + a "Clear" link, up to RECENT_SEARCHES_MAX `history` chips from
// lib/recentSearches) and "Trending" (TRENDING_SEARCHES chips). A chip press SETS the query — a state change — so
// Chip's default `select` haptic is kept (CONTRACTS §8). "Clear" only empties a list and stays silent. The screen
// hides the recents block under Dev_Lyra_inhibit_RecentSearches and the whole component under Dev_Lyra_inhibit_Feature.
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { TRENDING_SEARCHES } from "../../constants/searchTrending";
import { HIT_SLOP, layout, motion, text } from "../../constants/ui";
import { RECENT_SEARCHES_MAX } from "../../lib/recentSearches";
import { Chip, PressableScale } from "../ui";

export type SearchEmptyProps = {
  /** Recent terms, newest first (`useRecentSearches()`); only the first RECENT_SEARCHES_MAX (8) render. */
  recents: readonly string[];
  /** false hides the whole recents block (Dev_Lyra_inhibit_RecentSearches). Default true. */
  showRecents?: boolean;
  /** Chip press — the screen sets the query (it counts as a search). Keep it stable (`useCallback`). */
  onSelect: (term: string) => void;
  /** "Clear" link → `clearRecentSearches()`. */
  onClearRecents: () => void;
  /** Extra bottom padding under the last section (CartBar footprint). Default 0. */
  bottomInset?: number;
  /** Root testID; chips get `${testID}-recent-<i>` / `${testID}-trending-<i>`, the link `${testID}-clear`. */
  testID?: string;
};

/**
 * Scrollable column (keyboard taps pass through so a chip works while the field is focused): each section is an
 * `h3` title row + a wrapped chip field (`Chip size="md"`, gap 8). Recents carry the `history` glyph; trending
 * carries `trending-up`. Renders nothing for the recents block when the list is empty.
 */
export function SearchEmpty({ recents, showRecents = true, onSelect, onClearRecents, bottomInset = 0, testID }: SearchEmptyProps): React.JSX.Element {
  const visibleRecents = recents.slice(0, RECENT_SEARCHES_MAX);
  const hasRecents = showRecents && visibleRecents.length > 0;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: layout.scrollBottom + bottomInset }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
      {hasRecents ? (
        <View style={styles.section}>
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              Recent searches
            </Text>
            <PressableScale
              scale={motion.scale.chip}
              onPress={onClearRecents}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches"
              innerStyle={styles.clear}
              pressedStyle={styles.clearPressed}
              testID={testID ? `${testID}-clear` : undefined}
            >
              <Text style={styles.clearText} maxFontSizeMultiplier={1.3}>
                Clear
              </Text>
            </PressableScale>
          </View>
          <View style={styles.chips}>
            {visibleRecents.map((term, i) => (
              <TermChip key={term} term={term} icon="history" onSelect={onSelect} testID={testID ? `${testID}-recent-${i}` : undefined} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            Trending
          </Text>
        </View>
        <View style={styles.chips}>
          {TRENDING_SEARCHES.map((term, i) => (
            <TermChip key={term} term={term} icon="trending-up" onSelect={onSelect} testID={testID ? `${testID}-trending-${i}` : undefined} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

/** One memoised term chip: the per-term closure lives here so the parent passes one stable `onSelect` to every chip. */
const TermChip = React.memo(function TermChip({
  term,
  icon,
  onSelect,
  testID,
}: {
  term: string;
  icon: "history" | "trending-up";
  onSelect: (term: string) => void;
  testID?: string;
}) {
  return <Chip label={term} icon={icon} size="md" onPress={() => onSelect(term)} accessibilityLabel={`Search for ${term}`} testID={testID} />;
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingTop: 8 },
  section: { paddingHorizontal: layout.gutter, paddingTop: 16 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28, marginBottom: 10 },
  title: { ...text.h3 },
  clear: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  clearPressed: { backgroundColor: C.primaryXLight },
  clearText: { ...text.link },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
