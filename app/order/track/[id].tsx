import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    LayoutAnimation,
    Linking,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Polyline, type Region } from "react-native-maps";

import {
    Badge,
    Card,
    Divider,
    EmptyState,
    IconButton,
    IconWrap,
    PrimaryButton,
    Screen,
    ScreenHeader,
    Skeleton,
} from "../../../components/ui";
import { C } from "../../../constants/colors";
import {
    CANCELLED_STATUSES,
    ORDER_TIMELINE,
    type OrderStatus,
    getStatusMeta,
    getTimelineIndex,
} from "../../../constants/orderStatus";
import { clipOverflow, layout, text as typo } from "../../../constants/ui";
import { useOrderTracking } from "../../../hooks/useOrderTracking";
import { shouldShowOTP } from "../../../lib/orderService";

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDateTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Driver location is written server-side by the rider app's foreground/background
// tracking task, roughly every few seconds while active. `driverLocations` here
// is itself only refreshed by a 2s poll (useOrderTracking), so a genuinely
// silent rider (signal lost, app killed, worker crashed) shows the same
// coordinate on every poll while `updated_at` stops advancing — this is what
// distinguishes "still live but hasn't moved" from "actually stuck."
const STALE_DRIVER_LOCATION_MS = 60_000;

function formatAgeShort(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Live order tracking screen.
 *
 * Mirrors the web app's `OrderTrackingPage.tsx` adapted to React Native:
 *   - Pulls order + status history + store/agent context from `/api/tracking/orders/:id/full`
 *   - Subscribes to Supabase realtime for status changes (with 5s polling fallback)
 *   - Polls driver location every 2s for live map marker movement
 *   - Renders single-store orders with a Google map (store + driver + destination markers)
 *
 * Multi-store orders fall back to a list view (no map) until the dedicated
 * multi-store layout is built — same staged rollout the web app used.
 */
export default function TrackOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, driverLocations, loading, error, autoRefreshing, refresh } = useOrderTracking(id);
  const [showHistory, setShowHistory] = useState(false);
  const [showItems, setShowItems] = useState(false);
  // Per-store "items from this store" collapsible toggle, keyed by store_orders.id.
  const [expandedStoreOrderIds, setExpandedStoreOrderIds] = useState<Set<string>>(new Set());
  const toggleStoreItems = (id: string) =>
    setExpandedStoreOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const [refreshing, setRefreshing] = useState(false);
  const order = data?.order;
  const status = (order?.status ?? "pending_at_store") as OrderStatus;

  // ─── Delivery OTP — stored on the order, shown to customer at handoff ───
  const deliveryOTP = useMemo(() => {
    if (!shouldShowOTP(status)) return null;
    return (order as any)?.delivery_otp ?? null;
  }, [status, order]);

  const storeOrders = order?.store_orders ?? [];
  const isMultiStore = storeOrders.length > 1;
  const meta = getStatusMeta(status);
  const isCancelled = CANCELLED_STATUSES.includes(status);
  // A store's own store_orders.status starts (and used to stay stuck) at
  // 'pending_at_store' until that specific store accepts (backend now sets
  // it to 'store_accepted' on acceptAllocation). Gates the store map/cards
  // below: nothing about individual stores is shown until at least one has
  // actually confirmed. `isMultiStore` above stays based on the FULL live
  // store list so a structurally multi-store order keeps a stable layout as
  // more stores accept one by one, rather than flipping layouts partway
  // through.
  const acceptedStoreOrders = storeOrders.filter((so: any) => so.status && so.status !== "pending_at_store");
  // Also requires status === 'pending_at_store' (not just the per-store
  // check) — a safety net for orders already in flight at the moment this
  // per-store status write shipped: their store_orders.status may still be
  // stuck at 'pending_at_store' forever (acceptAllocation never wrote it
  // before), but customer_orders.status only ever leaves 'pending_at_store'
  // once a store has genuinely accepted, so it's a reliable independent
  // signal that doesn't depend on the per-store column being fresh.
  const noStoreAcceptedYet =
    !isCancelled && status !== "order_delivered" && acceptedStoreOrders.length === 0 && status === "pending_at_store";
  const isRunningLate = Boolean(
    order?.estimated_delivery_time && new Date(order.estimated_delivery_time).getTime() < Date.now()
  );

  // Pick the agent for the (single) store order. For multi-store we'd render a card per store.
  const primaryStoreOrder = acceptedStoreOrders[0];
  const primaryAgent = useMemo(() => {
    if (!primaryStoreOrder?.delivery_partner_id) return data?.deliveryAgent;
    return data?.deliveryAgents?.[primaryStoreOrder.delivery_partner_id] ?? data?.deliveryAgent;
  }, [primaryStoreOrder, data]);

  const primaryDriverLocation = useMemo(() => {
    if (!primaryStoreOrder?.delivery_partner_id) return undefined;
    return driverLocations[primaryStoreOrder.delivery_partner_id];
  }, [primaryStoreOrder, driverLocations]);

  // `driverLocations` only changes when a poll actually returns a fresh
  // coordinate — if the rider's updates stop entirely, nothing re-renders
  // this screen and the "Live tracking" pulse would stay green forever with
  // no way to notice. This ticks independently so staleness is re-evaluated
  // even when no new location ever arrives.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tickId = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tickId);
  }, []);

  const driverLocationAgeMs = primaryDriverLocation?.updated_at
    ? now - new Date(primaryDriverLocation.updated_at).getTime()
    : null;
  const isDriverSignalStale =
    driverLocationAgeMs !== null && driverLocationAgeMs > STALE_DRIVER_LOCATION_MS;

  // Presentational only: the "Live tracking" ring breathes outward while the
  // rider signal is fresh. Native driver, looped, stopped on cleanup; kept
  // well outside the MapView subtree.
  const pulse = useMemo(() => new Animated.Value(0), []);
  const showLivePulse = !isCancelled && status !== "order_delivered" && !isDriverSignalStale;
  useEffect(() => {
    if (!showLivePulse) return;
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [pulse, showLivePulse]);
  const livePulseStyle = useMemo(
    () => ({
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
    }),
    [pulse],
  );

  const storeLocation = data?.storeLocations?.[0];
  // Memoized on the actual coordinate values (not just [order] — a new order
  // object arrives on every poll/realtime refresh even when nothing moved),
  // so `dest` only changes reference when the delivery point itself does.
  const dest = useMemo(() => {
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
  // map imperatively (mapRef.animateToRegion, below) instead of a
  // continuously-bound controlled `region` prop, so the user can freely
  // pan/zoom between real position updates.
  const regionKey = [
    dest ? `${dest.latitude.toFixed(5)},${dest.longitude.toFixed(5)}` : '',
    storeLocation ? `${storeLocation.lat.toFixed(5)},${storeLocation.lng.toFixed(5)}` : '',
    primaryDriverLocation
      ? `${primaryDriverLocation.latitude.toFixed(5)},${primaryDriverLocation.longitude.toFixed(5)}`
      : '',
  ].join('|');

  const mapRegion: Region | undefined = useMemo(() => {
    const points: { latitude: number; longitude: number }[] = [];
    if (dest) points.push(dest);
    if (storeLocation) points.push({ latitude: storeLocation.lat, longitude: storeLocation.lng });
    if (primaryDriverLocation) {
      points.push({
        latitude: primaryDriverLocation.latitude,
        longitude: primaryDriverLocation.longitude,
      });
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

  const mapRef = useRef<MapView>(null);
  const lastAnimatedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapRegion || !mapRef.current) return;
    if (lastAnimatedKeyRef.current === regionKey) return;
    const isFirstFix = lastAnimatedKeyRef.current === null;
    lastAnimatedKeyRef.current = regionKey;
    mapRef.current.animateToRegion(mapRegion, isFirstFix ? 0 : 500);
  }, [regionKey, mapRegion]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <Screen>
        <Header title="Live Tracking" />
        <TrackSkeleton />
      </Screen>
    );
  }

  if (error || !order) {
    return (
      <Screen>
        <Header title="Live Tracking" />
        <EmptyState
          fill
          icon="alert-circle-outline"
          iconSize={48}
          title="Tracking unavailable"
          text={error ?? "We couldn't find this order."}
          action={{ label: "Retry", icon: "refresh", onPress: onRefresh }}
        />
      </Screen>
    );
  }

  const timelineIndex = getTimelineIndex(status);
  // Always render the timeline; mark statuses up to the current as completed.
  const visibleHistory =
    data?.statusHistory && data.statusHistory.length > 0
      ? data.statusHistory
      : ORDER_TIMELINE.slice(0, Math.max(timelineIndex + 1, 1)).map((s) => ({
          status: s.key,
          created_at: order.placed_at || order.created_at || new Date().toISOString(),
        }));

  return (
    <Screen>
      <Header
        title={`#${order.order_code || order.id.slice(0, 8).toUpperCase()}`}
        autoRefreshing={autoRefreshing}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* ─── Live status pill + ETA ───────────────────────────────────────── */}
        <Card size="lg" style={styles.statusCard}>
          <View style={styles.liveRow}>
            {!isCancelled && status !== "order_delivered" && (
              <>
                <View style={styles.livePulseWrap}>
                  {!isDriverSignalStale && <Animated.View style={[styles.livePulse, livePulseStyle]} />}
                  <View style={[styles.liveDot, isDriverSignalStale && styles.liveDotStale]} />
                </View>
                <Text style={[styles.liveText, isDriverSignalStale && styles.liveTextStale]}>
                  {isDriverSignalStale && driverLocationAgeMs !== null
                    ? `Signal lost · last seen ${formatAgeShort(driverLocationAgeMs)}`
                    : "Live tracking"}
                </Text>
              </>
            )}
            {isMultiStore && (
              <Badge
                size="sm"
                pill
                label={`${storeOrders.length} stores`}
                style={styles.multiStoreBadge}
                textStyle={styles.multiStoreBadgeText}
              />
            )}
          </View>

          <Badge
            label={meta.label}
            bg={meta.bg}
            color={meta.color}
            icon={meta.icon}
            iconSize={18}
            style={styles.statusPill}
            textStyle={styles.statusPillText}
          />
          <Text style={styles.statusDescription}>{meta.description}</Text>

          {order.estimated_delivery_time && status !== "order_delivered" && !isCancelled && (
            <View style={styles.etaRow}>
              <MaterialCommunityIcons
                name={isRunningLate ? "clock-alert-outline" : "clock-time-four-outline"}
                size={16}
                color={isRunningLate ? C.warning : C.textSub}
              />
              {isRunningLate ? (
                <Text style={[styles.etaText, styles.etaLate]}>
                  Running a little behind — was expected by{" "}
                  <Text style={[styles.etaTime, styles.etaLate]}>{formatTime(order.estimated_delivery_time)}</Text>
                </Text>
              ) : (
                <Text style={styles.etaText}>
                  Estimated delivery by{" "}
                  <Text style={styles.etaTime}>{formatTime(order.estimated_delivery_time)}</Text>
                </Text>
              )}
            </View>
          )}
        </Card>

        {/* ─── Delivered: prompt to rate the order ─────────────────────────── */}
        {status === "order_delivered" && !isCancelled && (
          <TouchableOpacity
            style={styles.rateCard}
            activeOpacity={0.8}
            onPress={() => router.push(`/order/rate/${id}` as any)}
          >
            <MaterialCommunityIcons name="star-outline" size={22} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rateCardTitle}>Rate your order</Text>
              <Text style={styles.rateCardText}>Let us know how the products you got were.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={C.textLight} />
          </TouchableOpacity>
        )}

        {/* ─── Pending at store: no stores have accepted yet ──────────────────── */}
        {noStoreAcceptedYet && (
          <Card size="lg" style={styles.infoCard}>
            <MaterialCommunityIcons name="storefront-outline" size={22} color={C.textSub} />
            <Text style={styles.infoCardText}>
              {getStatusMeta("pending_at_store").description || "Waiting for the store to confirm your order."}
            </Text>
          </Card>
        )}

        {/* ─── Map ──────────────────────────────────────────────────────────── */}
        {!noStoreAcceptedYet && !isCancelled && status !== "order_delivered" && mapRegion && !isMultiStore ? (
          <Card size="lg" padded={false} bg={C.bgSoft} style={styles.mapWrap}>
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={mapRegion}
              showsUserLocation={false}
              showsMyLocationButton={false}
              toolbarEnabled={false}
              loadingEnabled
              loadingIndicatorColor={C.primary}
            >
              {dest && (
                <Marker
                  coordinate={dest}
                  title="Delivery address"
                  description={order.delivery_address}
                  anchor={{ x: 0.5, y: 1 }}
                >
                  <View style={styles.markerHome}>
                    <MaterialCommunityIcons name="home-map-marker" size={20} color="#fff" />
                  </View>
                </Marker>
              )}
              {storeLocation && (
                <Marker
                  coordinate={{ latitude: storeLocation.lat, longitude: storeLocation.lng }}
                  title={storeLocation.label || "Store"}
                  description={storeLocation.address}
                  anchor={{ x: 0.5, y: 1 }}
                >
                  <View style={styles.markerStore}>
                    <MaterialCommunityIcons name="storefront" size={18} color="#fff" />
                  </View>
                </Marker>
              )}
              {primaryDriverLocation && (
                <Marker
                  coordinate={{
                    latitude: primaryDriverLocation.latitude,
                    longitude: primaryDriverLocation.longitude,
                  }}
                  title={primaryAgent?.name || "Delivery partner"}
                  description={
                    primaryDriverLocation.updated_at
                      ? `Updated ${formatTime(primaryDriverLocation.updated_at)}`
                      : undefined
                  }
                  anchor={{ x: 0.5, y: 0.5 }}
                  flat
                >
                  <View style={styles.markerDriver}>
                    <MaterialCommunityIcons name="bike-fast" size={18} color="#fff" />
                  </View>
                </Marker>
              )}

              {primaryDriverLocation && dest && (
                <Polyline
                  coordinates={[
                    {
                      latitude: primaryDriverLocation.latitude,
                      longitude: primaryDriverLocation.longitude,
                    },
                    dest,
                  ]}
                  strokeColor={C.primary}
                  strokeWidth={3}
                  lineDashPattern={[6, 4]}
                />
              )}
              {!primaryDriverLocation && storeLocation && dest && (
                <Polyline
                  coordinates={[
                    { latitude: storeLocation.lat, longitude: storeLocation.lng },
                    dest,
                  ]}
                  strokeColor={C.textLight}
                  strokeWidth={2}
                  lineDashPattern={[4, 6]}
                />
              )}
            </MapView>

            {!primaryDriverLocation && (
              <View style={styles.mapHint}>
                <MaterialCommunityIcons name="information-outline" size={14} color={C.textSub} />
                <Text style={styles.mapHintText}>
                  Live driver location will appear once a rider is assigned.
                </Text>
              </View>
            )}
          </Card>
        ) : !noStoreAcceptedYet && isMultiStore ? (
          <View style={styles.storeOrderList}>
            {/* One card per store that has actually accepted — a store still at
                'pending_at_store' is excluded from acceptedStoreOrders entirely
                (no placeholder box), so cards appear one by one as each store
                responds, matching the single-store map behavior above. */}
            {acceptedStoreOrders.map((so: any) => {
              const loc = data?.storeLocations?.find((s) => s.store_id === so.store_id);
              const storeMeta = getStatusMeta(so.status);
              const items = so.order_items || [];
              const expanded = expandedStoreOrderIds.has(so.id);
              return (
                <Card key={so.id} size="lg" style={styles.storeOrderCard}>
                  <View style={styles.storeOrderHeader}>
                    <MaterialCommunityIcons name="storefront" size={20} color={C.primary} />
                    <View style={styles.flex1}>
                      <Text style={styles.storeOrderName} numberOfLines={1}>{loc?.label || "Store"}</Text>
                      {loc?.address && (
                        <Text style={styles.storeOrderAddress} numberOfLines={2}>{loc.address}</Text>
                      )}
                    </View>
                    {loc?.phone && (
                      <IconButton
                        icon="phone"
                        size={34}
                        iconSize={18}
                        bg={C.primaryXLight}
                        color={C.primary}
                        hitSlop={6}
                        accessibilityLabel="Call store"
                        style={styles.smallIconBtn}
                        onPress={() => Linking.openURL(`tel:${loc.phone}`)}
                      />
                    )}
                  </View>

                  <Badge
                    label={storeMeta.label}
                    bg={storeMeta.bg}
                    color={storeMeta.color}
                    icon={storeMeta.icon}
                    iconSize={14}
                    style={[styles.statusPill, styles.storePill]}
                    textStyle={[styles.statusPillText, styles.storePillText]}
                  />

                  {items.length > 0 && (
                    <>
                      <Pressable
                        style={({ pressed }) => [
                          styles.sectionToggle,
                          pressed && Platform.OS === "ios" && styles.sectionTogglePressed,
                        ]}
                        onPress={() => {
                          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                          toggleStoreItems(so.id);
                        }}
                        android_ripple={{ color: C.bgSoft }}
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                      >
                        <Text style={styles.sectionTitle}>
                          Items from this store <Text style={styles.sectionCount}>({items.length})</Text>
                        </Text>
                        <MaterialCommunityIcons
                          name={expanded ? "chevron-up" : "chevron-down"}
                          size={20}
                          color={C.textSub}
                        />
                      </Pressable>
                      {expanded && (
                        <View>
                          {items.map((it: any, idx: number) => (
                            <View
                              key={`${it.product_name}-${idx}`}
                              style={[styles.itemRow, idx < items.length - 1 && styles.itemRowBorder]}
                            >
                              <View style={styles.flex1}>
                                <Text style={styles.itemName} numberOfLines={2}>{it.product_name}</Text>
                                <Text style={styles.itemUnit}>
                                  ₹{Number(it.unit_price).toFixed(2)} {it.unit ? `/ ${it.unit}` : ""}
                                </Text>
                              </View>
                              <View style={styles.itemRight}>
                                <Text style={styles.itemQty}>×{it.quantity}</Text>
                                <Text style={styles.itemTotal}>
                                  ₹{Math.round(Number(it.unit_price) * Number(it.quantity))}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </>
                  )}
                </Card>
              );
            })}
          </View>
        ) : null}

        {/* ─── Delivery partner ─────────────────────────────────────────────── */}
        {primaryAgent && status !== "order_delivered" && !isCancelled && (
          <Card size="lg" style={styles.partnerCard}>
            <IconWrap size={46} circle icon="account" iconSize={26} />
            <View style={styles.flex1}>
              <Text style={styles.partnerLabel}>Your delivery partner</Text>
              <Text style={styles.partnerName} numberOfLines={1}>{primaryAgent.name}</Text>
              {primaryAgent.vehicle_number && (
                <View style={styles.partnerVehicleRow}>
                  <MaterialCommunityIcons name="bike" size={12} color={C.textSub} />
                  <Text style={styles.partnerVehicle}>{primaryAgent.vehicle_number}</Text>
                </View>
              )}
            </View>
            {primaryAgent.phone && (
              <PrimaryButton
                size="xs"
                icon="phone"
                iconSize={16}
                label="Call"
                accessibilityLabel="Call delivery partner"
                onPress={() => Linking.openURL(`tel:${primaryAgent.phone}`)}
                style={styles.callBtn}
                textStyle={styles.callBtnText}
              />
            )}
          </Card>
        )}

        {/* ─── Delivery OTP Card ────────────────────────────────────────────── */}
        {deliveryOTP && shouldShowOTP(status) && !isCancelled && (
          <Card size="lg" borderColor={C.primary} style={styles.otpCard}>
            <View style={styles.otpHeader}>
              <IconWrap size={44} icon="shield-key" iconSize={24} />
              <View style={styles.flex1}>
                <Text style={styles.otpTitle}>Delivery Verification PIN</Text>
                <Text style={styles.otpSub}>
                  Share this PIN with your delivery partner to confirm delivery
                </Text>
              </View>
            </View>
            <View style={styles.otpDisplay}>
              {deliveryOTP.split('').map((digit: string, idx: number) => (
                <View key={idx} style={styles.otpDigit}>
                  <Text style={styles.otpDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <View style={styles.otpWarning}>
              <MaterialCommunityIcons name="information-outline" size={14} color={C.warning} />
              <Text style={styles.otpWarningText}>
                Do not share this PIN until you receive your order
              </Text>
            </View>
          </Card>
        )}

        {/* ─── Delivered card ──────────────────────────────────────────────── */}
        {status === "order_delivered" && (
          <Card size="lg" bg={C.successLight} borderColor="#86efac" style={styles.deliveredCard}>
            <View style={styles.deliveredIconWrap}>
              <MaterialCommunityIcons name="check-circle" size={36} color={C.success} />
            </View>
            <Text style={styles.deliveredTitle}>Order delivered</Text>
            {(() => {
              const ev = visibleHistory.find((h) => h.status === "order_delivered");
              return ev ? (
                <Text style={styles.deliveredSub}>{formatDateTime(ev.created_at)}</Text>
              ) : null;
            })()}
            {primaryAgent && (
              <Text style={styles.deliveredSub}>Delivered by {primaryAgent.name}</Text>
            )}
          </Card>
        )}

        {/* ─── Cancelled banner ────────────────────────────────────────────── */}
        {isCancelled && (
          <Card size="lg" bg={C.dangerLight} borderColor="#fca5a5" style={styles.cancelledBanner}>
            <MaterialCommunityIcons name="close-circle" size={24} color={C.danger} />
            <View style={styles.flex1}>
              <Text style={styles.cancelledTitle}>Order cancelled</Text>
              <Text style={styles.cancelledSub}>This order was not fulfilled.</Text>
            </View>
          </Card>
        )}

        {/* ─── Address ──────────────────────────────────────────────────────── */}
        <Card size="lg" style={styles.addressCard}>
          {storeLocation && (
            <View style={styles.addressRow}>
              <MaterialCommunityIcons name="storefront-outline" size={18} color={C.primary} />
              <View style={styles.flex1}>
                <Text style={styles.addressLabel}>Picked up from</Text>
                <Text style={styles.addressValue} numberOfLines={1}>{storeLocation.label || "Store"}</Text>
                {storeLocation.address && (
                  <Text style={styles.addressSecondary} numberOfLines={2}>{storeLocation.address}</Text>
                )}
              </View>
              {storeLocation.phone && (
                <IconButton
                  icon="phone-outline"
                  size={34}
                  iconSize={18}
                  bg={C.primaryXLight}
                  color={C.primary}
                  hitSlop={6}
                  accessibilityLabel="Call store"
                  style={styles.smallIconBtn}
                  onPress={() => Linking.openURL(`tel:${storeLocation.phone}`)}
                />
              )}
            </View>
          )}
          <Divider />
          <View style={styles.addressRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={18} color={C.primary} />
            <View style={styles.flex1}>
              <Text style={styles.addressLabel}>Delivering to</Text>
              <Text style={styles.addressValue} numberOfLines={3}>
                {order.delivery_address || "—"}
              </Text>
            </View>
          </View>
          {order.receiver_name && (
            <>
              <Divider />
              <View style={styles.addressRow}>
                <MaterialCommunityIcons name="account-outline" size={18} color={C.primary} />
                <View style={styles.flex1}>
                  <Text style={styles.addressLabel}>Ordered for</Text>
                  <Text style={styles.addressValue} numberOfLines={2}>
                    {order.receiver_name}
                    {order.receiver_phone ? ` · ${order.receiver_phone}` : ""}
                  </Text>
                </View>
              </View>
            </>
          )}
        </Card>

        {/* ─── Timeline (collapsible) ──────────────────────────────────────── */}
        <Card size="lg" padded={false} style={styles.section}>
          <Pressable
            style={({ pressed }) => [
              styles.sectionToggle,
              pressed && Platform.OS === "ios" && styles.sectionTogglePressed,
            ]}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setShowHistory((v) => !v);
            }}
            android_ripple={{ color: C.bgSoft }}
            accessibilityRole="button"
            accessibilityState={{ expanded: showHistory }}
          >
            <Text style={styles.sectionTitle}>Order timeline</Text>
            <MaterialCommunityIcons
              name={showHistory ? "chevron-up" : "chevron-down"}
              size={20}
              color={C.textSub}
            />
          </Pressable>

          {showHistory && (
            <View style={styles.timeline}>
              {visibleHistory.map((event, idx) => {
                const eventMeta = getStatusMeta(event.status);
                const isLast = idx === visibleHistory.length - 1;
                return (
                  <View key={`${event.status}-${idx}`} style={styles.timelineRow}>
                    <View style={styles.timelineLeft}>
                      <View style={[styles.timelineDot, { backgroundColor: eventMeta.color }]}>
                        <MaterialCommunityIcons name={eventMeta.icon} size={14} color="#fff" />
                      </View>
                      {!isLast && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineLabel}>
                        {formatStatusLabel(event.status)}
                      </Text>
                      <Text style={styles.timelineDesc}>{eventMeta.description}</Text>
                      {event.created_at && (
                        <Text style={styles.timelineTime}>
                          {formatDateTime(event.created_at)}
                        </Text>
                      )}
                      {'notes' in event && event.notes && <Text style={styles.timelineNotes}>{event.notes}</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* ─── Items (collapsible) ─────────────────────────────────────────── */}
        <Card size="lg" padded={false} style={styles.section}>
          <Pressable
            style={({ pressed }) => [
              styles.sectionToggle,
              pressed && Platform.OS === "ios" && styles.sectionTogglePressed,
            ]}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setShowItems((v) => !v);
            }}
            android_ripple={{ color: C.bgSoft }}
            accessibilityRole="button"
            accessibilityState={{ expanded: showItems }}
          >
            <Text style={styles.sectionTitle}>
              Order items{" "}
              <Text style={styles.sectionCount}>
                ({storeOrders.reduce((acc, so) => acc + (so.order_items?.length || 0), 0)})
              </Text>
            </Text>
            <MaterialCommunityIcons
              name={showItems ? "chevron-up" : "chevron-down"}
              size={20}
              color={C.textSub}
            />
          </Pressable>

          {showItems && (
            <View style={styles.itemsCard}>
              {storeOrders.flatMap((so) => so.order_items || []).length === 0 && (
                <Text style={styles.itemsEmpty}>No items to show</Text>
              )}
              {storeOrders
                .flatMap((so) => so.order_items || [])
                .map((it, idx, arr) => (
                  <View
                    key={`${it.product_name}-${idx}`}
                    style={[styles.itemRow, idx < arr.length - 1 && styles.itemRowBorder]}
                  >
                    <View style={styles.flex1}>
                      <Text style={styles.itemName} numberOfLines={2}>{it.product_name}</Text>
                      <Text style={styles.itemUnit}>
                        ₹{Number(it.unit_price).toFixed(2)} {it.unit ? `/ ${it.unit}` : ""}
                      </Text>
                    </View>
                    <View style={styles.itemRight}>
                      <Text style={styles.itemQty}>×{it.quantity}</Text>
                      <Text style={styles.itemTotal}>
                        ₹{Math.round(Number(it.unit_price) * Number(it.quantity))}
                      </Text>
                    </View>
                  </View>
                ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>₹{Math.round(order.total_amount || 0)}</Text>
              </View>
            </View>
          )}
        </Card>

        {/* ─── Help footer ─────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.helpRow}
          activeOpacity={0.85}
          accessibilityRole="button"
          onPress={() => router.push("/settings/support")}
        >
          <MaterialCommunityIcons name="headset" size={20} color={C.primary} />
          <View style={styles.flex1}>
            <Text style={styles.helpTitle}>Need help with this order?</Text>
            <Text style={styles.helpSub}>Get in touch with our support team</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={C.textSub} />
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

function Header({ title, autoRefreshing }: { title: string; autoRefreshing?: boolean }) {
  return (
    <ScreenHeader
      title={title}
      onBack={() => router.back()}
      titleStyle={styles.headerTitle}
      right={
        <View style={styles.headerSlot}>
          {autoRefreshing ? <ActivityIndicator size="small" color={C.primary} /> : null}
        </View>
      }
    />
  );
}

/** Loading placeholder mirroring the status card → map → address card stack. */
function TrackSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading live tracking">
      <Card size="lg" style={styles.statusCard}>
        <View style={styles.skeletonLiveRow}>
          <Skeleton width={12} height={12} radius={6} />
          <Skeleton width={80} height={12} />
        </View>
        <Skeleton width={140} height={32} radius={12} />
        <Skeleton height={12} style={styles.skeletonGapLg} />
        <Skeleton width="70%" height={12} style={styles.skeletonGap} />
      </Card>
      <Skeleton height={280} radius={16} style={styles.skeletonMap} />
      <Card size="lg" style={styles.addressCard}>
        <View style={styles.addressRow}>
          <Skeleton width={18} height={18} radius={9} />
          <View style={styles.flex1}>
            <Skeleton width={90} height={10} />
            <Skeleton width="60%" height={12} style={styles.skeletonGap} />
          </View>
        </View>
        <Divider />
        <View style={styles.addressRow}>
          <Skeleton width={18} height={18} radius={9} />
          <View style={styles.flex1}>
            <Skeleton width={90} height={10} />
            <Skeleton height={12} style={styles.skeletonGap} />
            <Skeleton width="80%" height={12} style={styles.skeletonGap} />
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },

  headerTitle: { marginHorizontal: 12 },
  headerSlot: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },

  scrollContent: { paddingBottom: layout.scrollBottom },

  // Skeleton
  skeletonLiveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  skeletonGap: { marginTop: 8 },
  skeletonGapLg: { marginTop: 12 },
  skeletonMap: { marginHorizontal: 16 },

  // Status card
  statusCard: {
    margin: 16,
    marginBottom: 12,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  livePulseWrap: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  livePulse: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.success,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  liveDotStale: { backgroundColor: C.warning },
  liveText: { color: C.success, fontSize: 12, fontFamily: "PlusJakartaSans_800ExtraBold", letterSpacing: 0.3 },
  liveTextStale: { color: C.warning },
  multiStoreBadge: { marginLeft: "auto", alignSelf: "center", paddingVertical: 4 },
  multiStoreBadgeText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 11 },

  statusPill: {
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statusPillText: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 14 },
  storePill: { marginTop: 12 },
  storePillText: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 12 },
  statusDescription: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 14, lineHeight: 20, marginTop: 10 },

  etaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  etaText: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textSub, fontSize: 13 },
  etaTime: { color: C.text },
  etaLate: { color: C.warning },

  // Map
  mapWrap: { marginHorizontal: 16 },
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
  mapHintText: { fontFamily: "PlusJakartaSans_400Regular", flex: 1, color: C.textSub, fontSize: 12, lineHeight: 16 },

  markerHome: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: C.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  markerStore: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.warning,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
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
    borderColor: "#fff",
    shadowColor: C.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },

  // Multi-store / map-unavailable info
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 16,
    padding: 14,
  },
  infoCardText: { fontFamily: "PlusJakartaSans_400Regular", flex: 1, color: C.textSub, fontSize: 13, lineHeight: 19 },

  rateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: C.primaryXLight,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  rateCardTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  rateCardText: { color: C.textSub, fontSize: 12, marginTop: 2 },

  // Per-store card (multi-store tracking)
  storeOrderList: { marginHorizontal: 16, gap: 12 },
  storeOrderCard: { padding: 14 },
  storeOrderHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  storeOrderName: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 15 },
  storeOrderAddress: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 12, marginTop: 2 },
  smallIconBtn: { borderRadius: 10 },

  // Delivery partner
  partnerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginTop: 12,
    padding: 14,
  },
  partnerLabel: { ...typo.eyebrow },
  partnerName: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 15, marginTop: 2 },
  partnerVehicleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  partnerVehicle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textSub, fontSize: 12 },
  callBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    shadowOpacity: 0.25,
  },
  callBtnText: { fontFamily: "PlusJakartaSans_800ExtraBold" },

  // Delivered
  deliveredCard: {
    margin: 16,
    marginTop: 12,
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  deliveredIconWrap: { marginBottom: 4 },
  deliveredTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: "#065f46", fontSize: 18 },
  deliveredSub: { fontFamily: "PlusJakartaSans_800ExtraBold", color: "#065f46", fontSize: 13, opacity: 0.85 },

  // Cancelled
  cancelledBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginTop: 12,
  },
  cancelledTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.danger, fontSize: 15 },
  cancelledSub: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.danger, fontSize: 13, opacity: 0.8, marginTop: 2 },

  // Address
  addressCard: {
    margin: 16,
    marginTop: 12,
    padding: 14,
  },
  addressRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  addressLabel: { ...typo.eyebrow },
  addressValue: { fontFamily: "PlusJakartaSans_700Bold", color: C.text, fontSize: 14, marginTop: 2 },
  addressSecondary: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 12, marginTop: 2, lineHeight: 17 },

  // Sections
  section: {
    marginHorizontal: 16,
    marginTop: 12,
    overflow: clipOverflow,
  },
  sectionToggle: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  sectionTogglePressed: { backgroundColor: C.bgSoft },
  sectionTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", flex: 1, color: C.text, fontSize: 15 },
  sectionCount: { color: C.textSub },

  // Timeline
  timeline: { paddingHorizontal: 16, paddingBottom: 4 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { width: 28, alignItems: "center" },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineLine: { flex: 1, width: 2, backgroundColor: C.border, marginVertical: 2, minHeight: 24 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineLabel: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 14 },
  timelineDesc: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 12, marginTop: 2, lineHeight: 16 },
  timelineTime: { fontFamily: "PlusJakartaSans_300Light", color: C.textLight, fontSize: 11, marginTop: 4 },
  timelineNotes: { fontFamily: "PlusJakartaSans_400Regular",
    color: C.textSub,
    fontSize: 12,
    marginTop: 4,
    fontStyle: "italic",
  },

  // Items
  itemsCard: { paddingHorizontal: 16, paddingBottom: 14 },
  itemsEmpty: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 13, textAlign: "center", paddingVertical: 16 },
  itemRow: { flexDirection: "row", paddingVertical: 12, gap: 10, alignItems: "flex-start" },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemName: { fontFamily: "PlusJakartaSans_700Bold", color: C.text, fontSize: 14 },
  itemUnit: { fontFamily: "PlusJakartaSans_700Bold", color: C.textSub, fontSize: 12, marginTop: 2 },
  itemRight: { alignItems: "flex-end" },
  itemQty: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.textSub, fontSize: 12 },
  itemTotal: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 14, marginTop: 2, fontVariant: ["tabular-nums"] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  totalLabel: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 14 },
  totalValue: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.primary, fontSize: 16, fontVariant: ["tabular-nums"] },

  // Help
  helpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: C.primaryXLight,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  helpTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text, fontSize: 14 },
  helpSub: { fontFamily: "PlusJakartaSans_400Regular", color: C.textSub, fontSize: 12, marginTop: 2 },

  // OTP Card
  otpCard: {
    margin: 16,
    marginTop: 12,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  otpHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  otpTitle: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.text,
    fontSize: 15,
  },
  otpSub: { fontFamily: "PlusJakartaSans_400Regular",
    color: C.textSub,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  otpDisplay: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 20,
    marginBottom: 16,
  },
  otpDigit: {
    width: 52,
    height: 64,
    borderRadius: 12,
    backgroundColor: C.primaryXLight,
    borderWidth: 2,
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  otpDigitText: { fontFamily: "PlusJakartaSans_800ExtraBold",
    color: C.primary,
    fontSize: 28,
    fontVariant: ["tabular-nums"],
  },
  otpWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  otpWarningText: { fontFamily: "PlusJakartaSans_600SemiBold",
    flex: 1,
    color: C.warning,
    fontSize: 12,
  },
});
