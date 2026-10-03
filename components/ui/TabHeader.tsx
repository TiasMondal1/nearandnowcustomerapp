// codename: atlas
// TabHeader — the shared band on all three tabs (CONTRACTS §4.11 · design/blinkit-parity §2.1 · BP-05/06). One
// gradient (C.primaryXLight → C.bg) with the faint grocery doodles, the delivery-ETA hero (home) or the tab title
// (tab), the address pill and the 40 px initial avatar with the unread dot. Avatar and address presses are
// NAVIGATION and therefore silent (the sheet they open plays its own swoosh). This file imports NOTHING from the
// contexts folder — screens pass `useProfileMenu().open` as `onAvatarPress` — which breaks the provider → ProfileMenu
// → barrel → TabHeader → provider import cycle (rev. 2).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, HIT_SLOP, motion, radius, text } from "../../constants/ui";
import { useDeliveryEta } from "../../hooks/useDeliveryEta";
import { useDevFlag } from "../../lib/devFlags";
import { DoodleBackdrop, TAB_HEADER_DOODLES } from "./DoodleBackdrop";
import { EtaLine } from "./EtaLine";
import { AnimatedNumber } from "./motion/AnimatedNumber";
import { PressableScale } from "./motion/PressableScale";

/** The address pill is 24 pt tall; ±10 vertical lifts it to 44 pt (the avatar beside it keeps its own 8 slop). */
const ADDRESS_HIT_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

