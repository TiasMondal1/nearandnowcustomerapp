// Product page: how much of a loose item to buy (2026-11-16).
//
// By weight: quick picks (250 g … 5 kg) and a box for any amount in grams, rounded to the
// nearest 50 g. By the piece (items with a piece weight, e.g. apples): a fixed price per piece
// and quick picks for 1-6 pieces. Choosing an amount sets the cart line directly
// (`cartActions.setLine`); the dock's +/- then fine-tunes it (50 g, or 1 piece). One line per
// product: choosing the other way replaces what's in the cart, and the hint says so.
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, text } from "../../constants/ui";
import { cartActions, useCartQty, useCartSellBy } from "../../context/CartContext";
import { formatMoney } from "../../lib/formatMoney";
import {
  LOOSE_STEP_KG,
  WEIGHT_PRESETS_KG,
  amountFromTypedGrams,
  formatWeight,
  looseCartLine,
  maxPieces,
  piecePrice,
} from "../../lib/looseQuantity";
import type { Product } from "../../lib/productService";
import { Chip, Input, PrimaryButton, SegmentedControl, notify } from "../ui";

type Mode = "weight" | "piece";

const MODES = [
  { key: "weight", label: "By weight" },
  { key: "piece", label: "By pieces" },
] as const;

const PIECE_PRESETS = [1, 2, 3, 4, 5, 6] as const;

export type LooseAmountPickerProps = { product: Product };

export function LooseAmountPicker({ product }: LooseAmountPickerProps): React.JSX.Element | null {
  const qty = useCartQty(product.id);
  const cartByPiece = useCartSellBy(product.id) === "piece";
  const countable = Boolean(product.pieceWeightG);
  // Opens on the way the cart already holds it; otherwise by weight.
  const [mode, setMode] = useState<Mode>(cartByPiece && countable ? "piece" : "weight");
  const [grams, setGrams] = useState("");
  const [gramsError, setGramsError] = useState<string | null>(null);

  const maxKg = product.maxQuantity && product.maxQuantity > 0 ? product.maxQuantity : undefined;
  const weightPresets = useMemo(() => WEIGHT_PRESETS_KG.filter((kg) => maxKg == null || kg <= maxKg), [maxKg]);
  const pieceMax = product.pieceWeightG ? Math.min(maxPieces(product.maxQuantity, product.pieceWeightG), 99) : 0;
  const piecePresets = useMemo(() => PIECE_PRESETS.filter((n) => n <= pieceMax), [pieceMax]);
  const onePiece = product.pieceWeightG ? piecePrice(product.price, product.pieceWeightG) : 0;

  const inCartThisWay = qty > 0 && cartByPiece === (mode === "piece");
  const inCartOtherWay = qty > 0 && !inCartThisWay;

  const choose = useCallback(
    (amount: number) => {
      cartActions.setLine(looseCartLine(product, mode), amount);
    },
    [product, mode],
  );

  const setTypedGrams = useCallback(() => {
    const result = amountFromTypedGrams(grams, maxKg, product.unit);
    if ("error" in result) {
      setGramsError(result.error);
      return;
    }
    setGramsError(null);
    setGrams("");
    choose(result.kg);
    if (result.note) notify({ id: "loose-amount", title: result.note, tone: "info" });
  }, [grams, maxKg, product.unit, choose]);

  if (!product.isLoose || product.in_stock === false) return null;

  const weightTotal = !cartByPiece && qty > 0 ? product.price * qty : null;
  const pieceTotal = cartByPiece && qty > 0 ? onePiece * qty : null;

  return (
    <View style={styles.wrap} testID="loose-amount-picker">
      <Text style={styles.title} accessibilityRole="header">
        How much?
      </Text>

      {countable ? (
        <SegmentedControl segments={MODES} value={mode} onChange={setMode} style={styles.segments} />
      ) : null}

      {inCartOtherWay ? (
        <Text style={styles.hint}>
          {cartByPiece
            ? `Your cart has ${qty} pc. Choosing a weight replaces it.`
            : `Your cart has ${formatWeight(qty, product.unit)}. Choosing pieces replaces it.`}
        </Text>
      ) : null}

      {mode === "piece" && product.pieceWeightG ? (
        <>
          <Text style={styles.caption}>
            {formatMoney(onePiece)} per piece · about {formatWeight(product.pieceWeightG / 1000, "kg")} each
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {piecePresets.map((n) => (
              <Chip
                key={n}
                label={`${n} pc`}
                selected={inCartThisWay && qty === n}
                onPress={() => choose(n)}
                accessibilityRole="radio"
                accessibilityLabel={`${n} ${n === 1 ? "piece" : "pieces"}, ${formatMoney(onePiece * n)}`}
              />
            ))}
          </View>
          {pieceTotal != null ? (
            <Text style={styles.total}>
              {qty} pc in cart · {formatMoney(pieceTotal)}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.caption}>
            {formatMoney(product.price)} per {product.unit || "kg"} · from {formatWeight(LOOSE_STEP_KG, product.unit)}, in 50 g steps
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {weightPresets.map((kg) => (
              <Chip
                key={kg}
                label={formatWeight(kg, product.unit)}
                selected={inCartThisWay && Math.abs(qty - kg) < 1e-6}
                onPress={() => choose(kg)}
                accessibilityRole="radio"
                accessibilityLabel={`${formatWeight(kg, product.unit)}, ${formatMoney(product.price * kg)}`}
              />
            ))}
          </View>
          <View style={styles.customRow}>
            <Input
              variant="outlined"
              label="Or type an amount in grams"
              value={grams}
              onChangeText={(t) => {
                setGrams(t.replace(/[^0-9]/g, ""));
                if (gramsError) setGramsError(null);
              }}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={setTypedGrams}
              placeholder="e.g. 750"
              maxLength={6}
              error={gramsError}
              containerStyle={styles.customInput}
              testID="loose-amount-grams"
            />
            <PrimaryButton label="Set" size="sm" variant="outline" onPress={setTypedGrams} />
          </View>
          {weightTotal != null ? (
            <Text style={styles.total}>
              {formatWeight(qty, product.unit)} in cart · {formatMoney(weightTotal, { decimals: 2 })}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border },
  title: { ...text.sectionTitle },
  segments: { marginTop: 12 },
  hint: { ...text.rowSubtitle, marginTop: 10, color: C.warningText },
  caption: { ...text.bodySm, marginTop: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  customRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 14 },
  customInput: { flex: 1 },
  total: { marginTop: 12, fontFamily: fontFamily.semibold, fontSize: 13, color: C.text },
});
