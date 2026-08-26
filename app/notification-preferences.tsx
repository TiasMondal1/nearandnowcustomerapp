import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../constants/colors";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/apiClient";
import { logSilentFailure } from "../lib/logSilentFailure";

// Only "orderUpdates" is actually gated server-side today (see
// notification.service.ts's isCustomerNotificationEnabled) — missing/unset
// defaults to enabled, so a fresh customer sees this "on" out of the box.
const DEFAULT_PREFERENCES = { orderUpdates: true };

export default function NotificationPreferencesScreen() {
  const { userId } = useAuth();
  const [orderUpdates, setOrderUpdates] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<Record<string, unknown>>(
        `/api/notifications/users/${userId}/preferences`,
      );
      const value = data?.orderUpdates;
      setOrderUpdates(typeof value === "boolean" ? value : DEFAULT_PREFERENCES.orderUpdates);
    } catch (err) {
      logSilentFailure("Fetch notification preferences", err);
      // keep the default — matches the backend's own opt-out-by-default gate
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(async () => {
    if (!userId || saving) return;
    const previous = orderUpdates;
    const next = !previous;
    setOrderUpdates(next);
    setSaving(true);
    try {
      await apiFetch(`/api/notifications/users/${userId}/preferences`, {
        method: "PUT",
        body: JSON.stringify({ orderUpdates: next }),
      });
    } catch (err) {
      logSilentFailure("Update notification preferences", err);
      setOrderUpdates(previous);
      Alert.alert("Couldn't save preference", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [userId, orderUpdates, saving]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/notifications"))}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification Preferences</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.card}>
            <View style={styles.prefRow}>
              <MaterialCommunityIcons name="truck-fast-outline" size={20} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Order updates</Text>
                <Text style={styles.prefSubtitle}>
                  Get notified as your order is placed, confirmed, out for delivery, and delivered.
                </Text>
              </View>
              <Switch
                value={orderUpdates}
                onValueChange={toggle}
                disabled={saving}
                trackColor={{ false: C.border, true: C.primaryLight }}
                thumbColor={orderUpdates ? C.primary : Platform.OS === "android" ? C.card : undefined}
              />
            </View>
          </View>
        </View>
      )}
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
  headerTitle: { flex: 1, color: C.text, fontSize: 18, fontWeight: "900" },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  body: { padding: 16 },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  prefTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  prefSubtitle: { color: C.textSub, fontSize: 12, marginTop: 3, lineHeight: 16 },
});
