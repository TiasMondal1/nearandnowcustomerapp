// BillSection — flat "Bill details" block (design/blinkit-parity §3.7; altair sheets replace the two fee Alerts).
// Memoised on primitives; totals NEVER animate (money the customer is about to pay must read instantly). The math
// is the screen's (constants/fees.ts `calcOrderTotal` → projected − discount, + tip, rounded once) — this component
// only formats. Rows with an info sheet are pressable as a whole (label "Platform fee, ₹9.50, more info"); the
// glyph itself is decorative. Opening a sheet plays the BottomSheet's own swoosh and nothing else.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, motion, radius, text } from "../../constants/ui";
import { formatMoney } from "../../lib/formatMoney";
import { BottomSheet, Divider, PressableScale } from "../ui";

/** The two info rows are 36 pt; ±4 lifts them to 44 pt (adjacent rows resolve to the later sibling — no visual change). */
const BILL_ROW_HIT_SLOP = { top: 4, bottom: 4, left: 0, right: 0 };

export type BillSectionProps = {
  subtotal: number;
  /** Coupon savings already applied (0 when none / ineligible). */
  discount: number;
  platformFee: number;
  handlingFee: number;
  /** Always ₹0 today; the row shows "FREE" with `deliveryFeeWas` struck through when it is 0. */
  deliveryFee: number;
  deliveryFeeWas: number;
  /** Rounded rupee tip; the row is hidden at 0. */
  tipAmount: number;
  /** The rounded total the pay button shows — the two must always agree. */
  finalPayable: number;
  testID?: string;
};

type InfoKind = "platform" | "handling";

/** Copy carried over verbatim from the old Alerts. */
const INFO: Record<InfoKind, { title: string; body: string }> = {
  platform: {
    title: "Platform fee",
    body: "A small fee that keeps our app running smoothly so we can keep bringing fresh picks to your door. Thank you for supporting us!",
  },
  handling: {
    title: "Handling fee",
    body: "This goes towards carefully packing and handling your order so it reaches you just right. Thanks for being part of our journey!",
  },
};

const money2 = (n: number) => formatMoney(n, { decimals: 2 });

// ─── Row ──────────────────────────────────────────────────────────────────────

type BillRowProps = {
  label: string;
  /** Pre-formatted value text. */
  value: string;
  /** success = savings / FREE in C.successText. */
  tone?: "default" | "success";
  /** Struck-through "was" text shown before the value (delivery fee). */
  strike?: string;
  /** When set the whole row opens the info sheet and reads "…, more info". */
  onInfo?: () => void;
};

function BillRow({ label, value, tone = "default", strike, onInfo }: BillRowProps): React.JSX.Element {
  const a11y = `${label}, ${value}${onInfo ? ", more info" : ""}`;
  const content = (
    <>
      <View style={styles.labelCol}>
        <Text style={styles.label} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
        {onInfo ? <MaterialCommunityIcons name="information-outline" size={16} color={C.textSub} /> : null}
      </View>
      <View style={styles.valueCol}>
        {strike ? (
          <Text style={styles.strike} maxFontSizeMultiplier={1.3}>
            {strike}
          </Text>
        ) : null}
        <Text style={[styles.value, tone === "success" && styles.valueSuccess]} maxFontSizeMultiplier={1.3}>
          {value}
        </Text>
      </View>
    </>
  );

  if (!onInfo) {
    return (
      <View style={styles.row} accessible accessibilityLabel={a11y}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      scale={motion.scale.row}
      onPress={onInfo}
      hitSlop={BILL_ROW_HIT_SLOP}
      innerStyle={styles.row}
      pressedStyle={styles.rowPressed}
      accessibilityLabel={a11y}
    >
      {content}
    </PressableScale>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function BillSectionBase({
  subtotal,
  discount,
  platformFee,
  handlingFee,
  deliveryFee,
  deliveryFeeWas,
  tipAmount,
  finalPayable,
  testID,
}: BillSectionProps): React.JSX.Element {
  // `kind` survives the close animation so the sheet keeps its title while leaving.
  const [kind, setKind] = useState<InfoKind>("platform");
  const [open, setOpen] = useState(false);
  const show = (k: InfoKind) => {
    setKind(k);
    setOpen(true);
  };
  const close = () => setOpen(false);

  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
        Bill details
      </Text>
      <View style={styles.rows}>
        <BillRow label="Item total" value={money2(subtotal)} />
        {discount > 0 ? <BillRow label="Coupon savings" value={`−${money2(discount)}`} tone="success" /> : null}
        <BillRow label="Platform fee" value={money2(platformFee)} onInfo={() => show("platform")} />
        <BillRow label="Handling fee" value={money2(handlingFee)} onInfo={() => show("handling")} />
        {deliveryFee === 0 ? (
          <BillRow label="Delivery fee" value="FREE" tone="success" strike={formatMoney(deliveryFeeWas)} />
        ) : (
          <BillRow label="Delivery fee" value={money2(deliveryFee)} />
        )}
        {tipAmount > 0 ? <BillRow label="Delivery partner tip" value={money2(tipAmount)} /> : null}
      </View>
      <Divider spacing={10} />
      <View style={styles.totalRow} accessible accessibilityLabel={`To pay, ${formatMoney(finalPayable)}`}>
        <Text style={styles.totalLabel} maxFontSizeMultiplier={1.3}>
          To pay
        </Text>
        <Text style={styles.totalValue} maxFontSizeMultiplier={1.3}>
          {formatMoney(finalPayable)}
        </Text>
      </View>

      <BottomSheet visible={open} onClose={close} title={INFO[kind].title} showClose>
        <Text style={styles.sheetBody}>{INFO[kind].body}</Text>
      </BottomSheet>
    </View>
  );
}

/** Memoised on its numeric props — a Stepper tap elsewhere re-renders this block only when a total changed. */
export const BillSection = React.memo(BillSectionBase);
BillSection.displayName = "BillSection";

const styles = StyleSheet.create({
  section: { backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 14 },
  title: { ...text.h3, marginBottom: 6 },
  rows: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
    paddingVertical: 4,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: C.bgSoft },
  labelCol: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  label: { fontFamily: fontFamily.medium, fontSize: 13, color: C.text },
  valueCol: { flexDirection: "row", alignItems: "center", gap: 6 },
  value: { fontFamily: fontFamily.medium, fontSize: 13, color: C.text },
  valueSuccess: { color: C.successText, fontFamily: fontFamily.bold },
  strike: { ...text.mrp },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalLabel: { fontFamily: fontFamily.extrabold, fontSize: 16, color: C.text },
  totalValue: { ...text.priceLg },
  sheetBody: { ...text.body, color: C.text, paddingBottom: 8 },
});
