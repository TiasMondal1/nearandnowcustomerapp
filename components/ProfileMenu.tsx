// codename: atlas
// Account sheet (CONTRACTS §6.4). The owner's content is preserved verbatim — identity row, three QuickTiles,
// flat title-only rows, quiet red Log out, footer — with exactly two documented additions: the "Sounds & haptics"
// row (after Notifications) and the version line in the footer. Shell changes only: RN Modal → BottomSheet
// (pan to dismiss, own ToastLayer), RN Animated tiles → PressableScale, typed hrefs, and navigation that runs
// from the sheet's `onDismiss` — never `onClose()` + `router.push()` in the same tick (MAP §7.5 / C42).
// The footer brand block is the hidden dev-mode long-press target (DECISIONS D2): 3 s → the sheet closes →
// `requestDevUnlock('long-press')` from `onDismiss`, so the version toast renders in the root ToastHost.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import React, { useCallback, useRef } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { C } from "../constants/colors";
import { motion } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { requestDevUnlock } from "../context/DevModeContext";
import { getAppVersion } from "../lib/appExtra";
import { useDevFlag } from "../lib/devFlags";
import { BottomSheet, ListRow, PressableScale, type IconName } from "./ui";

interface ProfileMenuProps {
  visible: boolean;
  onClose: () => void;
  /** Unread notifications; passed by ProfileMenuProvider (this file never imports the context — cycle). Default 0. */
  unreadCount?: number;
}

/** What to do once the sheet's native Modal is gone (set before `onClose()`, consumed in `onDismiss`). */
type PendingAction = { kind: "push"; href: Href } | { kind: "dev-unlock" } | { kind: "logout" } | null;

/** Dev-mode long-press duration on the footer brand (DECISIONS D2). */
const DEV_LONG_PRESS_MS = 3000;

// Uber-style quick-action tile: gray rounded square, icon over label,
// scale-down + darker highlight on press. Silent — a tile only navigates.
function QuickTile({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      scale={motion.scale.tile}
      haptic={false}
      onPress={onPress}
      pressedStyle={styles.tilePressed}
      style={styles.tileWrap}
      innerStyle={styles.tile}
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={22} color={C.text} />
      <Text style={styles.tileLabel}>{label}</Text>
    </PressableScale>
  );
}

