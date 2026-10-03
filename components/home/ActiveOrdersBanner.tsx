// codename: vega
// ActiveOrdersBanner — the "order in flight" strip docked flush on the tab bar, extracted from
// app/(tabs)/home.tsx (ActiveOrderCard, :2000-2060) by W2-home-screen (design/blinkit-parity §3.1 item 8).
// It keeps the "extension of the tab bar" placement (`bottom: TAB_BAR_BASE_HEIGHT + insets.bottom`, rounded
// only where it meets the page, square where it meets the bar) and fixes the type: Jakarta faces instead of
// weight-only system text (title 13/700, status 12/500, VIEW 11/700 C.primary on C.card). The row is a `PressableScale`
// and is SILENT — it only navigates to tracking (CONTRACTS §8). While `in_transit` the status line is the
// delivery ETA (`EtaLine size="sm"`, antares) so the banner reads "Delivery in 6 minutes" like Blinkit's.
//
// The SCREEN owns everything stateful around it: the diffed orders poll, which order is shown, the CartBar lift
// (`setCartBarExtraBottom(ACTIVE_ORDER_BANNER_FOOTPRINT)` while it shows, 0 on blur/unmount) and the list's
// bottom padding. This component only draws one order.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { getStatusMeta } from "../../constants/orderStatus";
import { fontFamily, motion, radius, shadow, TAB_BAR_BASE_HEIGHT } from "../../constants/ui";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import type { Order } from "../../lib/orderService";
import { EtaLine, PressableScale } from "../ui";

export type ActiveOrdersBannerProps = {
  /** The order to show — the screen passes the newest active one. */
  order: Order;
  /** Row press (silent — the screen pushes `/order/track/${order.id}`). */
  onPress: () => void;
  /** Further active orders beyond `order`; shown as a small "+N" when > 0. Default 0. */
  extraCount?: number;
  /** Root testID; the row gets `${testID}-row`. */
  testID?: string;
};

/**
 * Approximate height of the floating banner block (card 56 + its top shadow). The screen adds it to the list's
 * bottom padding and lifts the CartBar by it while the banner shows (CONTRACTS §4.10 `setCartBarExtraBottom`).
 */
export const ACTIVE_ORDER_BANNER_FOOTPRINT = 64;

/** Status whose status line becomes the live delivery ETA. */
const IN_TRANSIT_STATUS = "in_transit";
const ICON_WRAP = 32;
const STATUS_ICON = 18;

/** "Amul Taaza + 2 items" / "Amul Taaza" / "Your order" — the first line name plus the remaining count. */
function itemsSummary(order: Order): string {
  const items = order.items ?? [];
  if (items.length === 0) return "Your order";
  const extra = items.length - 1;
  return extra > 0 ? `${items[0].name} + ${extra} ${extra === 1 ? "item" : "items"}` : items[0].name;
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function ActiveOrdersBannerBase({ order, onPress, extraCount = 0, testID }: ActiveOrdersBannerProps) {
  const insets = useSafeAreaInsets();
  const meta = getStatusMeta(order.order_status);
  const summary = useMemo(() => itemsSummary(order), [order]);
  // "Active order, on the way, view" — the status label in sentence position.
  const spokenStatus = meta.label.charAt(0).toLowerCase() + meta.label.slice(1);

  return (
    <View
      // Flush against the tab bar's top edge — no gap — so the banner reads as one connected surface with it.
      style={[styles.wrap, { bottom: TAB_BAR_BASE_HEIGHT + insets.bottom }]}
      pointerEvents="box-none"
      testID={testID}
    >
      <PressableScale
        scale={motion.scale.row}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Active order, ${spokenStatus}, view`}
        accessibilityHint="Opens live tracking"
        innerStyle={styles.card}
        pressedStyle={styles.cardPressed}
        testID={testID ? `${testID}-row` : undefined}
      >
        <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
          <MaterialCommunityIcons name={meta.icon} size={STATUS_ICON} color={meta.color} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {summary}
          </Text>
          <StatusLine status={order.order_status} label={meta.label} />
        </View>
        {extraCount > 0 ? (
          <Text style={styles.extra} maxFontSizeMultiplier={1.3} accessibilityLabel={`${extraCount} more active`}>
            {`+${extraCount}`}
          </Text>
        ) : null}
        <View style={styles.viewBtn}>
          <Text style={styles.viewText} maxFontSizeMultiplier={1.3}>
            VIEW
          </Text>
        </View>
      </PressableScale>
    </View>
  );
}

/**
 * Status line: the live ETA (on a `C.primaryLight` pill so EtaLine's primary text and bolt stay legible on the
 * green card) while the order is in transit and an ETA is known; otherwise the status label.
 */
function StatusLine({ status, label }: { status: string; label: string }) {
  const eta = useDeliveryEta();
  if (status === IN_TRANSIT_STATUS && eta.state === "open") {
    return (
      <View style={styles.etaPill}>
        <EtaLine size="sm" eta={eta} />
      </View>
    );
  }
  return (
    <Text style={styles.status} numberOfLines={1} maxFontSizeMultiplier={1.3}>
      {label}
    </Text>
  );
}

/** Memoised on `order` identity, `onPress`, `extraCount` and `testID` (the screen keeps all four stable per order id). */
export const ActiveOrdersBanner: React.MemoExoticComponent<(props: ActiveOrdersBannerProps) => React.JSX.Element> =
  React.memo(ActiveOrdersBannerBase);
ActiveOrdersBanner.displayName = "ActiveOrdersBanner";

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0 },
  // Solid brand green (the page and every card are cream/white, so a solid card is what reads as a distinct
  // floating unit). Shadow points up (`shadow.dock`), the same direction as the tab bar's own shadow.
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: C.primary,
    ...shadow.dock,
  },
  cardPressed: { backgroundColor: C.primaryDark },
  iconWrap: {
    width: ICON_WRAP,
    height: ICON_WRAP,
    borderRadius: ICON_WRAP / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: { flex: 1, minWidth: 0 },
  title: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 18, color: C.onPrimary },
  status: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.onDarkSub, marginTop: 2 },
  etaPill: {
    alignSelf: "flex-start",
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: C.primaryLight,
  },
  extra: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14, color: C.onDarkSub, fontVariant: ["tabular-nums"] },
  viewBtn: { backgroundColor: C.card, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14 },
  viewText: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14, color: C.primary, letterSpacing: 0.3 },
});
