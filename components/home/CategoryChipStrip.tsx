// CategoryChipStrip — the horizontal chip rail in Home's sticky cell (CONTRACTS §4.18 · design/blinkit-parity BP-10).
// One `Chip` per category with products; the active chip follows the feed (`activeName` from viewability) and a
// press jumps the feed to that category's rail. Selecting a chip changes the active section — a state change — so
// Chip's default `select` haptic is right here and is left untouched (CONTRACTS §8). The strip keeps the active chip
// in view by itself (measured x, animated unless motion is reduced).
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { layout } from "../../constants/ui";
import { Chip, useMotionReduced } from "../ui";

export type CategoryChipStripProps = {
  /** Category names with products, in feed order. */
  names: readonly string[];
  /** The category whose rail is currently in view; null before the first viewability callback. */
  activeName: string | null;
  /** Chip press (the screen scrolls the feed to that rail). Keep it stable (`useCallback`). */
  onSelect: (name: string) => void;
  /** Root testID; chips get `${testID}-${name}`. */
  testID?: string;
};

const CHIP_GAP = 8;
/** 8 above + 32 chip + 8 below = 48 (HOME_ITEM_SIZE.searchWithChips − search). */
const STRIP_PADDING_Y = 8;

// ─── Stable per-chip handlers ─────────────────────────────────────────────────
// Module-level by design: one closure per name, rebuilt only when `onSelect` changes identity, so every memoised
// Chip keeps the same `onPress` across Home re-renders (no inline arrows).

let boundSelect: ((name: string) => void) | null = null;
const handlerByName = new Map<string, () => void>();

function chipHandlers(names: readonly string[], onSelect: (name: string) => void): (() => void)[] {
  if (boundSelect !== onSelect) {
    boundSelect = onSelect;
    handlerByName.clear();
  }
  return names.map((name) => {
    let handler = handlerByName.get(name);
    if (!handler) {
      handler = () => onSelect(name);
      handlerByName.set(name, handler);
    }
    return handler;
  });
}

// ─── Strip ────────────────────────────────────────────────────────────────────

function CategoryChipStripBase({ names, activeName, onSelect, testID }: CategoryChipStripProps) {
  const reduced = useMotionReduced();
  const scrollRef = useRef<ScrollView>(null);
  /** Measured content x per chip (from each chip's onLayout; written in handlers, read in effects/handlers only). */
  const xByName = useRef(new Map<string, number>());
  const activeRef = useRef<string | null>(null);
  const handlers = useMemo(() => chipHandlers(names, onSelect), [names, onSelect]);

  /** Bring `name` to the left gutter (clamped by the ScrollView at both ends). */
  const scrollToName = useCallback((name: string, animated: boolean) => {
    const x = xByName.current.get(name);
    if (x == null) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, x - layout.gutter), animated });
  }, []);

  useEffect(() => {
    activeRef.current = activeName;
    if (activeName) scrollToName(activeName, !reduced);
  }, [activeName, reduced, scrollToName]);

  // A chip's first layout can land after `activeName` is already set: bring it into view then, without animation.
  const handleMeasure = useCallback(
    (name: string, x: number) => {
      xByName.current.set(name, x);
      if (name === activeRef.current) scrollToName(name, false);
    },
    [scrollToName],
  );

  if (names.length === 0) return <View testID={testID} />;

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      accessibilityRole="tablist"
      testID={testID}
    >
      {names.map((name, i) => (
        <ChipSlot
          key={name}
          name={name}
          selected={name === activeName}
          onPress={handlers[i]}
          onMeasure={handleMeasure}
          testID={testID ? `${testID}-${name}` : undefined}
        />
      ))}
    </ScrollView>
  );
}

/** Memo on `names` identity + `activeName` + `onSelect` (the screen keeps all three stable between section changes). */
export const CategoryChipStrip: React.MemoExoticComponent<(props: CategoryChipStripProps) => React.JSX.Element> =
  React.memo(CategoryChipStripBase);
CategoryChipStrip.displayName = "CategoryChipStrip";

// ─── Chip slot ────────────────────────────────────────────────────────────────

/** One measured chip. `Chip` is memoised and announces `selected` itself; its default `select` haptic is kept. */
const ChipSlot = React.memo(function ChipSlot({
  name,
  selected,
  onPress,
  onMeasure,
  testID,
}: {
  name: string;
  selected: boolean;
  onPress: () => void;
  onMeasure: (name: string, x: number) => void;
  testID?: string;
}) {
  const handleLayout = (e: LayoutChangeEvent) => onMeasure(name, e.nativeEvent.layout.x);
  return (
    <View onLayout={handleLayout}>
      <Chip
        label={name}
        size="md"
        selected={selected}
        // Re-pressing the active chip only re-scrolls the feed: silent (one gesture → one haptic on a real change).
        haptic={selected ? false : "select"}
        accessibilityRole="tab"
        onPress={onPress}
        testID={testID}
      />
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: { flexDirection: "row", alignItems: "center", gap: CHIP_GAP, paddingHorizontal: layout.gutter, paddingVertical: STRIP_PADDING_Y },
});