export default function ProfileMenu({ visible, onClose, unreadCount = 0 }: ProfileMenuProps) {
  const { user, logoutUser } = useAuth();
  const atlasOff = useDevFlag("Dev_Atlas_inhibit_Feature");
  const unreadDotOff = useDevFlag("Dev_Atlas_inhibit_UnreadDot");
  const pendingRef = useRef<PendingAction>(null);
  const { version, build } = getAppVersion();

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => {
          // Close the sheet FIRST and log out from `onDismiss`: `clearStoredSession` flips isAuthenticated
          // synchronously and the AppShell watcher replaces with /phone — that must never overlap the Modal
          // dismissal (MAP §7.5, W3 R6-07). The watcher redirects exactly once (C41) — no router.replace here.
          pendingRef.current = { kind: "logout" };
          onClose();
        },
      },
    ]);
  };

  // Close first; the push runs from `onDismiss` once the Modal is really gone.
  const handleNavigation = (href: Href) => {
    pendingRef.current = { kind: "push", href };
    onClose();
  };

  const handleFooterLongPress = () => {
    pendingRef.current = { kind: "dev-unlock" };
    onClose();
  };

  const runPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    if (pending.kind === "push") {
      router.push(pending.href);
    } else if (pending.kind === "logout") {
      void logoutUser();
    } else {
      requestDevUnlock("long-press");
    }
  }, [logoutUser]);

  const showUnreadDot = unreadCount > 0 && !unreadDotOff;

  return (
    <BottomSheet visible={visible} onClose={onClose} onDismiss={runPending} contentStyle={styles.sheetContent}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Identity header — name is the headline, avatar trails (Uber account layout) */}
        <View style={styles.identityRow}>
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>{user?.name ?? "Guest"}</Text>
            {user?.phone ? <Text style={styles.sub} numberOfLines={1}>{user.phone}</Text> : null}
            {user?.email ? (
              <Text style={styles.sub} numberOfLines={1} ellipsizeMode="middle">{user.email}</Text>
            ) : null}
          </View>
          <PressableScale
            scale={motion.scale.icon}
            haptic={false}
            onPress={() => handleNavigation("/settings/profile")}
            innerStyle={styles.avatarFallback}
            accessibilityLabel="Edit profile"
          >
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </PressableScale>
        </View>

        {/* Quick actions */}
        <View style={styles.tileRow}>
          <QuickTile icon="history" label="Orders" onPress={() => handleNavigation("/orders")} />
          <QuickTile icon="wallet-outline" label="Wallet" onPress={() => handleNavigation("/wallet")} />
          <QuickTile icon="help-circle-outline" label="Support" onPress={() => handleNavigation("/settings/support")} />
        </View>

        {/* Flat, title-only rows with bare glyphs — no cards, no subtitles */}
        <View style={styles.section}>
          <MenuItem icon="account-outline" title="Edit profile" onPress={() => handleNavigation("/settings/profile")} />
          <MenuItem icon="map-marker-outline" title="Address book" onPress={() => handleNavigation("/location")} />
          <MenuItem icon="heart-outline" title="Wishlist" onPress={() => handleNavigation("/wishlist")} />
          <MenuItem icon="credit-card-outline" title="Payments" onPress={() => handleNavigation("/settings/payments")} />
          <MenuItem
            icon="bell-outline"
            title="Notifications"
            onPress={() => handleNavigation("/notifications")}
            right={showUnreadDot ? <UnreadChevron /> : undefined}
            accessibilityLabel={showUnreadDot ? `Notifications, ${unreadCount} unread` : undefined}
          />
          <MenuItem icon="volume-high" title="Sounds & haptics" onPress={() => handleNavigation("/notification-preferences")} />
          <MenuItem icon="file-document-outline" title="Terms & privacy" onPress={() => handleNavigation("/settings/terms")} isLast />
        </View>

        {/* Log out as a quiet red row, not a shouting button */}
        <ListRow
          size="lg"
          icon="logout"
          iconBg="transparent"
          iconColor={C.danger}
          title="Log out"
          titleStyle={styles.logoutText}
          right={null}
          onPress={handleLogout}
          style={styles.logoutRow}
        />

        {/* Footer: brand + tagline + version. Also the hidden dev-mode long-press target — no pressed style, no hint. */}
        <Pressable
          delayLongPress={DEV_LONG_PRESS_MS}
          onLongPress={handleFooterLongPress}
          accessibilityRole="none"
          style={styles.footer}
        >
          <Text style={styles.footerBrand}>Near & Now</Text>
          <Text style={styles.footerTagline}>Digital Dukaan, local dil se</Text>
          {atlasOff ? null : (
            <Text style={styles.footerVersion} accessibilityLabel={`Version ${version}, build ${build}`}>
              Version {version} ({build})
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

/** 8 px C.primary dot beside the same chevron ListRow draws for an lg row (20, C.textLight). */
function UnreadChevron() {
  return (
    <View style={styles.rowRight}>
      <View style={styles.unreadDot} />
      <MaterialCommunityIcons name="chevron-right" size={20} color={C.textLight} />
    </View>
  );
}

function MenuItem({
  icon,
  title,
  onPress,
  isLast,
  right,
  accessibilityLabel,
}: {
  icon: IconName;
  title: string;
  onPress: () => void;
  isLast?: boolean;
  /** Trailing node; omit for ListRow's own chevron. */
  right?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <ListRow
      size="lg"
      icon={icon}
      iconBg="transparent"
      iconColor={C.text}
      title={title}
      onPress={onPress}
      divider={!isLast}
      right={right}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const styles = StyleSheet.create({
  // The owner's rows carry their own 20/4 horizontal paddings; the sheet adds none.
  sheetContent: { paddingHorizontal: 0 },

  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
  },
  identityText: { flex: 1 },
  name: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 24, letterSpacing: -0.4 },
  sub: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 13, marginTop: 2 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.card, fontSize: 22 },

  tileRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  tileWrap: { flex: 1 },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.bgSoft,
  },
  tilePressed: { backgroundColor: C.border },
  tileLabel: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 12, color: C.text },

  section: { marginTop: 8, paddingHorizontal: 4 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  logoutRow: { marginTop: 12, paddingHorizontal: 20 },
  logoutText: { color: C.danger },

  footer: {
    marginTop: 24,
    marginBottom: 16,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  footerBrand: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15, color: C.primary },
  footerTagline: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 11, color: C.textLight, marginTop: 3 },
  footerVersion: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 11, color: C.textLight, marginTop: 4 },
});
