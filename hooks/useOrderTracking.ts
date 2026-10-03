// codename: mira
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { TERMINAL_STATUSES } from '../constants/orderStatus';
import { OFFLINE_MESSAGE } from '../lib/apiClient';
import { buildSyntheticTracking } from '../lib/dev/syntheticTracking';
import { getDevFlag, subscribeDevFlags, useDevFlag } from '../lib/devFlags';
import { feedback } from '../lib/feedback';
import { getIsOnline } from '../lib/network';
import { supabase } from '../lib/supabase';
import {
  type DriverLocation,
  type TrackingFullResponse,
  fetchDriverLocations,
  fetchOrderTrackingFull,
} from '../lib/trackingService';
import { useIsOnline } from './useIsOnline';
import { useRefetchOnReconnect } from './useRefetchOnReconnect';

/** Status poll while the rider is moving (`order_picked_up` / `in_transit`). */
const FAST_POLL_MS = 5_000;
/** Status poll while the order waits on the store (pending / preparing / collecting). */
const SLOW_POLL_MS = 10_000;
/** Driver-location poll — only while a rider is assigned and the realtime channel is not confirmed. */
const DRIVER_POLL_MS = 2_000;
/** Every tracking request: a stalled call must never outlive the poll cadence (CONTRACTS §2.4). */
const REQUEST_TIMEOUT_MS = 8_000;
/** How long the realtime "auto refreshing" flag stays on after an event lands. */
const AUTO_REFRESH_FLASH_MS = 600;
const FAST_POLL_STATUSES: readonly string[] = ['order_picked_up', 'in_transit'];

export interface UseOrderTrackingResult {
  data: TrackingFullResponse | null;
  /** `delivery_partner_id` → live coords. Empty until the rider has been assigned. */
  driverLocations: Record<string, DriverLocation>;
  loading: boolean;
  error: string | null;
  /** True briefly when a realtime event lands (used to flash a refresh indicator). */
  autoRefreshing: boolean;
  refresh: () => Promise<void>;
  /** `Date.now()` of the last SUCCESSFUL poll — changes on every poll even when the snapshot did not (LivePill pulses once per update). */
  lastUpdatedAt: number | null;
  /**
   * True while no requests are made because the app is in the background / inactive, or offline (unless
   * `Dev_Cobalt_inhibit_Feature`). Drives the "Signal lost" UI. The polls ALSO sleep while the tracking route is
   * not focused (a pushed support / rate screen), but that is not surfaced here — it is not a lost signal.
   */
  paused: boolean;
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_STATUSES.some((s) => s === status);
}

/**
 * The parts of a snapshot the screen renders from. `refresh()` only calls `setData` when this key changes
 * (design/speed-and-ease #8, MAP P7): a poll that brings nothing new must not re-render the map subtree.
 * `delivery_otp` is included on top of the #8 formula so a PIN that lands without a status change still paints.
 */
export function snapshotKey(next: TrackingFullResponse): string {
  const order = next.order;
  const stores = (order?.store_orders ?? [])
    .map((so) => `${so.id}:${so.status ?? ''}:${so.delivery_partner_id ?? ''}`)
    .join('|');
  return [
    order?.status ?? '',
    order?.payment_status ?? '',
    order?.estimated_delivery_time ?? '',
    stores,
    next.statusHistory?.length ?? 0,
    order?.delivery_otp ?? '',
  ].join('#');
}

/** Same coordinate + timestamp for every id → the previous object is kept (no re-render of the markers). */
function mergeDriverLocations(
  prev: Record<string, DriverLocation>,
  next: Record<string, DriverLocation>,
): Record<string, DriverLocation> {
  let changed = false;
  for (const id of Object.keys(next)) {
    const a = prev[id];
    const b = next[id];
    if (!a || a.latitude !== b.latitude || a.longitude !== b.longitude || a.updated_at !== b.updated_at) {
      changed = true;
      break;
    }
  }
  return changed ? { ...prev, ...next } : prev;
}

function isAppActive(state: AppStateStatus | null | undefined): boolean {
  // 'unknown' (first read on some Android builds) counts as active — we only pause on explicit background/inactive.
  return state !== 'background' && state !== 'inactive';
}

