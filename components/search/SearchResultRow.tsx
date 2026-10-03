// SearchResultRow — one search hit (codename lyra · speed-and-ease #16 · design/blinkit-parity §2.4 "row"). A thin
// wrapper over `ProductCard variant="row"` that adds the category caption (11/500 C.textSub) under the row, aligned
// with the card's text column. The card's own hairline divider is suppressed and redrawn under the caption so the
// caption reads as part of the row. Memoised on product + handler identity; the Stepper inside the card subscribes
// to its own quantity, so a cart tap re-renders the control, never the row (MAP P16). The body press is navigation
// and stays silent — the screen records the query in recents inside `onPress`, then pushes the PDP.
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily } from "../../constants/ui";
import type { Product } from "../../lib/productService";
import { PRODUCT_CARD, ProductCard } from "../ui";

export type SearchResultRowProps = {
  product: Product;
  /** Body press. Default: ProductCard's own `router.push(\`/product/${id}\`)`. The search screen passes a stable handler that also stores the query in recents. */
  onPress?: (product: Product) => void;
  /** Root testID; the card gets `${testID}-card` (and ProductCard's own `-body` / `-stepper` suffixes below it). */
  testID?: string;
};

/** Row padding 12 + 64 px thumb + 12 px gap — the x where the card's name column starts. */
const CAPTION_INSET = 12 + PRODUCT_CARD.rowThumb + 12;

function SearchResultRowBase({ product, onPress, testID }: SearchResultRowProps): React.JSX.Element {
  const caption = product.category?.trim();
  return (
    <View style={styles.wrap} testID={testID}>
      <ProductCard
        variant="row"
        product={product}
        onPress={onPress}
        style={styles.card}
        testID={testID ? `${testID}-card` : undefined}
      />
      {caption ? (
        <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** Memo on product identity + `onPress` + `testID` (ProductCard's own memo covers the rest). */
export const SearchResultRow: React.MemoExoticComponent<(props: SearchResultRowProps) => React.JSX.Element> = React.memo(
  SearchResultRowBase,
  (a, b) => a.product === b.product && a.onPress === b.onPress && a.testID === b.testID,
);
SearchResultRow.displayName = "SearchResultRow";

const styles = StyleSheet.create({
  // The divider lives here (outside the card's scaled press view) so the caption sits above it.
  wrap: {
    backgroundColor: C.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.hairline,
  },
  card: { borderBottomWidth: 0 },
  // Pulled 4 px into the card's 12 px bottom padding so it hangs ~8 px under the price line.
  caption: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 14,
    color: C.textSub,
    paddingLeft: CAPTION_INSET,
    paddingRight: 12,
    marginTop: -4,
    paddingBottom: 10,
  },
});
