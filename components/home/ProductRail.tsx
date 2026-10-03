// ProductRail — one horizontal shelf of `ProductCard variant="rail"` (CONTRACTS §4.18 · design/blinkit-parity §2.4
// rail / BP-10 · speed-and-ease #13 rail tuning). Every per-category rail and "Frequently bought" on Home use it.
// The rail is memoised on the products array identity; each card is already memoised and subscribes to its own
// cart quantity through the Stepper, so ADD on one card re-renders that card alone — never the rail, never the feed.
import React from "react";
import { FlatList, StyleSheet, Text, View, type ListRenderItemInfo } from "react-native";

import { layout, text } from "../../constants/ui";
import type { Product } from "../../lib/productService";
import { PRODUCT_CARD, ProductCard } from "../ui";

export type ProductRailProps = {
  /** Rail items (the screen passes the first 10). Pass the same array identity across renders to skip re-renders. */
  products: Product[];
  /** Header title (`text.h3`). No header row when omitted. */
  title?: string;
  /** 3 px bar colour left of the title, e.g. `C.deal` for "Frequently bought". No bar when omitted. */
  accent?: string;
  /** Root testID; the list gets `${testID}-list`. */
  testID?: string;
};

/** Gap between cards; `getItemLayout` and the content container agree on it. */
const GAP = layout.gridGap;
const ACCENT_WIDTH = 3;
const ACCENT_HEIGHT = 18;

// Module-level so the FlatList never sees a new function identity (MAP §2.3 #15).
const keyExtractor = (product: Product): string => product.id;

const getItemLayout = (_data: ArrayLike<Product> | null | undefined, index: number) => ({
  length: PRODUCT_CARD.railWidth,
  offset: (PRODUCT_CARD.railWidth + GAP) * index,
  index,
});

// `recycled`: the rail's own FlatList never recycles, but the rail itself is a row of Home's outer FlashList
// (getItemType recycles same-kind rows), so a recycled row hands every card a new `product`. The Stepper latch
// already suppresses the controls' entering fade, but `animateLayout` is independent of it: without `recycled`
// the ADD ↔ stepper width morph would still play when the incoming product's cart state differs from the outgoing
// one (MAP §7.18 / PLAN §5 rule 9 — W3 R1-RR-1, same as category/[slug], wishlist and order-again).
const renderItem = ({ item }: ListRenderItemInfo<Product>) => <ProductCard variant="rail" product={item} recycled />;

// ─── Rail ─────────────────────────────────────────────────────────────────────

function ProductRailBase({ products, title, accent, testID }: ProductRailProps) {
  return (
    <View style={styles.root} testID={testID}>
      {title ? (
        <View style={styles.header}>
          {accent ? <View style={[styles.accent, { backgroundColor: accent }]} /> : null}
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.3} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      <FlatList
        data={products}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        horizontal
        showsHorizontalScrollIndicator={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews
        contentContainerStyle={styles.content}
        accessibilityLabel={`${title ?? "Products"} products`}
        testID={testID ? `${testID}-list` : undefined}
      />
    </View>
  );
}

/** Memo on `products` identity + `title` + `accent` + `testID` — a parent re-render with the same array is free. */
export const ProductRail: React.MemoExoticComponent<(props: ProductRailProps) => React.JSX.Element> = React.memo(
  ProductRailBase,
  (a, b) => a.products === b.products && a.title === b.title && a.accent === b.accent && a.testID === b.testID,
);
ProductRail.displayName = "ProductRail";

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {},
  // 44 px tall: h3 line height 22 + 12 above + 10 below (HOME_ITEM_SIZE.sectionHeader).
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 10 },
  accent: { width: ACCENT_WIDTH, height: ACCENT_HEIGHT, borderRadius: ACCENT_WIDTH / 2 },
  title: { ...text.h3, flex: 1 },
  content: { paddingHorizontal: layout.gutter, gap: GAP },
});