export type TabHeaderProps = {
  /** home: ETA hero (eyebrow + 22/800 minutes) · tab: title 22/800 + `EtaLine size="sm"`. */
  variant: "home" | "tab";
  /** Tab variant title ("Categories", "Order again"). */
  title?: string;
  /** Address label ("Home"). */
  addressLabel?: string | null;
  /** One address line, ellipsized. With no label and no line the pill reads "Set your location". */
  addressLine?: string | null;
  /** Address pill press (silent — navigation to select-location). */
  onAddressPress: () => void;
  /** Avatar letter. Default '?'. The first character is shown, upper-cased. */
  avatarInitial?: string;
  /** REQUIRED (rev. 2): screens pass `useProfileMenu().open`. Silent — the sheet plays the swoosh. */
  onAvatarPress: () => void;
  /** Default true; W2 screens pass `!Dev_Atlas_inhibit_Feature` on non-home tabs. */
  showAvatar?: boolean;
  /** 8 px C.primary dot with a 2 px C.bg ring on the avatar (hidden under `Dev_Atlas_inhibit_UnreadDot`). Default false. */
  unread?: boolean;
  /** Optional extra control between the text column and the avatar (owner veto slot). Default none. */
  right?: React.ReactNode;
  /** Rendered below the rows, inside the band (SearchBand + chip strip on Home). */
  children?: React.ReactNode;
  /** Outer band. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Band min height in px (content ph16 pt10 pb10; the caller adds `insets.top` via `Screen edges={['top']}`). */
export const TAB_HEADER_MIN_HEIGHT = 84;

/** Doodle opacity on the band (design §2.1: ≤ 0.08 so the hero text stays legible). */
const DOODLE_OPACITY = 0.08;
const AVATAR_SIZE = 40;

/**
 * Band = LinearGradient C.primaryXLight → C.bg (the ONE gradient) + TAB_HEADER_DOODLES at 0.08 in C.primary; content
 * ph16 pt10 pb10. Home: eyebrow "⚡ DELIVERY IN" (`text.eyebrow` C.primary) / "STORE CLOSED" (C.warningText), then
 * "<N roll> minutes" in `text.h2` — or "Set your location" (none), "Finding stores…" (unknown), "Opens later today"
 * 20/800 (closed) — then the address pill. Tab: `title` in `text.h2`, `EtaLine size="sm"`, address pill. The title /
 * ETA line carries `accessibilityRole="header"`; the address block is labelled "Delivery address, <label> <line>, change".
 */
export function TabHeader({
  variant,
  title,
  addressLabel,
  addressLine,
  onAddressPress,
  avatarInitial,
  onAvatarPress,
  showAvatar = true,
  unread = false,
  right,
  children,
  style,
  testID,
}: TabHeaderProps): React.JSX.Element {
  const eta = useDeliveryEta();
  const inhibitDot = useDevFlag("Dev_Atlas_inhibit_UnreadDot");

  return (
    <View style={[styles.band, style]} testID={testID}>
      {/* Decorative layer clips the doodles' negative offsets on its own, so the band stays overflow-visible and the
          SearchBand rendered as `children` keeps its Android elevation (MAP §7.4). */}
      <View style={styles.backdrop} pointerEvents="none">
        <LinearGradient
          colors={[C.primaryXLight, C.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <DoodleBackdrop doodles={TAB_HEADER_DOODLES} baseOpacity={DOODLE_OPACITY} color={C.primary} />
      </View>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.textColumn}>
            {variant === "home" ? (
              <HomeHero eta={eta} />
            ) : (
              <>
                <Text style={styles.title} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
                  {title ?? ""}
                </Text>
                <EtaLine size="sm" style={styles.tabEta} testID={testID ? `${testID}-eta` : undefined} />
              </>
            )}
            <AddressPill
              addressLabel={addressLabel}
              addressLine={addressLine}
              onPress={onAddressPress}
              testID={testID ? `${testID}-address` : undefined}
            />
          </View>
          {right ? <View style={styles.rightSlot}>{right}</View> : null}
          {showAvatar ? (
            <Avatar
              initial={avatarInitial}
              unread={unread && !inhibitDot}
              onPress={onAvatarPress}
              testID={testID ? `${testID}-avatar` : undefined}
            />
          ) : null}
        </View>
        {children ? <View style={styles.children}>{children}</View> : null}
      </View>
    </View>
  );
}

// ─── Parts ────────────────────────────────────────────────────────────────────

type HeroEta = ReturnType<typeof useDeliveryEta>;

/** Home hero: eyebrow + the big line. The minutes roll unless `Dev_Antares_inhibit_Ticker` freezes every ETA roll. */
function HomeHero({ eta }: { eta: HeroEta }) {
  const inhibitTicker = useDevFlag("Dev_Antares_inhibit_Ticker");
  const closed = eta.state === "closed";
  const open = eta.state === "open" && eta.minutes != null;
  const minutes = eta.minutes ?? 0;

  const eyebrow = closed ? "STORE CLOSED" : eta.state === "none" ? "DELIVERY" : "DELIVERY IN";
  const fallback = closed ? "Opens later today" : eta.state === "unknown" ? "Finding stores…" : "Set your location";
  const heroLabel = open
    ? `Delivery in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
    : closed
      ? "Store closed, opens later today"
      : fallback;

  return (
    <>
      <View style={styles.eyebrowRow}>
        <MaterialCommunityIcons
          name={closed ? "clock-outline" : "flash"}
          size={14}
          color={closed ? C.warningText : C.primary}
        />
        <Text style={[styles.eyebrow, closed && styles.eyebrowClosed]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {eyebrow}
        </Text>
      </View>
      <View style={styles.heroRow} accessible accessibilityRole="header" accessibilityLabel={heroLabel}>
        {open ? (
          <>
            {inhibitTicker ? (
              <Text style={styles.hero} maxFontSizeMultiplier={1.3}>
                {minutes}
              </Text>
            ) : (
              <AnimatedNumber mode="roll" value={minutes} style={styles.hero} accessibilityLabel={`${minutes}`} />
            )}
            <Text style={styles.hero} maxFontSizeMultiplier={1.3}>
              {` ${minutes === 1 ? "minute" : "minutes"}`}
            </Text>
          </>
        ) : (
          <Text style={[styles.hero, closed && styles.heroClosed]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {fallback}
          </Text>
        )}
      </View>
    </>
  );
}

function AddressPill({
  addressLabel,
  addressLine,
  onPress,
  testID,
}: {
  addressLabel?: string | null;
  addressLine?: string | null;
  onPress: () => void;
  testID?: string;
}) {
  const label = addressLabel?.trim() || null;
  const line = addressLine?.trim() || null;
  const copy = label && line ? `${label} · ${line}` : (label ?? line ?? "Set your location");
  return (
    <PressableScale
      scale={motion.scale.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Delivery address, ${label ?? ""} ${line ?? "not set"}, change`}
      hitSlop={ADDRESS_HIT_SLOP}
      style={styles.addressOuter}
      innerStyle={styles.address}
      pressedStyle={styles.addressPressed}
      testID={testID}
    >
      <MaterialCommunityIcons name="map-marker-outline" size={14} color={C.textSub} />
      <Text style={styles.addressText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {copy}
      </Text>
      <MaterialCommunityIcons name="chevron-down" size={14} color={C.textSub} />
    </PressableScale>
  );
}

function Avatar({ initial, unread, onPress, testID }: { initial?: string; unread: boolean; onPress: () => void; testID?: string }) {
  const letter = (initial?.trim().charAt(0) || "?").toUpperCase();
  return (
    <PressableScale
      scale={motion.scale.icon}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={unread ? "Account menu, unread notifications" : "Account menu"}
      hitSlop={HIT_SLOP}
      style={styles.avatarOuter}
      innerStyle={styles.avatar}
      pressedStyle={styles.avatarPressed}
      testID={testID}
    >
      <Text style={styles.avatarText} maxFontSizeMultiplier={1.3}>
        {letter}
      </Text>
      {unread ? (
        <View style={styles.unreadRing} pointerEvents="none">
          <View style={styles.unreadDot} />
        </View>
      ) : null}
    </PressableScale>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // The band itself never clips (children may carry elevation); the backdrop layer clips the doodles' negative offsets.
  band: { minHeight: TAB_HEADER_MIN_HEIGHT, backgroundColor: C.bg },
  backdrop: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  textColumn: { flex: 1, minWidth: 0 },
  rightSlot: { alignSelf: "center" },
  // Home hero
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  eyebrow: { ...text.eyebrow, color: C.primary, lineHeight: 14 },
  eyebrowClosed: { color: C.warningText },
  heroRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
  hero: { ...text.h2 },
  heroClosed: { fontSize: 20, lineHeight: 26 },
  // Tab variant
  title: { ...text.h2 },
  tabEta: { marginTop: 2 },
  // Address pill (the highlight needs a shape: negative left margin cancels the inner padding)
  addressOuter: { alignSelf: "flex-start", marginTop: 4, marginLeft: -6, maxWidth: "100%" },
  address: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: radius.md,
  },
  addressPressed: { backgroundColor: C.primaryXLight },
  addressText: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16, color: C.textSub, flexShrink: 1 },
  // Avatar
  avatarOuter: { alignSelf: "flex-start" },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPressed: { backgroundColor: C.primaryDark },
  avatarText: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 20, color: C.onPrimary },
  // 8 px C.primary dot inside a 2 px C.bg ring, straddling the avatar's top-right edge so it reads against the band.
  unreadRing: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  children: { marginTop: 10 },
});
