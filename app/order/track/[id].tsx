// codename: mira
// Live tracking (W2-tracking · design/blinkit-parity §3.13 / BP-23 · speed-and-ease #8 · motion M13 / M23 / C5).
// Header "Order #code" + LivePill (pulses once per received poll, "Paused" offline / backgrounded / terminal) →
// ArrivalHero ("Arriving in N min" countdown, 4-step progress, "Signal lost · Retry" offline) → map card (markers stop
// re-rasterising 700 ms after mount; positions snap on each poll — no interpolation, C5) → RiderCard → delivery PIN →
// items / timeline on Collapsible → flat address rows → help row carrying `orderId`. Delivered → check circle +
// "Rate order"; cancelled → status banner on EmptyState. Data: `useOrderTracking` (adaptive poll, terminal stop,
// AppState + offline pause, driver poll only with a rider, 8 s timeouts, synthetic dev seam). Feedback: the hook
// fires `passive('tap' | 'success')` on a status advance; pull-to-refresh → `tapSound`; every press here only
// navigates and stays silent. No global layout animation over the MapView (MAP §7.17), no legacy RN animation API, no screen tick.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Polyline, type Region } from "react-native-maps";

import { ArrivalHero } from "../../../components/tracking/ArrivalHero";
import { LivePill } from "../../../components/tracking/LivePill";
import { RiderCard } from "../../../components/tracking/RiderCard";
import {
  Badge,
  Card,
  ChevronRotate,
  Collapsible,
  EmptyState,
  IconButton,
  ListRow,
  PressableScale,
  PrimaryButton,
  Screen,
  ScreenHeader,
  Skeleton,
  SkeletonCircle,
  SkeletonScreen,
  notify,
  type IconName,
} from "../../../components/ui";
import { C } from "../../../constants/colors";
import { CANCELLED_STATUSES, ORDER_TIMELINE, getStatusMeta, getTimelineIndex } from "../../../constants/orderStatus";
import { fontFamily, layout, motion, radius, text as typo } from "../../../constants/ui";
import { isTerminalStatus, useOrderTracking } from "../../../hooks/useOrderTracking";
import { useForceSkeleton, useSlowLoad } from "../../../hooks/useSlowLoad";
import { getDevFlag } from "../../../lib/devFlags";
import { feedback } from "../../../lib/feedback";
import { logSilentFailure } from "../../../lib/logSilentFailure";
import { getIsOnline } from "../../../lib/network";
import { peekOrder, shouldShowOTP } from "../../../lib/orderService";
import type {
  DriverLocation,
  TrackingOrderItem,
  TrackingStatusEvent,
  TrackingStoreLocation,
  TrackingStoreOrder,
} from "../../../lib/trackingService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type LatLng = { latitude: number; longitude: number };

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDateTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

function isCancelledStatus(status: string): boolean {
  return CANCELLED_STATUSES.some((s) => s === status);
}

/** Android rasterises custom marker views once; keep tracking view changes only this long after mount (select-map pattern). */
const MARKER_TRACK_MS = 700;

