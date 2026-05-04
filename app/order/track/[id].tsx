import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
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
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "../../../constants/colors";
import {
    CANCELLED_STATUSES,
    ORDER_TIMELINE,
    type OrderStatus,
    getStatusMeta,
    getTimelineIndex,
} from "../../../constants/orderStatus";
import { useOrderTracking } from "../../../hooks/useOrderTracking";
import { shouldShowOTP } from "../../../lib/orderService";

const ADD_MORE_WINDOW_SECONDS = 40;

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
  const [refreshing, setRefreshing] = useState(false);
  const order = data?.order;
  const status = (order?.status ?? "pending_at_store") as OrderStatus;

  // ─── Add-more window timer ────────────────────────────────────────────────
  const [addMoreSecsLeft, setAddMoreSecsLeft] = useState<number>(ADD_MORE_WINDOW_SECONDS);
  const addMoreProgress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!order?.placed_at) return;
    const placed = new Date(order.placed_at).getTime();
    const elapsed = Math.floor((Date.now() - placed) / 1000);
    const initial = Math.max(0, ADD_MORE_WINDOW_SECONDS - elapsed);
    setAddMoreSecsLeft(initial);
    if (initial <= 0) return;

    const interval = setInterval(() => {
      setAddMoreSecsLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0) clearInterval(interval);
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [order?.placed_at]);

  useEffect(() => {
    Animated.timing(addMoreProgress, {
      toValue: addMoreSecsLeft / ADD_MORE_WINDOW_SECONDS,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [addMoreSecsLeft]);

  const showAddMoreWindow =
    addMoreSecsLeft > 0 && status === "pending_at_store";

  // ─── Delivery OTP — stored on the order, shown to customer at handoff ───
  const deliveryOTP = useMemo(() => {
    if (!shouldShowOTP(status)) return null;
    return (order as any)?.delivery_otp ?? null;
  }, [status, order]);

  const storeOrders = order?.store_orders ?? [];
  const isMultiStore = storeOrders.length > 1;
  const meta = getStatusMeta(status);
  const isCancelled = CANCELLED_STATUSES.includes(status);

  // Pick the agent for the (single) store order. For multi-store we'd render a card per store.
  const primaryStoreOrder = storeOrders[0];
  const primaryAgent = useMemo(() => {
    if (!primaryStoreOrder?.delivery_partner_id) return data?.deliveryAgent;
    return data?.deliveryAgents?.[primaryStoreOrder.delivery_partner_id] ?? data?.deliveryAgent;
  }, [primaryStoreOrder, data]);

  const primaryDriverLocation = useMemo(() => {
    if (!primaryStoreOrder?.delivery_partner_id) return undefined;
    return driverLocations[primaryStoreOrder.delivery_partner_id];
  }, [primaryStoreOrder, driverLocations]);

  const storeLocation = data?.storeLocations?.[0];
  const dest =
    order?.delivery_latitude != null && order?.delivery_longitude != null
      ? { latitude: Number(order.delivery_latitude), longitude: Number(order.delivery_longitude) }
      : undefined;

  // Center the map so destination + store + driver are all in frame.
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
  }, [dest, storeLocation, primaryDriverLocation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header title="Live Tracking" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.muted}>Loading live tracking…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !order) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header title="Live Tracking" />
        <View style={styles.center}>
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color={C.textLight} />
          <Text style={styles.errorTitle}>Tracking unavailable</Text>
          <Text style={styles.muted}>{error ?? "We couldn't find this order."}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onRefresh}>
            <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
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
    <SafeAreaView style={styles.safe}>
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
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* ─── Live status pill + ETA ───────────────────────────────────────── */}
        <View style={styles.statusCard}>
          <View style={styles.liveRow}>
            {!isCancelled && status !== "order_delivered" && (
              <>
                <View style={styles.livePulseWrap}>
                  <View style={styles.livePulse} />
                  <View style={styles.liveDot} />
                </View>
                <Text style={styles.liveText}>Live tracking</Text>
              </>
            )}
            {isMultiStore && (
              <Text style={styles.multiStoreBadge}>{storeOrders.length} stores</Text>
            )}
          </View>

          <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
            <MaterialCommunityIcons name={meta.icon} size={18} color={meta.color} />
            <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <Text style={styles.statusDescription}>{meta.description}</Text>

          {order.estimated_delivery_time && status !== "order_delivered" && !isCancelled && (
            <View style={styles.etaRow}>
              <MaterialCommunityIcons name="clock-time-four-outline" size={16} color={C.textSub} />
              <Text style={styles.etaText}>
                Estimated delivery by{" "}
                <Text style={styles.etaTime}>{formatTime(order.estimated_delivery_time)}</Text>
              </Text>
            </View>
          )}
        </View>

        {/* ─── Add-more window ─────────────────────────────────────────────── */}
        {showAddMoreWindow && (
          <View style={styles.addMoreBox}>
            <View style={styles.addMoreTop}>
              <View style={styles.addMoreIconWrap}>
                <MaterialCommunityIcons name="cart-plus" size={22} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.addMoreTitle}>Want to add something?</Text>
                <Text style={styles.addMoreSub}>
                  You have{" "}
                  <Text style={styles.addMoreCount}>{addMoreSecsLeft}s</Text> to add more items
                  before the store starts preparing your order.
                </Text>
              </View>
            </View>

            <View style={styles.addMoreBarTrack}>
              <Animated.View
                style={[
                  styles.addMoreBarFill,
                  { width: addMoreProgress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
                ]}
              />
            </View>

            <TouchableOpacity
              style={styles.addMoreBtn}
              activeOpacity={0.85}
              onPress={() => router.push("/" as any)}
            >
              <MaterialCommunityIcons name="plus" size={16} color="#fff" />
              <Text style={styles.addMoreBtnText}>Add more items</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── Map ──────────────────────────────────────────────────────────── */}
        {!isCancelled && status !== "order_delivered" && mapRegion && !isMultiStore ? (
          <View style={styles.mapWrap}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={mapRegion}
              region={mapRegion}
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
          </View>
        ) : isMultiStore ? (
          <View style={styles.infoCard}>
            <MaterialCommunityIcons name="store-outline" size={22} color={C.textSub} />
            <Text style={styles.infoCardText}>
              This is a multi-store order. Each store is being tracked separately — see the timeline
              below for status updates.
            </Text>
          </View>
        ) : null}

        {/* ─── Delivery partner ─────────────────────────────────────────────── */}
        {primaryAgent && status !== "order_delivered" && !isCancelled && (
          <View style={styles.partnerCard}>
            <View style={styles.partnerAvatar}>
              <MaterialCommunityIcons name="account" size={26} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.partnerLabel}>Your delivery partner</Text>
              <Text style={styles.partnerName}>{primaryAgent.name}</Text>
              {primaryAgent.vehicle_number && (
                <Text style={styles.partnerVehicle}>
                  <MaterialCommunityIcons name="bike" size={12} color={C.textSub} />{" "}
                  {primaryAgent.vehicle_number}
                </Text>
              )}
            </View>
            {primaryAgent.phone && (
              <TouchableOpacity
                style={styles.callBtn}
                activeOpacity={0.85}
                onPress={() => Linking.openURL(`tel:${primaryAgent.phone}`)}
              >
                <MaterialCommunityIcons name="phone" size={16} color="#fff" />
                <Text style={styles.callBtnText}>Call</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ─── Delivery OTP Card ────────────────────────────────────────────── */}
        {deliveryOTP && shouldShowOTP(status) && !isCancelled && (
          <View style={styles.otpCard}>
            <View style={styles.otpHeader}>
              <View style={styles.otpIconWrap}>
                <MaterialCommunityIcons name="shield-key" size={24} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.otpTitle}>Delivery Verification PIN</Text>
                <Text style={styles.otpSub}>
                  Share this PIN with your delivery partner to confirm delivery
                </Text>
              </View>
            </View>
            <View style={styles.otpDisplay}>
              {deliveryOTP.split('').map((digit, idx) => (
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
          </View>
        )}

        {/* ─── Delivered card ──────────────────────────────────────────────── */}
        {status === "order_delivered" && (
          <View style={styles.deliveredCard}>
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
          </View>
        )}

        {/* ─── Cancelled banner ────────────────────────────────────────────── */}
        {isCancelled && (
          <View style={styles.cancelledBanner}>
            <MaterialCommunityIcons name="close-circle" size={26} color={C.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cancelledTitle}>Order cancelled</Text>
              <Text style={styles.cancelledSub}>This order was not fulfilled.</Text>
            </View>
          </View>
        )}

        {/* ─── Address ──────────────────────────────────────────────────────── */}
        <View style={styles.addressCard}>
          {storeLocation && (
            <View style={styles.addressRow}>
              <MaterialCommunityIcons name="storefront-outline" size={18} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.addressLabel}>Picked up from</Text>
                <Text style={styles.addressValue}>{storeLocation.label || "Store"}</Text>
                {storeLocation.address && (
                  <Text style={styles.addressSecondary}>{storeLocation.address}</Text>
                )}
              </View>
              {storeLocation.phone && (
                <Pressable
                  hitSlop={8}
                  onPress={() => Linking.openURL(`tel:${storeLocation.phone}`)}
                >
                  <MaterialCommunityIcons name="phone-outline" size={18} color={C.primary} />
                </Pressable>
              )}
            </View>
          )}
          <View style={styles.addressDivider} />
          <View style={styles.addressRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={18} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressLabel}>Delivering to</Text>
              <Text style={styles.addressValue} numberOfLines={3}>
                {order.delivery_address || "—"}
              </Text>
            </View>
          </View>
        </View>

        {/* ─── Timeline (collapsible) ──────────────────────────────────────── */}
        <View style={styles.section}>
          <Pressable
            style={styles.sectionToggle}
            onPress={() => setShowHistory((v) => !v)}
            android_ripple={{ color: C.bgSoft }}
          >
            <Text style={styles.sectionTitle}>Order timeline</Text>
            <MaterialCommunityIcons
              name={showHistory ? "chevron-up" : "chevron-down"}
              size={22}
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
                    <View style={{ flex: 1, paddingBottom: 16 }}>
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
        </View>

        {/* ─── Items (collapsible) ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Pressable
            style={styles.sectionToggle}
            onPress={() => setShowItems((v) => !v)}
            android_ripple={{ color: C.bgSoft }}
          >
            <Text style={styles.sectionTitle}>
              Order items{" "}
              <Text style={styles.sectionCount}>
                ({storeOrders.reduce((acc, so) => acc + (so.order_items?.length || 0), 0)})
              </Text>
            </Text>
            <MaterialCommunityIcons
              name={showItems ? "chevron-up" : "chevron-down"}
              size={22}
              color={C.textSub}
            />
          </Pressable>

          {showItems && (
            <View style={styles.itemsCard}>
              {storeOrders
                .flatMap((so) => so.order_items || [])
                .map((it, idx, arr) => (
                  <View
                    key={`${it.product_name}-${idx}`}
                    style={[styles.itemRow, idx < arr.length - 1 && styles.itemRowBorder]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{it.product_name}</Text>
                      <Text style={styles.itemUnit}>
                        ₹{Number(it.unit_price).toFixed(2)} {it.unit ? `/ ${it.unit}` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
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
        </View>

        {/* ─── Help footer ─────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.helpRow}
          activeOpacity={0.85}
          onPress={() => router.push("/support/help" as any)}
        >
          <MaterialCommunityIcons name="headset" size={20} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.helpTitle}>Need help with this order?</Text>
            <Text style={styles.helpSub}>Get in touch with our support team</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={C.textSub} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, autoRefreshing }: { title: string; autoRefreshing?: boolean }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <MaterialCommunityIcons name="arrow-left" size={20} color={C.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSlot}>
        {autoRefreshing ? <ActivityIndicator size="small" color={C.primary} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, color: C.text, fontSize: 17, fontWeight: "800", marginHorizontal: 12 },
  headerSlot: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  muted: { color: C.textSub, fontSize: 13.5, textAlign: "center" },
  errorTitle: { color: C.text, fontSize: 17, fontWeight: "800", marginTop: 8 },

  // Status card
  statusCard: {
    backgroundColor: C.card,
    margin: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
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
    opacity: 0.35,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  liveText: { color: C.success, fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  multiStoreBadge: {
    marginLeft: "auto",
    color: C.textSub,
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: C.bgSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statusPillText: { fontSize: 14, fontWeight: "800" },
  statusDescription: { color: C.textSub, fontSize: 13.5, lineHeight: 19, marginTop: 10 },

  etaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  etaText: { color: C.textSub, fontSize: 13 },
  etaTime: { color: C.text, fontWeight: "800" },

  // Map
  mapWrap: {
    marginHorizontal: 16,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: C.bgSoft,
    borderWidth: 1,
    borderColor: C.border,
  },
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
  mapHintText: { color: C.textSub, fontSize: 12 },

  markerHome: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
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
    shadowColor: "#000",
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
    shadowColor: "#000",
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
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  infoCardText: { flex: 1, color: C.textSub, fontSize: 13, lineHeight: 19 },

  // Delivery partner
  partnerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  partnerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  partnerLabel: { color: C.textSub, fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  partnerName: { color: C.text, fontSize: 15, fontWeight: "800", marginTop: 2 },
  partnerVehicle: { color: C.textSub, fontSize: 12, marginTop: 2 },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    shadowColor: C.primary,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  callBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  // Delivered
  deliveredCard: {
    margin: 16,
    marginTop: 12,
    backgroundColor: C.successLight,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#86efac",
    padding: 22,
    alignItems: "center",
    gap: 6,
  },
  deliveredIconWrap: { marginBottom: 4 },
  deliveredTitle: { color: "#065f46", fontSize: 18, fontWeight: "900" },
  deliveredSub: { color: "#065f46", fontSize: 13, opacity: 0.85 },

  // Cancelled
  cancelledBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: C.dangerLight,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  cancelledTitle: { color: C.danger, fontSize: 15, fontWeight: "800" },
  cancelledSub: { color: C.danger, fontSize: 12, opacity: 0.8, marginTop: 2 },

  // Address
  addressCard: {
    margin: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  addressRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  addressDivider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  addressLabel: { color: C.textSub, fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  addressValue: { color: C.text, fontSize: 14, fontWeight: "700", marginTop: 2 },
  addressSecondary: { color: C.textSub, fontSize: 12, marginTop: 2, lineHeight: 17 },

  // Sections
  section: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: Platform.OS === "android" ? "hidden" : "visible",
  },
  sectionToggle: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  sectionTitle: { flex: 1, color: C.text, fontSize: 15, fontWeight: "800" },
  sectionCount: { color: C.textSub, fontWeight: "600" },

  // Timeline
  timeline: { paddingHorizontal: 16, paddingBottom: 8 },
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
  timelineLabel: { color: C.text, fontSize: 14, fontWeight: "800" },
  timelineDesc: { color: C.textSub, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  timelineTime: { color: C.textLight, fontSize: 11, marginTop: 4 },
  timelineNotes: {
    color: C.textSub,
    fontSize: 12,
    marginTop: 4,
    fontStyle: "italic",
  },

  // Items
  itemsCard: { paddingHorizontal: 16, paddingBottom: 14 },
  itemRow: { flexDirection: "row", paddingVertical: 12, gap: 10, alignItems: "flex-start" },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  itemName: { color: C.text, fontSize: 14, fontWeight: "700" },
  itemUnit: { color: C.textSub, fontSize: 12, marginTop: 2 },
  itemQty: { color: C.textSub, fontSize: 12 },
  itemTotal: { color: C.primary, fontSize: 14, fontWeight: "800", marginTop: 2 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 12,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  totalLabel: { color: C.text, fontSize: 14, fontWeight: "800" },
  totalValue: { color: C.primary, fontSize: 16, fontWeight: "900" },

  // Help
  helpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    margin: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: C.primaryXLight,
    borderWidth: 1,
    borderColor: C.primaryLight,
  },
  helpTitle: { color: C.text, fontSize: 14, fontWeight: "800" },
  helpSub: { color: C.textSub, fontSize: 12, marginTop: 2 },

  // Reusable buttons
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },

  // OTP Card
  otpCard: {
    margin: 16,
    marginTop: 12,
    padding: 18,
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  otpHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  otpIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  otpTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "800",
  },
  otpSub: {
    color: C.textSub,
    fontSize: 12.5,
    marginTop: 4,
    lineHeight: 17,
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
    borderRadius: 14,
    backgroundColor: C.primaryXLight,
    borderWidth: 2,
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  otpDigitText: {
    color: C.primary,
    fontSize: 28,
    fontWeight: "900",
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
  otpWarningText: {
    flex: 1,
    color: C.warning,
    fontSize: 12,
    fontWeight: "600",
  },

  // Add-more window
  addMoreBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    gap: 12,
  },
  addMoreTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  addMoreIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.primaryXLight,
    alignItems: "center",
    justifyContent: "center",
  },
  addMoreTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "800",
  },
  addMoreSub: {
    color: C.textSub,
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },
  addMoreCount: {
    color: C.primary,
    fontWeight: "900",
  },
  addMoreBarTrack: {
    height: 5,
    backgroundColor: C.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  addMoreBarFill: {
    height: 5,
    backgroundColor: C.primary,
    borderRadius: 3,
  },
  addMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.primary,
    paddingVertical: 11,
    borderRadius: 12,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  addMoreBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
});
