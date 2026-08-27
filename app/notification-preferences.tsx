import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    Platform,
    StyleSheet,
    Switch,
    Text,
    View,
} from "react-native";

import { Card, IconWrap, Screen, ScreenHeader, Skeleton } from "../components/ui";
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
    <Screen>
      <ScreenHeader
        size="lg"
        title="Notification Preferences"
        titleStyle={styles.headerTitle}
        backFallbackHref="/notifications"
      />

      {loading ? (
        <View style={styles.body}>
          <Card padded={false}>
            <View style={styles.prefRow}>
              <Skeleton width={34} height={34} radius={10} />
              <View style={styles.skeletonText}>
                <Skeleton width="45%" height={12} />
                <Skeleton width="85%" height={10} />
              </View>
              <Skeleton width={51} height={31} radius={16} />
            </View>
          </Card>
        </View>
      ) : (
        <View style={styles.body}>
          <Card padded={false}>
            <View style={styles.prefRow}>
              <IconWrap size={34} icon="truck-fast-outline" />
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
                accessibilityLabel="Order updates"
                ios_backgroundColor={C.border}
                trackColor={{ false: C.border, true: C.primaryLight }}
                thumbColor={orderUpdates ? C.primary : Platform.OS === "android" ? C.card : undefined}
                style={saving ? styles.switchSaving : undefined}
              />
            </View>
          </Card>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 18 },

  body: { padding: 16 },

  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  skeletonText: { flex: 1, gap: 8 },
  switchSaving: { opacity: 0.6 },
  prefTitle: { color: C.text, fontSize: 14, fontFamily: "PlusJakartaSans_700Bold" },
  prefSubtitle: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 12, marginTop: 4, lineHeight: 18 },
});
