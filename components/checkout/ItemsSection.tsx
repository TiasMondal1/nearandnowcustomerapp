// ItemsSection — the cart lines on the checkout page (design/blinkit-parity §3.7, rigel Stepper md, M33 Undo).
// Rows are keyed by product_id and animate with `layoutTiming()` + `exit.fade()` when a line leaves (carts are
// short, so this is a plain column, not a FlashList — entering/exiting on recycled cells is forbidden anyway).
// Each row is memoised on its CartItem identity: a ± tap re-renders exactly the changed row (the Stepper's own
// per-product subscription repaints the count; the row repaints its line total). Removal at the minimum quantity
// is the Stepper's trash action through CartContext; the SCREEN diffs `items` to offer the Undo toast, so this
// component never calls the cart itself. "Clear cart" and "Add more items" are handlers passed from the screen.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, text } from "../../constants/ui";
import type { CartItem } from "../../context/CartContext";
import { formatMoney } from "../../lib/formatMoney";
import { cdnImage } from "../../lib/imageUrl";
import { formatQuantityDisplay } from "../../lib/quantityFormat";
import { exit, layoutTiming, PressableScale, Stepper, useLayoutTransitionsEnabled, type StepperProduct } from "../ui";

const THUMB = 56;
/** "Clear cart" is 13 px text; the slop lifts it to a 44 pt target. */
const TEXT_BUTTON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

export type ItemsSectionProps = {
  items: CartItem[];
  /** "Clear cart" — the screen plays `heavy`, clears through CartContext and offers Undo. */
  onClearCart: () => void;
  /** "Add more items" — pure navigation (silent): the screen pushes /(tabs)/home. */
  onAddMore: () => void;
  testID?: string;
};

// ─── Row ──────────────────────────────────────────────────────────────────────

function CartLineBase({ item, last }: { item: CartItem; last: boolean }): React.JSX.Element {
  // The Stepper reads its quantity from the per-product subscription; it only needs the product identity + step.
  const product = useMemo<StepperProduct>(
    () => ({
      id: item.product_id,
      name: item.name,
      price: item.price,
      unit: item.unit ?? "",
      image_url: item.image_url,
      isLoose: item.isLoose,
      in_stock: true,
    }),
    [item.product_id, item.name, item.price, item.unit, item.image_url, item.isLoose],
  );
  const lineTotal = formatMoney(item.price * item.quantity);
  const unitText = item.isLoose ? formatQuantityDisplay(item.quantity, true, item.unit) : item.unit ?? "";

  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {item.image_url ? (
        <Image
          source={{ uri: cdnImage(item.image_url, THUMB) }}
          style={styles.thumb}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={motion.imageFade}
          recyclingKey={item.product_id}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.thumb}>
          <MaterialCommunityIcons name="leaf" size={20} color={C.border} />
        </View>
      )}
      <View style={styles.textCol} accessible accessibilityLabel={`${item.name}, ${unitText || "1"}, ${lineTotal}`}>
        <Text style={styles.name} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          {item.name}
        </Text>
        {unitText ? (
          <Text style={styles.unit} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {unitText}
          </Text>
        ) : null}
      </View>
      <Stepper product={product} size="md" />
      <Text style={styles.total} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {lineTotal}
      </Text>
    </View>
  );
}

/** Repaints only when its own CartItem object changes (CartContext keeps untouched lines referentially stable). */
const CartLine = React.memo(CartLineBase, (a, b) => a.item === b.item && a.last === b.last);
CartLine.displayName = "CartLine";

// ─── Section ──────────────────────────────────────────────────────────────────

function ItemsSectionBase({ items, onClearCart, onAddMore, testID }: ItemsSectionProps): React.JSX.Element {
  const layoutEnabled = useLayoutTransitionsEnabled();
  const lastIndex = items.length - 1;

  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          Items
        </Text>
        <PressableScale
          scale={motion.scale.chip}
          onPress={onClearCart}
          hitSlop={TEXT_BUTTON_HIT_SLOP}
          innerStyle={styles.clearBtn}
          pressedStyle={styles.clearBtnPressed}
          accessibilityLabel="Clear cart"
        >
          <Text style={styles.clearText} maxFontSizeMultiplier={1.3}>
            Clear cart
          </Text>
        </PressableScale>
      </View>

      {items.map((item, index) => (
        <Animated.View key={item.product_id} layout={layoutEnabled ? layoutTiming() : undefined} exiting={exit.fade()}>
          <CartLine item={item} last={index === lastIndex} />
        </Animated.View>
      ))}

      <PressableScale
        scale={motion.scale.row}
        onPress={onAddMore}
        innerStyle={styles.addMore}
        pressedStyle={styles.addMorePressed}
        accessibilityLabel="Add more items"
      >
        <MaterialCommunityIcons name="plus-circle-outline" size={18} color={C.primary} />
        <Text style={styles.addMoreText} maxFontSizeMultiplier={1.3}>
          Add more items
        </Text>
      </PressableScale>
    </View>
  );
}

/** Memoised on the `items` array identity + the two handlers (the screen passes stable callbacks). */
export const ItemsSection = React.memo(ItemsSectionBase);
ItemsSection.displayName = "ItemsSection";

const styles = StyleSheet.create({
  section: { backgroundColor: C.card, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  title: { ...text.h3 },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.md, minHeight: 32, justifyContent: "center" },
  clearBtnPressed: { backgroundColor: C.bgSoft },
  clearText: { fontFamily: fontFamily.semibold, fontSize: 13, color: C.textSub },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.lg,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: { flex: 1 },
  name: { ...text.bodyStrong, lineHeight: 19 },
  unit: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 16, color: C.textSub, marginTop: 2 },
  total: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text, minWidth: 56, textAlign: "right" },
  addMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  addMorePressed: { backgroundColor: C.bgSoft },
  addMoreText: { fontFamily: fontFamily.bold, fontSize: 13, color: C.primary },
});