/**
 * Live tracking data for one order (React Native port of the web app's `useOrderTrackingRealtime`, rebuilt 2026-10-03
 * for poll hygiene — design/speed-and-ease #8, MAP §4.2 P7, §7.17):
 *
 *   1. Status snapshot `/api/tracking/orders/:id/full`, polled every 5 s while the rider is moving and 10 s otherwise
 *      (`Dev_Tracking_inhibit_PollMs` overrides), STOPPED once the status is terminal, cleared while the app is in the
 *      background or the route is not focused (a pushed support / rate screen) and restarted (after one immediate
 *      refresh) on resume / refocus, and paused — no requests at all — while offline (`useRefetchOnReconnect` fires
 *      one refresh when the network comes back).
 *   2. One Supabase realtime channel: `order_status_history` INSERTs. The two old channels on the order rows
 *      (customer-order and per-store-order tables) are gone — their RLS policies gate on `auth.uid()`, which is NULL
 *      under this app's phone-OTP JWT, so they could never fire (MAP §7.17). Every payment-status transition
 *      (payment.authorized / .failed, refund.processed, captured → paid) only touches the order / payment rows, never
 *      `order_status_history`, so it can NEVER arrive via realtime — the poll above is what keeps payment status
 *      current, which is why it is never throttled back on a "connected" channel.
 *   3. Driver location: a `driver_locations` realtime channel plus a 2 s fallback poll whose interval is cleared once
 *      the channel is confirmed `SUBSCRIBED` (re-armed if it drops) — both created ONLY while a rider is assigned
 *      (`driverIds.length > 0`) and torn down under the same background / offline / unfocused gates.
 *
 * `setData` runs only when `snapshotKey` changes; `lastUpdatedAt` changes on every successful poll.
 * Synthetic seam: while `Dev_Tracking_inhibit_SyntheticStatus !== 'off'`, `refresh()` resolves
 * `buildSyntheticTracking()` with no network, and a flag change re-runs it.
 * Passive feedback (motion doc M23): a status that CHANGES while the screen is focused → `feedback.passive('tap')`,
 * `order_delivered` → `feedback.passive('success')`; the first observed status never fires.
 */
