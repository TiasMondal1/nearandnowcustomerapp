// codename: tango
// Notifications inbox on lib/notificationService (CONTRACTS §2.23 rev. 2 · blinkit-parity §3.18 / BP-33 ·
// motion M15 · MAP U39/C40/K8). The list rendered here IS the service's visible list (already minus local
// dismissals) read through useSyncExternalStore; markRead / markAllRead / dismissLocally update the shared
// unread counter themselves, so this screen never touches context state (the avatar dot follows for free).
// Rows group into Today / Yesterday / Earlier under sticky eyebrows, swipe left to dismiss (local-only —
// there is no delete endpoint, PLAN Q6) with Undo, and open tracking when the payload carries an orderId.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import {
  EmptyState,
  IconButton,
  notify,
  PressableScale,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonScreen,
  useMotionReduced,
} from "../components/ui";
import { C } from "../constants/colors";
import { fontFamily, layout, motion, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { useRefetchOnReconnect } from "../hooks/useRefetchOnReconnect";
import { useForceSkeleton } from "../hooks/useSlowLoad";
import { useDevFlag } from "../lib/devFlags";
import { feedback } from "../lib/feedback";
import { logSilentFailure } from "../lib/logSilentFailure";
import {
  dismissLocally,
  getNotifications,
  markAllRead,
  markRead,
  peekNotifications,
  restoreLocally,
  subscribeNotifications,
  type AppNotification,
} from "../lib/notificationService";
import {
  checkPushPermissionStatus,
  getLastPushRegistrationError,
  registerForPushNotifications,
} from "../lib/pushNotificationStatus";

// ─── List model ───────────────────────────────────────────────────────────────

type HeaderItem = { kind: "header"; key: string; label: string };
type RowItem = {
  kind: "item";
  key: string;
  notification: AppNotification;
  timeLabel: string;
  /** `data.orderId` when it is a non-empty string — typed here once so the row never casts. */
  orderId: string | null;
};
type ListItem = HeaderItem | RowItem;

const SKELETON_ROWS = [0, 1, 2, 3] as const;
/** Right action panel width; RNGH opens past half of it (progress 0.5). */
const ACTION_WIDTH = 88;
const OPEN_THRESHOLD = ACTION_WIDTH / 2;
const THRESHOLD_PROGRESS = OPEN_THRESHOLD / ACTION_WIDTH;
const DOT_SIZE = 8;

const A11Y_ACTIONS: readonly AccessibilityActionInfo[] = [{ name: "dismiss", label: "Dismiss" }];

const keyExtractor = (item: ListItem) => item.key;
const getItemType = (item: ListItem) => item.kind;

function timeAgo(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function orderIdOf(n: AppNotification): string | null {
  const raw = n.data?.orderId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Today / Yesterday / Earlier (by local day) with the header indices FlashList should pin; flat when `grouped` is false. */
function buildListData(list: readonly AppNotification[], grouped: boolean, now: number): { data: ListItem[]; sticky: number[] } {
  const data: ListItem[] = [];
  const sticky: number[] = [];
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  let currentGroup: string | null = null;
  for (const n of list) {
    if (grouped) {
      const day = startOfDay(new Date(n.created_at).getTime());
      const group = day >= today ? "Today" : day >= yesterday ? "Yesterday" : "Earlier";
      if (group !== currentGroup) {
        currentGroup = group;
        sticky.push(data.length);
        data.push({ kind: "header", key: `header:${group}`, label: group });
      }
    }
    data.push({ kind: "item", key: n.id, notification: n, timeLabel: timeAgo(n.created_at, now), orderId: orderIdOf(n) });
  }
  return { data, sticky };
}

// ─── Swipe plumbing ───────────────────────────────────────────────────────────

type OpenHandle = { close: () => void };
/** The row whose action is showing; opening another (or scrolling) closes it first. */
let openRow: OpenHandle | null = null;

function closeOpenRow(): void {
  openRow?.close();
  openRow = null;
}

/** What committed a dismiss: a full swipe (threshold `select` already played), the action button / long-press / a11y action. */
type DismissSource = "swipe" | "button";

function fireSelect(): void {
  feedback.select();
}

function DismissAction({ progress, onPress }: { progress: SharedValue<number>; onPress: () => void }): React.JSX.Element {
  // Exactly one `select` per swipe, when the finger crosses the open threshold; re-arms when the panel closes.
  useAnimatedReaction(
    () => progress.get() >= THRESHOLD_PROGRESS,
    (past, previous) => {
      if (past && previous === false) scheduleOnRN(fireSelect);
    },
  );
  return (
    <PressableScale
      scale={motion.scale.tile}
      style={styles.actionOuter}
      innerStyle={styles.action}
      pressedStyle={styles.actionPressed}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Dismiss notification"
    >
      <MaterialCommunityIcons name="trash-can-outline" size={22} color={C.danger} />
      <Text style={styles.actionLabel} maxFontSizeMultiplier={1.3}>
        Dismiss
      </Text>
    </PressableScale>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

type RowProps = {
  item: RowItem;
  swipeEnabled: boolean;
  showDot: boolean;
  /** Reduced motion: a long-press offers the dismiss the swipe would (M15). */
  longPressDismiss: boolean;
  onPress: (item: RowItem) => void;
  onDismiss: (id: string, source: DismissSource) => void;
};

const NotificationRow = React.memo(
  function NotificationRow({ item, swipeEnabled, showDot, longPressDismiss, onPress, onDismiss }: RowProps) {
    const swipeRef = useRef<SwipeableMethods | null>(null);
    const [handle] = useState<OpenHandle>(() => ({ close: () => swipeRef.current?.close() }));
    const { notification, timeLabel } = item;
    const unread = !notification.is_read;

    useEffect(
      () => () => {
        if (openRow === handle) openRow = null;
      },
      [handle],
    );
    // A recycled cell showing a different notification must start closed.
    useEffect(() => {
      swipeRef.current?.reset();
    }, [item.key]);

    const dismiss = (source: DismissSource) => {
      handle.close();
      if (openRow === handle) openRow = null;
      onDismiss(notification.id, source);
    };
    const handleWillOpen = () => {
      if (openRow && openRow !== handle) openRow.close();
      openRow = handle;
    };
    const handleClose = () => {
      if (openRow === handle) openRow = null;
    };
    const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "dismiss") onDismiss(notification.id, "button");
    };
    const renderRightActions = (progress: SharedValue<number>) => <DismissAction progress={progress} onPress={() => dismiss("button")} />;

    const label = `${notification.title}, ${timeLabel}${unread ? ", unread" : ""}`;

    const body = (
      <PressableScale
        scale={motion.scale.row}
        pressedStyle={styles.rowPressed}
        innerStyle={styles.row}
        onPress={() => onPress(item)}
        onLongPress={longPressDismiss ? () => dismiss("button") : undefined}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={swipeEnabled ? A11Y_ACTIONS : undefined}
        onAccessibilityAction={swipeEnabled ? handleAccessibilityAction : undefined}
      >
        <View style={styles.dotSlot}>{showDot && unread ? <View style={styles.dot} /> : null}</View>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={2}>
            {notification.title}
          </Text>
          {notification.body ? (
            <Text style={styles.rowBody} numberOfLines={2}>
              {notification.body}
            </Text>
          ) : null}
          <Text style={styles.rowTime}>{timeLabel}</Text>
        </View>
      </PressableScale>
    );

    if (!swipeEnabled) {
      return <View style={styles.rowDivider}>{body}</View>;
    }
    return (
      <ReanimatedSwipeable
        ref={swipeRef}
        friction={2}
        overshootRight={false}
        rightThreshold={OPEN_THRESHOLD}
        renderRightActions={renderRightActions}
        onSwipeableWillOpen={handleWillOpen}
        // A full swipe (released past the threshold) dismisses straight away — the action button is for partial swipes.
        onSwipeableOpen={() => dismiss("swipe")}
        onSwipeableClose={handleClose}
        containerStyle={styles.swipeContainer}
        childrenContainerStyle={styles.rowDivider}
      >
        {body}
      </ReanimatedSwipeable>
    );
  },
  (a, b) =>
    a.item.notification === b.item.notification &&
    a.item.timeLabel === b.item.timeLabel &&
    a.item.orderId === b.item.orderId &&
    a.swipeEnabled === b.swipeEnabled &&
    a.showDot === b.showDot &&
    a.longPressDismiss === b.longPressDismiss &&
    a.onPress === b.onPress &&
    a.onDismiss === b.onDismiss,
);

function GroupHeader({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={styles.groupHeader}>
      <Text style={styles.groupHeaderText} accessibilityRole="header">
        {label}
      </Text>
    </View>
  );
}

function logIn(): void {
  router.push("/phone");
}

function openPreferences(): void {
  router.push("/notification-preferences");
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const { userId } = useAuth();
  if (!userId) {
    return (
      <Screen bg={C.card}>
        <ScreenHeader size="lg" title="Notifications" backFallbackHref="/(tabs)/home" />
        <EmptyState
          fill
          iconWrap
          icon="bell-outline"
          title="Sign in required"
          text="Log in to see updates about your orders"
          action={{ label: "Log in", onPress: logIn }}
        />
      </Screen>
    );
  }
  return <NotificationsBody userId={userId} />;
}

function NotificationsBody({ userId }: { userId: string }) {
  const inhibitFeature = useDevFlag("Dev_Tango_inhibit_Feature");
  const inhibitSwipe = useDevFlag("Dev_Tango_inhibit_SwipeDismiss");
  const reduced = useMotionReduced();
  const grouped = !inhibitFeature;
  const swipeEnabled = !inhibitFeature && !inhibitSwipe;
  const showDot = !inhibitFeature;

  // The service's visible list (stable reference until it changes); undefined before the first load.
  const getSnapshot = useCallback(() => peekNotifications(userId), [userId]);
  const list = useSyncExternalStore(subscribeNotifications, getSnapshot, getSnapshot);

  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  // Bumped on focus so "5m ago" labels re-derive without the list changing.
  const [clock, setClock] = useState(() => Date.now());
  const seqRef = useRef(0);

  // Unlike the store-owner/rider apps, this app had no "Enable Notifications" affordance anywhere — a
  // customer who denied the permission prompt once had no discoverable way to find out push was off or
  // retry. `null` means "not checked yet" so the band doesn't flash on/off before the initial check resolves.
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkPushPermissionStatus()
      .then((status) => {
        if (!cancelled) setPushEnabled(status === "granted");
      })
      .catch((err) => logSilentFailure("Check push permission", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      const seq = ++seqRef.current;
      try {
        await getNotifications(userId, { force });
        if (seq === seqRef.current) setLoadError(false);
      } catch (err) {
        logSilentFailure("Fetch notifications", err);
        if (seq !== seqRef.current) return;
        if (peekNotifications(userId) === undefined) {
          setLoadError(true);
        } else {
          notify({ id: "notifications-refresh-error", title: "Couldn't refresh notifications", tone: "error" });
        }
      }
    },
    [userId],
  );

  // Mount + focus: one request per 60 s thanks to the cache; pull-to-refresh forces it.
  useFocusEffect(
    useCallback(() => {
      setClock(Date.now());
      void load(false);
    }, [load]),
  );
  useRefetchOnReconnect(() => {
    void load(false);
  });

  const onRefresh = useCallback(async () => {
    feedback.tapSound();
    setRefreshing(true);
    await load(true);
    setClock(Date.now());
    setRefreshing(false);
  }, [load]);

  const handleEnablePush = useCallback(async () => {
    if (enablingPush) return;
    setEnablingPush(true);
    try {
      // registerForPushNotifications wraps the OS dialog in beginNativePrompt() itself (MAP §7.6).
      const token = await registerForPushNotifications(userId);
      if (token) {
        setPushEnabled(true);
        feedback.toggle(true);
        notify({ title: "Notifications on", message: "You'll get order updates as they happen.", tone: "success" });
        return;
      }
      const reason = getLastPushRegistrationError();
      if (reason === "permission-denied") {
        notify({
          title: "Notifications are blocked",
          message: "Enable them for Near & Now in your device settings to get order updates.",
          tone: "warning",
          duration: 5000,
        });
      } else if (reason === "expo-go") {
        notify({ title: "Not available here", message: "Push notifications don't work in this environment.", tone: "warning" });
      } else {
        notify({ title: "Couldn't enable notifications", message: "Something went wrong. Please try again.", tone: "error" });
      }
    } finally {
      setEnablingPush(false);
    }
  }, [userId, enablingPush]);

  const handleMarkAll = useCallback(async () => {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      // Optimistic inside the service; it rolls every row back and rethrows on failure (C40).
      await markAllRead(userId);
      notify({ id: "notifications-read-all", title: "All caught up", tone: "success" });
    } catch (err) {
      logSilentFailure("Mark all notifications read", err);
      feedback.error();
      notify({
        id: "notifications-read-all",
        title: "Couldn't mark all as read",
        message: "Check your connection and try again.",
        tone: "error",
      });
    } finally {
      setMarkingAll(false);
    }
  }, [userId, markingAll]);

  const handlePress = useCallback(
    (item: RowItem) => {
      const n = item.notification;
      if (!n.is_read) {
        // Optimistic in the service (rollback on throw); the store already restored the dot, a toast is all that is left.
        markRead(userId, n.id).catch((err) => {
          logSilentFailure("Mark notification read", err);
          notify({ id: "notification-read-error", title: "Couldn't mark as read", tone: "error" });
        });
      }
      if (item.orderId) router.push(`/order/track/${item.orderId}`);
    },
    [userId],
  );

  const handleDismiss = useCallback(
    (id: string, source: DismissSource) => {
      dismissLocally(userId, id);
      // A full swipe already played `select` at the threshold — one gesture, one haptic (W3 R4-02); the action
      // button, long-press and the a11y action still get `remove`.
      if (source !== "swipe") feedback.remove();
      notify({
        id: `notification-dismissed:${id}`,
        title: "Notification dismissed",
        action: { label: "Undo", onPress: () => restoreLocally(userId, id) },
      });
    },
    [userId],
  );

  const { data, sticky } = useMemo(() => buildListData(list ?? [], grouped, clock), [list, grouped, clock]);
  const unreadCount = useMemo(() => (list ? list.reduce((acc, n) => (n.is_read ? acc : acc + 1), 0) : 0), [list]);
  const longPressDismiss = swipeEnabled && reduced;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) =>
      item.kind === "header" ? (
        <GroupHeader label={item.label} />
      ) : (
        <NotificationRow
          item={item}
          swipeEnabled={swipeEnabled}
          showDot={showDot}
          longPressDismiss={longPressDismiss}
          onPress={handlePress}
          onDismiss={handleDismiss}
        />
      ),
    [swipeEnabled, showDot, longPressDismiss, handlePress, handleDismiss],
  );

  const header = (
    <ScreenHeader
      size="lg"
      title="Notifications"
      subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
      backFallbackHref="/(tabs)/home"
      right={
        <View style={styles.headerActions}>
          {unreadCount > 0 ? (
            <PressableScale
              scale={motion.scale.chip}
              pressedStyle={styles.markAllPressed}
              innerStyle={styles.markAllBtn}
              onPress={() => void handleMarkAll()}
              disabled={markingAll}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Mark all as read"
              accessibilityState={{ disabled: markingAll, busy: markingAll }}
            >
              <Text style={styles.markAllText}>Mark all read</Text>
            </PressableScale>
          ) : null}
          {/* Settings cog: navigation, silent. */}
          <IconButton icon="cog-outline" bg="transparent" accessibilityLabel="Notification settings" onPress={openPreferences} />
        </View>
      }
    />
  );

  const pushBand =
    pushEnabled === false ? (
      <View style={styles.pushBand}>
        <MaterialCommunityIcons name="bell-alert-outline" size={22} color={C.primary} />
        <View style={styles.pushText}>
          <Text style={styles.pushTitle}>Turn on notifications</Text>
          <Text style={styles.pushSub}>Get order updates the moment they happen.</Text>
        </View>
        <PrimaryButton size="xs" label="Enable" loading={enablingPush} onPress={() => void handleEnablePush()} />
      </View>
    ) : null;

  const loading = useForceSkeleton(list === undefined && !loadError);

  if (loading) {
    return (
      <Screen bg={C.card}>
        {header}
        {pushBand}
        <SkeletonScreen label="Loading notifications…">
          {SKELETON_ROWS.map((i) => (
            <View key={i} style={[styles.row, styles.rowDivider]}>
              <View style={styles.dotSlot}>
                <Skeleton width={DOT_SIZE} height={DOT_SIZE} radius={DOT_SIZE / 2} />
              </View>
              <View style={styles.rowText}>
                <Skeleton width="55%" height={14} />
                <Skeleton width="85%" height={12} style={styles.skeletonGap} />
                <Skeleton width="25%" height={10} style={styles.skeletonGap} />
              </View>
            </View>
          ))}
        </SkeletonScreen>
      </Screen>
    );
  }

  return (
    <Screen bg={C.card}>
      {header}
      {pushBand}
      <FlashList
        data={data}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        extraData={renderItem}
        stickyHeaderIndices={grouped && sticky.length > 0 ? sticky : undefined}
        onScrollBeginDrag={closeOpenRow}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={C.primary} colors={[C.primary]} />}
        ListEmptyComponent={
          loadError ? (
            <EmptyState
              tone="error"
              icon="wifi-off"
              title="Couldn't load notifications"
              text="Check your connection and try again."
              action={{ label: "Retry", onPress: () => void load(true) }}
            />
          ) : (
            <EmptyState iconWrap icon="bell-outline" title="You're all caught up" text="Order updates will appear here" />
          )
        }
      />
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  markAllBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, minHeight: 36, justifyContent: "center" },
  markAllPressed: { backgroundColor: C.primaryXLight },
  markAllText: { ...text.link },

  // Push nudge: flat band, no card chrome.
  pushBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: layout.gutter,
    paddingVertical: 12,
    backgroundColor: C.primaryXLight,
  },
  pushText: { flex: 1 },
  pushTitle: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text },
  pushSub: { fontFamily: fontFamily.regular, fontSize: 12, color: C.textSub, marginTop: 1 },

  list: { paddingBottom: layout.scrollBottom },

  groupHeader: { backgroundColor: C.surfaceBand, paddingHorizontal: layout.gutter, paddingVertical: 6 },
  groupHeaderText: { ...text.eyebrow },

  swipeContainer: { backgroundColor: C.card },
  rowDivider: { backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: layout.gutter,
    paddingVertical: 14,
    backgroundColor: C.card,
  },
  rowPressed: { backgroundColor: C.bgSoft },
  dotSlot: { width: DOT_SIZE, alignItems: "center", paddingTop: 6 },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, backgroundColor: C.primary },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, color: C.text },
  rowTitleUnread: { fontFamily: fontFamily.bold },
  rowBody: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: C.textSub, marginTop: 2 },
  rowTime: { ...text.caption, marginTop: 6 },
  skeletonGap: { marginTop: 8 },

  actionOuter: { width: ACTION_WIDTH },
  action: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: C.dangerLight },
  actionPressed: { backgroundColor: C.dangerBorder },
  actionLabel: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.danger },
});