function openTel(phone: string, who: string) {
  Linking.openURL(`tel:${phone}`).catch((err: unknown) => {
    logSilentFailure("Tracking: call", err);
    notify({ id: "tracking-call", tone: "error", title: "Couldn't start the call", message: `Dial ${phone} to reach ${who}` });
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TrackOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = typeof id === "string" ? id : "";
  const { data, driverLocations, loading, error, refresh, lastUpdatedAt, paused } = useOrderTracking(orderId);
  const slow = useSlowLoad(loading);
  const showSkeleton = useForceSkeleton(loading);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showItems, setShowItems] = useState(false);
  // Per-store "items from this store" collapsible toggle, keyed by the store order's id.
  const [expandedStoreOrderIds, setExpandedStoreOrderIds] = useState<Set<string>>(new Set());
  // Order code from the memory mirror so the header reads "Order #…" before the first poll lands (§2.17 peekOrder).
  const [seedCode] = useState(() => peekOrder(orderId)?.order_number ?? null);

  const toggleStoreItems = (storeOrderId: string) =>
    setExpandedStoreOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeOrderId)) next.delete(storeOrderId);
      else next.add(storeOrderId);
      return next;
    });

  const order = data?.order;
  const status = order?.status ?? "pending_at_store";
  const meta = getStatusMeta(status);
  const isCancelled = isCancelledStatus(status);
  const terminal = isTerminalStatus(status);
  const code = order?.order_code || seedCode || (order?.id ?? orderId).slice(0, 8).toUpperCase();

  // ─── Delivery OTP — stored on the order, shown to the customer at handoff ───
  const deliveryOTP = shouldShowOTP(status) ? (order?.delivery_otp ?? null) : null;

  const storeOrders = useMemo(() => order?.store_orders ?? [], [order?.store_orders]);
  const isMultiStore = storeOrders.length > 1;
  // A store's own per-store status starts (and used to stay stuck) at
  // 'pending_at_store' until that specific store accepts (backend now sets
  // it to 'store_accepted' on acceptAllocation). Gates the store map/cards
  // below: nothing about individual stores is shown until at least one has
  // actually confirmed. `isMultiStore` above stays based on the FULL live
  // store list so a structurally multi-store order keeps a stable layout as
  // more stores accept one by one, rather than flipping layouts partway
  // through.
  const acceptedStoreOrders = useMemo(
    () => storeOrders.filter((so) => so.status && so.status !== "pending_at_store"),
    [storeOrders],
  );
  // Also requires status === 'pending_at_store' (not just the per-store
  // check) — a safety net for orders already in flight at the moment this
  // per-store status write shipped: their per-store status may still be
  // stuck at 'pending_at_store' forever (acceptAllocation never wrote it
  // before), but the order's own status only ever leaves 'pending_at_store'
  // once a store has genuinely accepted, so it's a reliable independent
  // signal that doesn't depend on the per-store column being fresh.
  const noStoreAcceptedYet =
    !isCancelled && status !== "order_delivered" && acceptedStoreOrders.length === 0 && status === "pending_at_store";

  // Pick the agent for the (single) store order. For multi-store we render a card per store.
  const primaryStoreOrder = acceptedStoreOrders[0];
  const primaryAgent = useMemo(() => {
    if (!primaryStoreOrder?.delivery_partner_id) return data?.deliveryAgent;
    return data?.deliveryAgents?.[primaryStoreOrder.delivery_partner_id] ?? data?.deliveryAgent;
  }, [primaryStoreOrder, data]);

  const primaryDriverLocation = useMemo(() => {
    if (!primaryStoreOrder?.delivery_partner_id) return undefined;
    return driverLocations[primaryStoreOrder.delivery_partner_id];
  }, [primaryStoreOrder, driverLocations]);

  const storeLocation = data?.storeLocations?.[0];
  // Memoized on the actual coordinate values (not just [order] — a new order
  // object arrives on every snapshot change even when nothing moved),
  // so `dest` only changes reference when the delivery point itself does.
  const dest = useMemo<LatLng | undefined>(() => {
    if (order?.delivery_latitude == null || order?.delivery_longitude == null) return undefined;
    return { latitude: Number(order.delivery_latitude), longitude: Number(order.delivery_longitude) };
  }, [order?.delivery_latitude, order?.delivery_longitude]);

  // Center the map so destination + store + driver are all in frame.
  // Keyed on rounded coordinates (~1m precision) rather than the raw
  // dest/storeLocation/driverLocation objects — those are new references on
  // every render even when nothing actually moved (driverLocations updates
  // every 2s poll), which previously made this recompute continuously and,
  // combined with passing it as MapView's controlled `region` prop, forced
  // the map to re-snap to the fitted bounds on every poll tick — the
  // customer could never manually pan or zoom the map before it got reset.
  // Found 2026-08-13 via a live click-test/code-review deep dive of the map
  // implementation. Fixed the same way the website's DeliveryMap.tsx
  // already does it (see fitBoundsToFullRoute's driverPosKey there): only
  // recompute when a rounded-coordinate key actually changes, and drive the
  // map imperatively (mapRef.animateToRegion, inside TrackingMap) instead of a
  // continuously-bound controlled `region` prop, so the user can freely
  // pan/zoom between real position updates.
  const regionKey = [
    dest ? `${dest.latitude.toFixed(5)},${dest.longitude.toFixed(5)}` : "",
    storeLocation ? `${storeLocation.lat.toFixed(5)},${storeLocation.lng.toFixed(5)}` : "",
    primaryDriverLocation
      ? `${primaryDriverLocation.latitude.toFixed(5)},${primaryDriverLocation.longitude.toFixed(5)}`
      : "",
  ].join("|");

  const mapRegion: Region | undefined = useMemo(() => {
    const points: LatLng[] = [];
    if (dest) points.push(dest);
    if (storeLocation) points.push({ latitude: storeLocation.lat, longitude: storeLocation.lng });
    if (primaryDriverLocation) {
      points.push({ latitude: primaryDriverLocation.latitude, longitude: primaryDriverLocation.longitude });
    }
    if (points.length === 0) return undefined;

    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    // Pad so markers aren't pinned to the map edges.
    const latDelta = Math.max((maxLat - minLat) * 1.6, 0.01);
    const lngDelta = Math.max((maxLng - minLng) * 1.6, 0.01);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on regionKey, not the raw objects (see comment above)
  }, [regionKey]);

  // Always render the timeline; mark statuses up to the current as completed. The fallback uses the order's own
  // placed time (never `new Date()` in render — MAP C46).
  const timelineIndex = getTimelineIndex(status);
  const visibleHistory = useMemo<TrackingStatusEvent[]>(() => {
    if (data?.statusHistory && data.statusHistory.length > 0) return data.statusHistory;
    const placed = order?.placed_at || order?.created_at || "";
    return ORDER_TIMELINE.slice(0, Math.max(timelineIndex + 1, 1)).map((s) => ({ status: s.key, created_at: placed }));
  }, [data?.statusHistory, order?.placed_at, order?.created_at, timelineIndex]);

  const deliveredAt = useMemo(
    () => visibleHistory.find((h) => h.status === "order_delivered")?.created_at ?? null,
    [visibleHistory],
  );

  const allItems = useMemo(() => storeOrders.flatMap((so) => so.order_items || []), [storeOrders]);

  // ─── Handlers (navigation is silent; the result of an action plays feedback — CONTRACTS §8) ───
  const onRetry = useCallback(() => {
    if (!getIsOnline() && !getDevFlag("Dev_Cobalt_inhibit_Feature")) {
      notify({ id: "tracking-offline", icon: "wifi-off", title: "Still offline", message: "We'll refresh as soon as you're back online" });
      return;
    }
    refresh();
  }, [refresh]);

  const onRefresh = async () => {
    feedback.tapSound();
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  // dismissTo pops to the live tabs route instead of mounting a second tab navigator (W3 R6-04).
  const goHome = () => router.dismissTo("/(tabs)/home");
  const goRate = () => router.push(`/order/rate/${orderId}`);
  const goHelp = () => router.push({ pathname: "/settings/support", params: { orderId } });

  const header = (
    <ScreenHeader
      size="md"
      title={`Order #${code}`}
      backFallbackHref="/orders"
      right={<LivePill lastUpdatedAt={lastUpdatedAt} live={!paused && !terminal && !error} />}
    />
  );

  // ─── Loading ───
  if (showSkeleton) {
    return (
      <Screen bg={C.bg} edges={["top"]}>
        {header}
        <TrackSkeleton slow={slow} onRetry={onRetry} />
      </Screen>
    );
  }

  // ─── Error / 404 (only with nothing painted yet — a failed poll keeps the screen and shows "Signal lost") ───
  if (!order) {
    const notFound = !!error && /not found/i.test(error);
    return (
      <Screen bg={C.bg} edges={["top"]}>
        {header}
        {notFound ? (
          <EmptyState
            fill
            iconWrap
            icon="map-marker-off-outline"
            title="Order not found"
            text="This order may have been removed, or the link is out of date."
            action={{ label: "Go to orders", onPress: () => router.replace("/orders") }}
          />
        ) : (
          <EmptyState
            fill
            iconWrap
            icon="map-marker-off-outline"
            title="Couldn't load tracking"
            text={error ?? "Something went wrong while loading this order."}
            action={{ label: "Retry", icon: "refresh", onPress: onRetry }}
          />
        )}
      </Screen>
    );
  }

  const showMap = !noStoreAcceptedYet && !terminal && !!mapRegion && !isMultiStore;
  const storePhone = storeLocation?.phone ?? null;
  const showStoreCards = !noStoreAcceptedYet && !isCancelled && isMultiStore;

  return (
    <Screen bg={C.bg} edges={["top"]}>
      {header}

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* ─── Hero: countdown + progress, delivered → Rate, cancelled → banner ─── */}
        {isCancelled ? (
          <EmptyState
            tone="error"
            icon="close-circle-outline"
            title="Order cancelled"
            text="This order was not fulfilled."
            action={{ label: "Back to Home", variant: "secondary", onPress: goHome }}
            style={styles.cancelledState}
          >
            <Badge label={meta.label} bg={meta.bg} color={meta.color} icon={meta.icon} style={styles.cancelledBadge} />
          </EmptyState>
        ) : (
          <ArrivalHero
            status={status}
            estimatedDeliveryTime={order.estimated_delivery_time}
            deliveredAt={deliveredAt}
            deliveredBy={primaryAgent?.name ?? null}
            signalLost={paused || !!error}
            lastUpdatedAt={lastUpdatedAt}
            onRetry={onRetry}
            onRate={goRate}
            onHome={goHome}
          />
        )}

        {/* ─── Map (single-store, in flight) ─── */}
        {showMap && mapRegion ? (
          <TrackingMap
            region={mapRegion}
            regionKey={regionKey}
            dest={dest}
            storeLocation={storeLocation}
            driverLocation={primaryDriverLocation}
            agentName={primaryAgent?.name}
            deliveryAddress={order.delivery_address}
          />
        ) : null}

        {/* ─── Multi-store: one card per store that has accepted ─── */}
        {showStoreCards ? (
          <View style={styles.storeOrderList}>
            {/* A store still at 'pending_at_store' is excluded from acceptedStoreOrders entirely
                (no placeholder box), so cards appear one by one as each store responds. */}
            {acceptedStoreOrders.map((so) => (
              <StoreCard
                key={so.id}
                storeOrder={so}
                location={data?.storeLocations?.find((s) => s.store_id === so.store_id)}
                expanded={expandedStoreOrderIds.has(so.id)}
                onToggle={() => toggleStoreItems(so.id)}
              />
            ))}
          </View>
        ) : null}

        {/* ─── Rider ─── */}
        {primaryAgent && !terminal ? (
          <RiderCard name={primaryAgent.name} phone={primaryAgent.phone} vehicle={primaryAgent.vehicle_number} />
        ) : null}

        {/* ─── Delivery PIN ─── */}
        {deliveryOTP && !isCancelled ? <OtpCard otp={deliveryOTP} /> : null}

        {/* ─── Items (collapsible, default collapsed) ─── */}
        <Card size="lg" padded={false} borderColor={C.hairline} style={styles.section}>
          <SectionToggle
            title={`${allItems.length} ${allItems.length === 1 ? "item" : "items"}`}
            open={showItems}
            onPress={() => setShowItems((v) => !v)}
            accessibilityLabel={`${allItems.length} items, ${showItems ? "collapse" : "expand"}`}
          />
          <Collapsible open={showItems}>
            <View style={styles.itemsBody}>
              {allItems.length === 0 ? <Text style={styles.itemsEmpty}>No items to show</Text> : null}
              {allItems.map((it, idx) => (
                <ItemRow key={`${it.product_name}-${idx}`} item={it} last={idx === allItems.length - 1} />
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>₹{Math.round(order.total_amount || 0)}</Text>
              </View>
            </View>
          </Collapsible>
        </Card>

        {/* ─── Timeline (collapsible) ─── */}
        <Card size="lg" padded={false} borderColor={C.hairline} style={styles.section}>
          <SectionToggle
            title="Order timeline"
            open={showHistory}
            onPress={() => setShowHistory((v) => !v)}
            accessibilityLabel={`Order timeline, ${showHistory ? "collapse" : "expand"}`}
          />
          <Collapsible open={showHistory}>
            <View style={styles.timeline}>
              {visibleHistory.map((event, idx) => (
                <TimelineRow key={`${event.status}-${idx}`} event={event} last={idx === visibleHistory.length - 1} />
              ))}
            </View>
          </Collapsible>
        </Card>

        {/* ─── Address (flat rows) ─── */}
        <View style={styles.flatSection}>
          {storeLocation ? (
            <InfoRow
              icon="storefront-outline"
              label="Picked up from"
              value={storeLocation.label || "Store"}
              secondary={storeLocation.address}
              divider
              right={
                storePhone ? (
                  <IconButton
                    icon="phone-outline"
                    size={38}
                    iconSize={18}
                    bg={C.primaryXLight}
                    color={C.primary}
                    accessibilityLabel="Call store"
                    onPress={() => openTel(storePhone, storeLocation.label || "the store")}
                  />
                ) : null
              }
            />
          ) : null}
          <InfoRow
            icon="map-marker-outline"
            label="Delivering to"
            value={order.delivery_address || "—"}
            valueLines={3}
            divider={!!order.receiver_name}
          />
          {order.receiver_name ? (
            <InfoRow
              icon="account-outline"
              label="Ordered for"
              value={`${order.receiver_name}${order.receiver_phone ? ` · ${order.receiver_phone}` : ""}`}
              valueLines={2}
            />
          ) : null}
        </View>

        {/* ─── Help (carries the order id) ─── */}
        <Card size="lg" padded={false} borderColor={C.hairline} style={styles.section}>
          <ListRow
            icon="headset"
            title="Need help with this order?"
            subtitle="Chat or call our support team"
            onPress={goHelp}
            accessibilityLabel={`Need help with order ${code}?`}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

// ─── Map card (memoised: the per-poll `lastUpdatedAt` re-render of the screen never reaches the MapView) ──────────

type TrackingMapProps = {
  region: Region;
  regionKey: string;
  dest?: LatLng;
  storeLocation?: TrackingStoreLocation;
  driverLocation?: DriverLocation;
  agentName?: string;
  deliveryAddress?: string;
};

const TrackingMap = React.memo(function TrackingMap({
  region,
  regionKey,
  dest,
  storeLocation,
  driverLocation,
  agentName,
  deliveryAddress,
}: TrackingMapProps) {
  const mapRef = useRef<MapView>(null);
  const lastAnimatedKeyRef = useRef<string | null>(null);
  // Android's react-native-maps rasterises the custom marker view once and caches that snapshot. If the icon font
  // has not finished loading at that moment the marker ends up half drawn, and while tracking stays ON every render
  // re-rasterises it (flicker). Track for 700 ms after mount, then freeze — pattern from location/select-map.tsx.
  const [trackChanges, setTrackChanges] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setTrackChanges(false), MARKER_TRACK_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (lastAnimatedKeyRef.current === regionKey) return;
    const isFirstFix = lastAnimatedKeyRef.current === null;
    lastAnimatedKeyRef.current = regionKey;
    mapRef.current.animateToRegion(region, isFirstFix ? 0 : 500);
  }, [regionKey, region]);

  return (
    <Card size="lg" padded={false} bg={C.bgSoft} borderColor={C.hairline} style={styles.mapWrap}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        loadingEnabled
        loadingIndicatorColor={C.primary}
        accessibilityLabel="Map showing your order"
      >
        {dest ? (
          <Marker
            coordinate={dest}
            title="Delivery address"
            description={deliveryAddress}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={trackChanges}
          >
            <View style={styles.markerHome}>
              <MaterialCommunityIcons name="home-map-marker" size={20} color={C.onPrimary} />
            </View>
          </Marker>
        ) : null}
        {storeLocation ? (
          <Marker
            coordinate={{ latitude: storeLocation.lat, longitude: storeLocation.lng }}
            title={storeLocation.label || "Store"}
            description={storeLocation.address}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={trackChanges}
          >
            <View style={styles.markerStore}>
              <MaterialCommunityIcons name="storefront" size={18} color={C.onPrimary} />
            </View>
          </Marker>
        ) : null}
        {driverLocation ? (
          // Position snaps to each poll — no interpolation (motion doc C5: an animated marker fights tracksViewChanges).
          <Marker
            coordinate={{ latitude: driverLocation.latitude, longitude: driverLocation.longitude }}
            title={agentName || "Delivery partner"}
            description={driverLocation.updated_at ? `Updated ${formatTime(driverLocation.updated_at)}` : undefined}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            tracksViewChanges={trackChanges}
          >
            <View style={styles.markerDriver}>
              <MaterialCommunityIcons name="bike-fast" size={18} color={C.onPrimary} />
            </View>
          </Marker>
        ) : null}

        {driverLocation && dest ? (
          <Polyline
            coordinates={[{ latitude: driverLocation.latitude, longitude: driverLocation.longitude }, dest]}
            strokeColor={C.primary}
            strokeWidth={3}
            lineDashPattern={[6, 4]}
          />
        ) : null}
        {!driverLocation && storeLocation && dest ? (
          <Polyline
            coordinates={[{ latitude: storeLocation.lat, longitude: storeLocation.lng }, dest]}
            strokeColor={C.textLight}
            strokeWidth={2}
            lineDashPattern={[4, 6]}
          />
        ) : null}
      </MapView>

      {!driverLocation ? (
        <View style={styles.mapHint}>
          <MaterialCommunityIcons name="information-outline" size={14} color={C.textSub} />
          <Text style={styles.mapHintText}>Live rider location will appear once a rider is assigned.</Text>
        </View>
      ) : null}
    </Card>
  );
});

// ─── Multi-store card ─────────────────────────────────────────────────────────

function StoreCard({
  storeOrder,
  location,
  expanded,
  onToggle,
}: {
  storeOrder: TrackingStoreOrder;
  location?: TrackingStoreLocation;
  expanded: boolean;
  onToggle: () => void;
}) {
  const storeMeta = getStatusMeta(storeOrder.status);
  const items = storeOrder.order_items || [];
  const name = location?.label || "Store";
  const phone = location?.phone ?? null;
  return (
    <Card size="lg" padded={false} borderColor={C.hairline} style={styles.storeOrderCard}>
      <View style={styles.storeOrderHeader}>
        <MaterialCommunityIcons name="storefront" size={20} color={C.primary} />
        <View style={styles.flex1}>
          <Text style={styles.storeOrderName} numberOfLines={1}>
            {name}
          </Text>
          {location?.address ? (
            <Text style={styles.storeOrderAddress} numberOfLines={2}>
              {location.address}
            </Text>
          ) : null}
        </View>
        {phone ? (
          <IconButton
            icon="phone"
            size={38}
            iconSize={18}
            bg={C.primaryXLight}
            color={C.primary}
            accessibilityLabel={`Call ${name}`}
            onPress={() => openTel(phone, name)}
          />
        ) : null}
      </View>
      <Badge
        label={storeMeta.label}
        bg={storeMeta.bg}
        color={storeMeta.color}
        icon={storeMeta.icon}
        style={styles.storePill}
      />
      {items.length > 0 ? (
        <>
          <SectionToggle
            title="Items from this store"
            count={items.length}
            open={expanded}
            onPress={onToggle}
            accessibilityLabel={`Items from ${name}, ${expanded ? "collapse" : "expand"}`}
          />
          <Collapsible open={expanded}>
            <View style={styles.itemsBody}>
              {items.map((it, idx) => (
                <ItemRow key={`${it.product_name}-${idx}`} item={it} last={idx === items.length - 1} />
              ))}
            </View>
          </Collapsible>
        </>
      ) : null}
    </Card>
  );
}

// ─── Delivery PIN ─────────────────────────────────────────────────────────────

function OtpCard({ otp }: { otp: string }) {
  return (
    <Card size="lg" borderColor={C.primary} style={styles.otpCard}>
      <View style={styles.otpHeader}>
        <View style={styles.otpIcon}>
          <MaterialCommunityIcons name="shield-key" size={24} color={C.primary} />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.otpTitle}>Delivery verification PIN</Text>
          <Text style={styles.otpSub}>Share this PIN with your delivery partner to confirm delivery</Text>
        </View>
      </View>
      <View style={styles.otpDisplay} accessible accessibilityLabel={`Delivery PIN ${otp.split("").join(" ")}`}>
        {otp.split("").map((digit, idx) => (
          <View key={idx} style={styles.otpDigit}>
            <Text style={styles.otpDigitText}>{digit}</Text>
          </View>
        ))}
      </View>
      <View style={styles.otpWarning}>
        <MaterialCommunityIcons name="information-outline" size={14} color={C.warningText} />
        <Text style={styles.otpWarningText}>Do not share this PIN until you receive your order</Text>
      </View>
    </Card>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/** Collapsible header: h3 title (+ muted count) and a rotating chevron. Silent (it only opens a section). */
function SectionToggle({
  title,
  count,
  open,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  count?: number;
  open: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      scale={motion.scale.row}
      onPress={onPress}
      innerStyle={styles.sectionToggle}
      pressedStyle={styles.sectionTogglePressed}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: open }}
    >
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {title}
        {count !== undefined ? <Text style={styles.sectionCount}> ({count})</Text> : null}
      </Text>
      <ChevronRotate open={open} />
    </PressableScale>
  );
}

function ItemRow({ item, last }: { item: TrackingOrderItem; last: boolean }) {
  return (
    <View style={[styles.itemRow, !last && styles.itemRowBorder]}>
      <View style={styles.flex1}>
        <Text style={styles.itemName} numberOfLines={2}>
          {item.product_name}
        </Text>
        <Text style={styles.itemUnit}>
          ₹{Number(item.unit_price).toFixed(2)} {item.unit ? `/ ${item.unit}` : ""}
        </Text>
      </View>
      <View style={styles.itemRight}>
        <Text style={styles.itemQty}>×{item.quantity}</Text>
        <Text style={styles.itemTotal}>₹{Math.round(Number(item.unit_price) * Number(item.quantity))}</Text>
      </View>
    </View>
  );
}

function TimelineRow({ event, last }: { event: TrackingStatusEvent; last: boolean }) {
  const eventMeta = getStatusMeta(event.status);
  const stamp = formatDateTime(event.created_at);
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineLeft}>
        <View style={[styles.timelineDot, { backgroundColor: eventMeta.color }]}>
          <MaterialCommunityIcons name={eventMeta.icon} size={14} color={C.onPrimary} />
        </View>
        {!last ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineContent}>
        <Text style={styles.timelineLabel}>{eventMeta.label}</Text>
        <Text style={styles.timelineDesc}>{eventMeta.description}</Text>
        {stamp ? <Text style={styles.timelineTime}>{stamp}</Text> : null}
        {event.notes ? <Text style={styles.timelineNotes}>{event.notes}</Text> : null}
      </View>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  secondary,
  valueLines = 1,
  right,
  divider = false,
  style,
}: {
  icon: IconName;
  label: string;
  value: string;
  secondary?: string;
  valueLines?: number;
  right?: React.ReactNode;
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.infoRow, divider && styles.infoRowDivider, style]}>
      <MaterialCommunityIcons name={icon} size={18} color={C.primary} style={styles.infoIcon} />
      <View style={styles.flex1}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={valueLines}>
          {value}
        </Text>
        {secondary ? (
          <Text style={styles.infoSecondary} numberOfLines={2}>
            {secondary}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

/** Loading placeholder mirroring hero → map → two rows. `slow` adds the connection hint + Retry under it. */
function TrackSkeleton({ slow, onRetry }: { slow: boolean; onRetry: () => void }) {
  return (
    <View style={styles.flex1}>
      <SkeletonScreen label="Loading live tracking">
        <Card size="lg" borderColor={C.hairline} style={styles.heroSkeleton}>
          <Skeleton width={88} height={11} radius={radius.xs} />
          <Skeleton width={160} height={44} radius={radius.lg} style={styles.skeletonGapLg} />
          <Skeleton height={12} style={styles.skeletonGapLg} />
          <Skeleton width="70%" height={12} style={styles.skeletonGap} />
          <View style={styles.skeletonSegments}>
            <Skeleton width={0} height={6} radius={3} style={styles.flex1} />
            <Skeleton width={0} height={6} radius={3} style={styles.flex1} />
            <Skeleton width={0} height={6} radius={3} style={styles.flex1} />
            <Skeleton width={0} height={6} radius={3} style={styles.flex1} />
          </View>
        </Card>
        <Skeleton height={280} radius={radius.card} shimmer style={styles.mapSkeleton} />
        <View style={styles.rowSkeletons}>
          <View style={styles.rowSkeleton}>
            <SkeletonCircle size={44} />
            <View style={styles.flex1}>
              <Skeleton width={120} height={12} />
              <Skeleton width="60%" height={10} style={styles.skeletonGap} />
            </View>
          </View>
          <View style={styles.rowSkeleton}>
            <SkeletonCircle size={44} />
            <View style={styles.flex1}>
              <Skeleton width={160} height={12} />
              <Skeleton width="80%" height={10} style={styles.skeletonGap} />
            </View>
          </View>
        </View>
      </SkeletonScreen>
      {slow ? (
        <View style={styles.slowHint}>
          <Text style={styles.slowHintText}>Still loading… check your connection</Text>
          <PrimaryButton size="xs" variant="ghost" label="Retry" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollContent: { paddingBottom: layout.scrollBottom },

  // Skeleton
  heroSkeleton: { marginHorizontal: layout.gutter, marginTop: layout.gutter },
  skeletonGap: { marginTop: 8 },
  skeletonGapLg: { marginTop: 12 },
  skeletonSegments: { flexDirection: "row", gap: 4, marginTop: 16 },
  mapSkeleton: { marginHorizontal: layout.gutter, marginTop: layout.cardGap },
  rowSkeletons: { marginHorizontal: layout.gutter, marginTop: layout.cardGap, gap: layout.cardGap },
  rowSkeleton: { flexDirection: "row", alignItems: "center", gap: layout.rowGap },
  slowHint: { alignItems: "center", gap: 6, paddingVertical: 16 },
  slowHintText: { ...typo.caption, fontSize: 12 },

  // Cancelled
  cancelledState: { marginTop: 8, paddingVertical: 24 },
  cancelledBadge: { alignSelf: "center" },

  // Map
  mapWrap: { marginHorizontal: layout.gutter, marginTop: layout.cardGap },
  map: { width: "100%", height: 280 },
  mapHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  mapHintText: { ...typo.rowSubtitle, flex: 1, lineHeight: 16 },
  markerHome: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.white,
    shadowColor: C.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  markerStore: {
    width: 34,
    height: 34,
    borderRadius: radius.lg,
    backgroundColor: C.warning,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.white,
    shadowColor: C.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  markerDriver: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.info,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.white,
    shadowColor: C.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },

  // Multi-store cards
  storeOrderList: { marginHorizontal: layout.gutter, marginTop: layout.cardGap, gap: layout.cardGap },
  storeOrderCard: {},
  storeOrderHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: layout.cardPaddingLg, paddingBottom: 0 },
  storeOrderName: { fontFamily: fontFamily.bold, fontSize: 15, color: C.text },
  storeOrderAddress: { ...typo.rowSubtitle, marginTop: 2 },
  storePill: { marginHorizontal: layout.cardPaddingLg, marginTop: 12, marginBottom: 4 },

  // Sections (items / timeline / help)
  section: { marginHorizontal: layout.gutter, marginTop: layout.cardGap },
  sectionToggle: { flexDirection: "row", alignItems: "center", padding: layout.cardPaddingLg, gap: 10 },
  sectionTogglePressed: { backgroundColor: C.bgSoft },
  sectionTitle: { ...typo.h3, flex: 1 },
  sectionCount: { color: C.textSub, fontFamily: fontFamily.semibold },

  // Items
  itemsBody: { paddingHorizontal: layout.cardPaddingLg, paddingBottom: 14 },
  itemsEmpty: { ...typo.bodySm, textAlign: "center", paddingVertical: 16 },
  itemRow: { flexDirection: "row", paddingVertical: 12, gap: 10, alignItems: "flex-start" },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemName: { ...typo.bodyStrong },
  itemUnit: { ...typo.rowSubtitle, marginTop: 2 },
  itemRight: { alignItems: "flex-end" },
  itemQty: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.textSub },
  itemTotal: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text, marginTop: 2, fontVariant: ["tabular-nums"] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  totalLabel: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text },
  totalValue: { ...typo.amount, fontSize: 16, fontVariant: ["tabular-nums"] },

  // Timeline
  timeline: { paddingHorizontal: layout.cardPaddingLg, paddingBottom: 4 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { width: 28, alignItems: "center" },
  timelineDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  timelineLine: { flex: 1, width: 2, backgroundColor: C.border, marginVertical: 2, minHeight: 24 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineLabel: { ...typo.rowTitle },
  timelineDesc: { ...typo.rowSubtitle, marginTop: 2, lineHeight: 16 },
  timelineTime: { ...typo.caption, marginTop: 4 },
  timelineNotes: { ...typo.rowSubtitle, marginTop: 4, fontStyle: "italic" },

  // Address (flat rows between hairlines)
  flatSection: {
    marginTop: layout.cardGap,
    paddingHorizontal: layout.gutter,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  infoRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 14 },
  infoRowDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  infoIcon: { marginTop: 1 },
  infoLabel: { ...typo.eyebrow },
  infoValue: { ...typo.rowTitle, marginTop: 2 },
  infoSecondary: { ...typo.rowSubtitle, marginTop: 2, lineHeight: 17 },

  // OTP
  otpCard: { marginHorizontal: layout.gutter, marginTop: layout.cardGap },
  otpHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  otpIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.xl,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  otpTitle: { fontFamily: fontFamily.bold, fontSize: 15, color: C.text },
  otpSub: { ...typo.rowSubtitle, marginTop: 4, lineHeight: 16 },
  otpDisplay: { flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 20, marginBottom: 16 },
  otpDigit: {
    width: 52,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: C.primaryXLight,
    borderWidth: 2,
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  otpDigitText: { ...typo.price, color: C.primary, fontVariant: ["tabular-nums"] },
  otpWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  otpWarningText: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 12, color: C.warningText },
});
