import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/apiClient";

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
      activeOpacity={0.7}
      onPress={() => onPress(item)}
    >
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons
          name={TYPE_ICON[item.type] ?? "bell-outline"}
          size={20}
          color={C.primary}
        />
      </View>
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

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      if (!isRefresh) setLoading(true);
      const data = await apiFetch<AppNotification[]>(`/api/notifications/users/${userId}`);
      setNotifications(data);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
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
      console.error("Failed to mark all as read:", err);
    }
  }, [userId]);

  const handlePress = useCallback(async (item: AppNotification) => {
    if (!item.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)),
      );
      apiFetch(`/api/notifications/${item.id}/read`, { method: "PUT" }).catch(() => {});
    }
    const orderId = item.data?.orderId as string | undefined;
    if (orderId) {
      router.push(`/order/track/${orderId}` as any);
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const Header = (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 && (
          <Text style={styles.orderCount}>{unreadCount} unread</Text>
        )}
      </View>
      {unreadCount > 0 && (
        <TouchableOpacity onPress={markAllRead}>
          <Text style={styles.markAllText}>Mark all read</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        {Header}
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {Header}
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
          <View style={styles.empty}>
            <MaterialCommunityIcons name="bell-outline" size={56} color={C.textLight} />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyText}>Order updates will appear here</Text>
          </View>
        }
        renderItem={({ item }) => <NotificationCard item={item} onPress={handlePress} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bgSoft,
  },
  headerTitle: { color: C.text, fontSize: 20, fontWeight: "900" },
  orderCount: { color: C.textSub, fontSize: 12, fontWeight: "600", marginTop: 2 },
  markAllText: { color: C.primary, fontSize: 13, fontWeight: "700" },

  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },

  list: { paddingTop: 14, paddingBottom: 40 },

  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.card,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardUnread: { backgroundColor: C.bgSoft },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { color: C.text, fontWeight: "800", fontSize: 14, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  cardMessage: { color: C.textSub, fontSize: 13, marginTop: 3 },
  cardTime: { color: C.textLight, fontSize: 11, marginTop: 6 },

  empty: { marginTop: 80, alignItems: "center", gap: 10, padding: 32 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "800" },
  emptyText: { color: C.textSub, fontSize: 14, textAlign: "center" },
});
