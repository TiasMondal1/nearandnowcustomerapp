// Price — the one price primitive (CONTRACTS §4.8 · design/blinkit-parity §2.5 · BP-12). Amount through
// `formatMoney` (en-IN grouping, 0 dp when whole), MRP struck only when it is higher, an optional "% OFF" deal badge
// and, at lg, the " / unit" suffix. Prices are ink (C.text), never green; terracotta is reserved for the deal badge.
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, text } from "../../constants/ui";
import { formatMoney } from "../../lib/formatMoney";
import { Badge } from "./Badge";

export type PriceProps = {
  /** Selling price in rupees (GST-inclusive, as the catalog gives it). */
  amount: number;
  /** MRP / original price. Struck through only when `mrp > amount`. */
  mrp?: number;
  /** Unit label ("500 g"); rendered as " / 500 g" at size lg only. */
  unit?: string;
  /** sm: `text.cardPrice` 13/700 + mrp 11 · md: 16/800 + mrp 12 · lg: `text.priceLg` 22/800 + mrp 14 + unit 13/500. Default 'sm'. */
  size?: "sm" | "md" | "lg";
  /** Append `Badge tone="deal" size="sm"` "12% OFF" when the discount is ≥ 5 %. Default false. */
  showDealBadge?: boolean;
  /** Horizontal alignment of the row. Default 'left'. */
  align?: "left" | "right";
  /**
   * Stack the MRP under the amount instead of inline (grid/rail cards, where 22 px is all that is left beside the
   * Stepper). Default false. The deal badge is never shown stacked — the card carries its own flag.
   */
  stack?: boolean;
  /** Container (margins, flex). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Minimum discount worth shouting about; smaller rounding gaps show the strike only (design §2.5). */
const DEAL_BADGE_MIN_PCT = 5;

/**
 * `round((mrp − amount) / mrp × 100)` when `mrp > amount > …`, else null. Guards NaN/≤ 0; a result of 0 is null so
 * callers can test truthiness.
 */
export function discountPercent(amount: number, mrp?: number): number | null {
  if (mrp == null || !Number.isFinite(mrp) || !Number.isFinite(amount) || mrp <= 0 || mrp <= amount) return null;
  const pct = Math.round(((mrp - amount) / mrp) * 100);
  return pct > 0 ? pct : null;
}

/**
 * "₹28" + struck "₹32" (+ "12% OFF" badge, + " / 500 g" at lg). One accessible text element whose label reads
 * "₹28, was ₹32, 12 percent off, per 500 g". Every text has `maxFontSizeMultiplier={1.3}`.
 */
export function Price({
  amount,
  mrp,
  unit,
  size = "sm",
  showDealBadge = false,
  align = "left",
  stack = false,
  style,
  testID,
}: PriceProps): React.JSX.Element {
  const pct = discountPercent(amount, mrp);
  const strike = pct != null && mrp != null;
  const amountText = formatMoney(amount);
  const mrpText = strike ? formatMoney(mrp) : null;
  const showUnit = size === "lg" && !!unit;
  const showBadge = showDealBadge && !stack && pct != null && pct >= DEAL_BADGE_MIN_PCT;

  const label =
    amountText +
    (mrpText ? `, was ${mrpText}` : "") +
    (pct != null ? `, ${pct} percent off` : "") +
    (showUnit ? `, per ${unit}` : "");

  return (
    <View
      style={[stack ? styles.stack : styles.row, align === "right" && styles.right, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={AMOUNT_STYLE[size]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {amountText}
      </Text>
      {mrpText ? (
        <Text style={MRP_STYLE[size]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {mrpText}
        </Text>
      ) : null}
      {showUnit ? (
        <Text style={styles.unit} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {` / ${unit}`}
        </Text>
      ) : null}
      {showBadge ? <Badge tone="deal" size="sm" label={`${pct}% OFF`} style={styles.badge} /> : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 4, rowGap: 2 },
  stack: { flexDirection: "column", alignItems: "flex-start" },
  right: { justifyContent: "flex-end", alignItems: "flex-end" },
  amountSm: { ...text.cardPrice },
  amountMd: { fontFamily: fontFamily.extrabold, fontSize: 16, lineHeight: 20, letterSpacing: -0.3, color: C.text },
  amountLg: { ...text.priceLg },
  mrpSm: { ...text.mrp },
  mrpMd: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 16, color: C.textSub, textDecorationLine: "line-through" },
  mrpLg: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 18, color: C.textSub, textDecorationLine: "line-through" },
  unit: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: C.textSub },
  badge: { marginLeft: 2 },
});

const AMOUNT_STYLE = { sm: styles.amountSm, md: styles.amountMd, lg: styles.amountLg } as const;
const MRP_STYLE = { sm: styles.mrpSm, md: styles.mrpMd, lg: styles.mrpLg } as const;