export function useOrderTracking(orderId: string | undefined): UseOrderTrackingResult {
  const [data, setData] = useState<TrackingFullResponse | null>(null);
  const [driverLocations, setDriverLocations] = useState<Record<string, DriverLocation>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // State twin of AppState for render/effects (the listener below keeps it current).
  const [appActive, setAppActive] = useState(() => isAppActive(AppState.currentState));

  const online = useIsOnline();
  const cobaltInhibited = useDevFlag('Dev_Cobalt_inhibit_Feature');
  const pollMsOverride = useDevFlag('Dev_Tracking_inhibit_PollMs');
  const syntheticStatus = useDevFlag('Dev_Tracking_inhibit_SyntheticStatus');
  const synthetic = syntheticStatus !== 'off';

  // Latest in-flight sequence so a slow poll never writes a stale snapshot over a fresher one.
  const seqRef = useRef(0);
  const lastKeyRef = useRef<string | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  const hasDataRef = useRef(false);
  // Screen focus (M23): passive feedback only while the tracking screen is the visible route.
  const focusedRef = useRef(false);
  // State twin of focus for the poll effects: no status / driver polls under a pushed support / rate screen.
  const [focused, setFocused] = useState(false);
  // Set on the first blur so a refocus (back from a pushed screen) triggers one immediate refresh, never the first focus.
  const blurredOnceRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  // When the synthetic mode was entered — the fake ETA counts down from here.
  const syntheticStartedAtRef = useRef(Date.now());
  const autoRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      // Back from a pushed screen: one immediate refresh, then the poll effect below re-arms (same shape as AppState resume).
      if (blurredOnceRef.current && !isTerminalStatus(lastStatusRef.current)) refreshRef.current();
      return () => {
        focusedRef.current = false;
        blurredOnceRef.current = true;
        setFocused(false);
      };
    }, []),
  );

  const status = data?.order?.status ?? null;
  const terminal = isTerminalStatus(status);
  const offlinePaused = !online && !cobaltInhibited;
  const paused = !appActive || offlinePaused;
  // Poll gate: `paused` (surfaced as "Signal lost") plus route focus (not surfaced — a covered screen has not lost signal).
  const pollsAsleep = paused || !focused;
  const pollMs =
    pollMsOverride > 0 ? pollMsOverride : status && FAST_POLL_STATUSES.includes(status) ? FAST_POLL_MS : SLOW_POLL_MS;

  /** Diff + commit one snapshot; fires the passive feedback for an observed status change. */
  const applySnapshot = useCallback((next: TrackingFullResponse) => {
    const key = snapshotKey(next);
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      setData(next);
    }
    hasDataRef.current = true;
    setLastUpdatedAt(Date.now());

    const nextStatus = next.order?.status ?? null;
    const prevStatus = lastStatusRef.current;
    if (prevStatus !== null && nextStatus !== null && prevStatus !== nextStatus && focusedRef.current) {
      // `feedback` itself drops the call when AppState is not active and debounces passive events by 3 s.
      feedback.passive(nextStatus === 'order_delivered' ? 'success' : 'tap');
    }
    lastStatusRef.current = nextStatus;
  }, []);

  const refresh = useCallback(async () => {
    if (!orderId) return;

    // ── Synthetic seam: no network, resolves locally ──
    const syntheticNow = getDevFlag('Dev_Tracking_inhibit_SyntheticStatus');
    if (syntheticNow !== 'off') {
      seqRef.current += 1; // any real response still in flight is now stale
      const built = buildSyntheticTracking(orderId, syntheticNow, syntheticStartedAtRef.current);
      applySnapshot(built.snapshot);
      setDriverLocations((prev) => mergeDriverLocations(prev, built.driverLocations));
      setError(null);
      setLoading(false);
      return;
    }

    // ── Offline pause: no requests (cobalt). With nothing painted yet, surface the offline error instead of a skeleton. ──
    if (!getIsOnline() && !getDevFlag('Dev_Cobalt_inhibit_Feature')) {
      if (!hasDataRef.current) {
        setError(OFFLINE_MESSAGE);
        setLoading(false);
      }
      return;
    }

    const mySeq = ++seqRef.current;
    try {
      const next = await fetchOrderTrackingFull(orderId, { timeoutMs: REQUEST_TIMEOUT_MS });
      if (mySeq !== seqRef.current) return; // newer fetch already won
      if (next) {
        applySnapshot(next);
        setError(null);
      } else {
        setError('Order not found');
      }
    } catch (err) {
      if (mySeq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load tracking');
    } finally {
      if (mySeq === seqRef.current) setLoading(false);
    }
  }, [orderId, applySnapshot]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // ── Initial load + when orderId changes ──
  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    lastKeyRef.current = null;
    lastStatusRef.current = null;
    hasDataRef.current = false;
    setLoading(true);
    refresh();
  }, [orderId, refresh]);

  // ── AppState: background/inactive clears the intervals (via `appActive`); active → one immediate refresh, then restart ──
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const active = isAppActive(next);
      setAppActive(active);
      if (active && !isTerminalStatus(lastStatusRef.current)) refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // ── Adaptive status poll: stopped on terminal, cleared in background / under a pushed screen, paused offline ──
  useEffect(() => {
    if (!orderId || terminal || pollsAsleep) return;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [orderId, terminal, pollsAsleep, pollMs, refresh]);

  // ── Reconnect: one refresh when the network comes back (no-op under Dev_Cobalt_inhibit_ReconnectRefetch / _Feature) ──
  useRefetchOnReconnect(refresh, !!orderId && !terminal);

  // ── Synthetic flag changes re-run refresh (entering synthetic restarts the fake clock; leaving it refetches real data) ──
  useEffect(() => {
    if (!orderId) return;
    let last = getDevFlag('Dev_Tracking_inhibit_SyntheticStatus');
    if (last !== 'off') syntheticStartedAtRef.current = Date.now();
    return subscribeDevFlags(() => {
      const next = getDevFlag('Dev_Tracking_inhibit_SyntheticStatus');
      if (next === last) return;
      const modeChanged = next === 'off' || last === 'off';
      last = next;
      if (modeChanged) {
        // Crossing real ↔ synthetic is a new data source: the first status seen there must not read as an "advance".
        lastStatusRef.current = null;
        lastKeyRef.current = null;
        if (next !== 'off') syntheticStartedAtRef.current = Date.now();
      }
      refresh();
    });
  }, [orderId, refresh]);

  // ── Realtime: order_status_history INSERTs (the only channel RLS lets through — MAP §7.17). Not in synthetic / terminal. ──
  useEffect(() => {
    if (!orderId || terminal || synthetic) return;

    const channel = supabase
      .channel(`order-tracking-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_status_history',
          filter: `customer_order_id=eq.${orderId}`,
        },
        () => {
          setAutoRefreshing(true);
          refresh().finally(() => {
            if (autoRefreshTimerRef.current) clearTimeout(autoRefreshTimerRef.current);
            autoRefreshTimerRef.current = setTimeout(() => setAutoRefreshing(false), AUTO_REFRESH_FLASH_MS);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (autoRefreshTimerRef.current) {
        clearTimeout(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [orderId, terminal, synthetic, refresh]);

  // Driver ids currently assigned to this order — a stable joined string (not `data` itself) as the effect
  // dependency below, so the realtime channel only re-subscribes when the set of assigned drivers changes
  // (e.g. reassignment), not on every order refetch — same pattern as the website's useOrderTrackingRealtime.ts.
  const driverIds = useMemo(() => {
    const ids = (data?.order?.store_orders || [])
      .map((so) => so.delivery_partner_id)
      .filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [data?.order?.store_orders]);
  const driverIdsKey = driverIds.join(',');

  // A reassignment (different id set) drops the old rider's coordinate; the synthetic seam writes its own.
  useEffect(() => {
    if (synthetic) return;
    setDriverLocations({});
  }, [driverIdsKey, synthetic]);

  // ── Driver location: realtime channel + 2 s fallback poll, ONLY with a rider, never on terminal / background / offline / unfocused ──
  // `driver_locations` has a broad anon-key-reachable RLS read policy (unlike the order-row tables), so the
  // channel works here exactly as on the web; the fallback interval is CLEARED once the channel reports SUBSCRIBED
  // and re-armed if it drops (CLOSED / CHANNEL_ERROR / TIMED_OUT) — it never ticks for the whole ride.
  useEffect(() => {
    if (!orderId || terminal || synthetic || pollsAsleep || driverIdsKey === '') return;

    let cancelled = false;
    let realtimeHealthy = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (realtimeHealthy) return;
      const next = await fetchDriverLocations(orderId, { timeoutMs: REQUEST_TIMEOUT_MS });
      if (cancelled) return;
      if (Object.keys(next).length > 0) {
        setDriverLocations((prev) => mergeDriverLocations(prev, next));
      }
    };
    const armPoll = () => {
      if (cancelled || pollTimer) return;
      pollTimer = setInterval(poll, DRIVER_POLL_MS);
    };
    const disarmPoll = () => {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    };

    // One immediate fetch — the channel's subscribe() callback has not resolved yet, so realtimeHealthy is false.
    poll();

    const channel = supabase
      .channel(`driver-locations-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_locations',
          filter: `delivery_partner_id=in.(${driverIdsKey})`,
        },
        (payload) => {
          const row = payload.new as {
            delivery_partner_id?: string;
            latitude?: number;
            longitude?: number;
            updated_at?: string;
          };
          const id = row?.delivery_partner_id;
          if (!id || row.latitude == null || row.longitude == null) return;
          const point: DriverLocation = {
            latitude: row.latitude,
            longitude: row.longitude,
            updated_at: row.updated_at || new Date().toISOString(),
          };
          setDriverLocations((prev) => mergeDriverLocations(prev, { [id]: point }));
        },
      )
      .subscribe((state) => {
        if (cancelled) return;
        realtimeHealthy = state === 'SUBSCRIBED';
        if (realtimeHealthy) disarmPoll();
        else armPoll();
      });

    armPoll();
    return () => {
      cancelled = true;
      disarmPoll();
      supabase.removeChannel(channel);
    };
  }, [orderId, driverIdsKey, terminal, synthetic, pollsAsleep]);

  return { data, driverLocations, loading, error, autoRefreshing, refresh, lastUpdatedAt, paused };
}
