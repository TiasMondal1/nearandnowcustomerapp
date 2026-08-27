import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    EmptyState,
    IconButton,
    IconWrap,
    PrimaryButton,
    Screen,
    ScreenHeader,
    Skeleton,
} from "../components/ui";
import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/apiClient";
import { logSilentFailure } from "../lib/logSilentFailure";
import {
    checkPushPermissionStatus,
    getLastPushRegistrationError,
    registerForPushNotifications,
} from "../lib/pushNotificationStatus";

interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  order_placed: "clipboard-check-outline",
  order_confirmed: "check-circle-outline",
  order_shipped: "truck-fast-outline",
  order_delivered: "package-variant-closed-check",
  order_cancelled: "close-circle-outline",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationCard({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, !item.is_read && styles.cardUnread]}
      activeOpacity={0.85}
      accessibilityRole="button"
      onPress={() => onPress(item)}
    >
      <IconWrap size={34} bg={C.bg} icon={TYPE_ICON[item.type] ?? "bell-outline"} />
      <View style={{ flex: 1 }}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          {!item.is_read && <View style={styles.dot} />}
        </View>
        <Text style={styles.cardMessage} numberOfLines={2}>{item.message}</Text>
        <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function NotificationsScreen() {
  const { userId } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Unlike the store-owner/rider apps, this app had no "Enable Notifications"
  // affordance anywhere — a customer who denied the permission prompt once
  // had no discoverable way to find out push was off or retry. `null` means
  // "not checked yet" so the card doesn't flash on/off before the initial
  // check resolves.
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);

  useEffect(() => {
    checkPushPermissionStatus().then((status) => setPushEnabled(status === "granted"));
  }, []);

  const handleEnablePush = useCallback(async () => {
    if (!userId || enablingPush) return;
    setEnablingPush(true);
    try {
      const token = await registerForPushNotifications(userId);
      if (token) {
        setPushEnabled(true);
        return;
      }
      const reason = getLastPushRegistrationError();
      if (reason === "permission-denied") {
        Alert.alert(
          "Permission needed",
          "Notifications are blocked for this app. Enable them in your device settings to get order updates.",
        );
      } else if (reason === "expo-go") {
        Alert.alert("Not available", "Push notifications aren't available in this environment.");
      } else {
        Alert.alert("Couldn't enable notifications", "Something went wrong. Please try again.");
      }
    } finally {
      setEnablingPush(false);
    }
  }, [userId, enablingPush]);

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      if (!isRefresh) setLoading(true);
      const data = await apiFetch<AppNotification[]>(`/api/notifications/users/${userId}`);
      setNotifications(data);
      setLoadError(false);
    } catch (err) {
      logSilentFailure("Fetch notifications", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNotifications(true);
    setRefreshing(false);
  }, [fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await apiFetch(`/api/notifications/users/${userId}/read-all`, { method: "PUT" });
    } catch (err) {
      logSilentFailure("Mark all notifications read", err);
    }
  }, [userId]);

  const handlePress = useCallback(async (item: AppNotification) => {
    if (!item.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)),
      );
      apiFetch(`/api/notifications/${item.id}/read`, { method: "PUT" }).catch((err) =>
        logSilentFailure("Mark notification read", err),
      );
    }
    const orderId = item.data?.orderId as string | undefined;
    if (orderId) {
      router.push(`/order/track/${orderId}` as any);
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const Header = (
    <ScreenHeader
      size="lg"
      title="Notifications"
      subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
      right={
        <View style={styles.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity
              onPress={markAllRead}
              style={styles.markAllBtn}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          <IconButton
            icon="cog-outline"
            iconSize={20}
            shape="circle"
            accessibilityLabel="Notification settings"
            onPress={() => router.push("/notification-preferences" as any)}
          />
        </View>
      }
    />
  );

  const PushStatusCard = pushEnabled === false ? (
    <View style={styles.pushCard}>
      <IconWrap size={34} bg={C.card} icon="bell-alert-outline" />
      <View style={{ flex: 1 }}>
        <Text style={styles.pushCardTitle}>Turn on notifications</Text>
        <Text style={styles.pushCardText}>Get order updates the moment they happen.</Text>
      </View>
      <PrimaryButton
        size="xs"
        shadow={false}
        label="Enable"
        loading={enablingPush}
        onPress={handleEnablePush}
        style={styles.pushCardBtn}
      />
    </View>
  ) : null;

  if (loading) {
    return (
      <Screen>
        {Header}
        {PushStatusCard}
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.card}>
              <Skeleton width={34} height={34} radius={10} />
              <View style={{ flex: 1 }}>
                <Skeleton width="55%" height={12} />
                <Skeleton width="85%" height={10} style={styles.skeletonGap} />
                <Skeleton width="30%" height={10} style={styles.skeletonGap} />
              </View>
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {Header}
      {PushStatusCard}
      <FlashList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListEmptyComponent={
          loadError ? (
            <EmptyState
              icon="wifi-off"
              iconColor={C.warning}
              title="Couldn't load notifications"
              text="Check your connection and try again."
              action={{ label: "Try Again", variant: "warning", onPress: () => fetchNotifications() }}
            />
          ) : (
            <EmptyState
              icon="bell-outline"
              title="No notifications yet"
              text="Order updates will appear here"
            />
          )
        }
        renderItem={({ item }) => <NotificationCard item={item} onPress={handlePress} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pushCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: C.primaryXLight,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  pushCardTitle: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: C.text },
  pushCardText: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, color: C.textSub, marginTop: 1 },
  pushCardBtn: { minWidth: 68, minHeight: 40, paddingHorizontal: 14 },

  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  markAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.primaryXLight,
  },
  markAllText: { fontFamily: "PlusJakartaSans_700Bold", color: C.primary, fontSize: 13 },

  skeletonList: { paddingTop: 16 },
  skeletonGap: { marginTop: 8 },

  list: { paddingTop: 16, paddingBottom: 40 },

  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.card,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardUnread: { backgroundColor: C.bgSoft },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 14, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  cardMessage: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textSub, fontSize: 13, marginTop: 4 },
  cardTime: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textLight, fontSize: 11, marginTop: 8 },
});
