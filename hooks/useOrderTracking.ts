import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '../lib/supabase';
import {
  type DriverLocation,
  type TrackingFullResponse,
  fetchDriverLocations,
  fetchOrderTrackingFull,
} from '../lib/trackingService';

const FALLBACK_POLL_MS = 5_000; // realtime fallback if Supabase channel hiccups
const DRIVER_POLL_MS = 2_000; // fallback rate while realtime isn't confirmed healthy

export interface UseOrderTrackingResult {
  data: TrackingFullResponse | null;
  /** `delivery_partner_id` → live coords. Empty until the rider has been assigned. */
  driverLocations: Record<string, DriverLocation>;
  loading: boolean;
  error: string | null;
  /** True briefly when a realtime event lands (used to flash a refresh indicator). */
  autoRefreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * React Native equivalent of the web app's `useOrderTrackingRealtime`.
 *
 * Three concurrent data streams:
 *   1. Initial + realtime `customer_orders` / `store_orders` / `order_status_history` updates
 *      (Supabase Postgres realtime channel) — anytime the row changes, refetch the full snapshot.
 *   2. 5s polling fallback in case realtime drops (Expo Go / poor network).
 *   3. Driver location: a real `driver_locations` realtime channel (matching the web app's
 *      `useOrderTrackingRealtime` — same table, same anon-key-reachable RLS policy, no auth
 *      bridge needed), with a 2s poll that only actually fetches while that channel isn't
 *      confirmed `SUBSCRIBED`. Previously this was unconditional 2s polling with no realtime
 *      subscription at all — functional, but higher battery/network cost and up to ~2s more
 *      marker-movement latency than the web app already got from realtime. Fixed 2026-08-13.
 */
export function useOrderTracking(orderId: string | undefined): UseOrderTrackingResult {
  const [data, setData] = useState<TrackingFullResponse | null>(null);
  const [driverLocations, setDriverLocations] = useState<Record<string, DriverLocation>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshing, setAutoRefreshing] = useState(false);

  // Latest in-flight ref so polling/realtime never write a stale snapshot
  // over a fresher one (race when realtime fires while initial fetch is mid-air).
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!orderId) return;
    const mySeq = ++seqRef.current;
    try {
      const next = await fetchOrderTrackingFull(orderId);
      if (mySeq !== seqRef.current) return; // newer fetch already won
      if (next) {
        setData(next);
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
  }, [orderId]);

  // Initial load + when orderId changes.
  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh();
  }, [orderId, refresh]);

  // Supabase realtime: customer_orders / store_orders / order_status_history.
  // When any change lands, refetch the full snapshot (cheap, single backend call)
  // and flash the auto-refreshing indicator briefly so the user sees activity.
  useEffect(() => {
    if (!orderId) return;

    const channel = supabase
      .channel(`order-tracking-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customer_orders',
          filter: `id=eq.${orderId}`,
        },
        () => {
          setAutoRefreshing(true);
          refresh().finally(() => setTimeout(() => setAutoRefreshing(false), 600));
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'store_orders',
          filter: `customer_order_id=eq.${orderId}`,
        },
        () => {
          setAutoRefreshing(true);
          refresh().finally(() => setTimeout(() => setAutoRefreshing(false), 600));
        },
      )
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
          refresh().finally(() => setTimeout(() => setAutoRefreshing(false), 600));
        },
      )
      .subscribe();

    // Polling fallback — always ticks at the full rate, deliberately not
    // throttled back even when the channel reports itself "connected". A
    // successful `.subscribe()` only confirms the websocket handshake, not
    // that Postgres RLS actually lets any row through: `customer_orders`/
    // `store_orders` have no working SELECT RLS policy for this app's
    // custom phone-OTP auth (this app doesn't use Supabase Auth, so
    // `auth.uid()` is always NULL here — see SCHEMA_NOTES.md) — only the
    // `order_status_history` INSERT channel above can ever actually fire.
    // Every payment-status transition (payment.authorized/.failed,
    // refund.processed, payment.captured→paid) only touches
    // `customer_orders`/`customer_payments`, never `order_status_history`,
    // so it can NEVER arrive via realtime — throttling this poll back to
    // ~30s on "connected" previously left those changes stale for up to
    // 30s despite this screen's own "Live" framing. Polling unconditionally
    // at FALLBACK_POLL_MS is what actually keeps payment status current.
    const fallbackInterval = setInterval(refresh, FALLBACK_POLL_MS);

    return () => {
      clearInterval(fallbackInterval);
      supabase.removeChannel(channel);
    };
  }, [orderId, refresh]);

  // Driver ids currently assigned to this order — a stable joined string
  // (not `data` itself) as the effect dependency below, so the realtime
  // channel only actually re-subscribes when the set of assigned drivers
  // changes (e.g. reassignment), not on every order refetch — same pattern
  // as the website's `useOrderTrackingRealtime.ts`.
  const driverIds = useMemo(() => {
    const ids = (data?.order?.store_orders || [])
      .map((so) => so.delivery_partner_id)
      .filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [data?.order?.store_orders]);
  const driverIdsKey = driverIds.join(',');

  // Driver location: real Supabase realtime channel when we know which
  // driver(s) to watch, plus a poll that only actually fetches while that
  // channel isn't confirmed subscribed — mirrors the website's identical
  // driver_locations handling in useOrderTrackingRealtime.ts. `driver_locations`
  // has a broad anon-key-reachable RLS read policy (no Supabase Auth bridge
  // needed, unlike customer_orders/store_orders), so this works the same way
  // here as it already does on the web.
  useEffect(() => {
    setDriverLocations({});
    if (!orderId) return;

    let cancelled = false;
    let realtimeHealthy = false;

    const poll = async () => {
      if (realtimeHealthy) return;
      const next = await fetchDriverLocations(orderId);
      if (cancelled) return;
      if (Object.keys(next).length > 0) {
        setDriverLocations((prev) => ({ ...prev, ...next }));
      }
    };

    // Always do one immediate fetch — the channel's subscribe() callback
    // hasn't resolved yet at this point, so realtimeHealthy is still false.
    poll();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (driverIds.length > 0) {
      channel = supabase
        .channel(`driver-locations-${orderId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'driver_locations',
            filter: `delivery_partner_id=in.(${driverIds.join(',')})`,
          },
          (payload) => {
            const row = payload.new as {
              delivery_partner_id?: string;
              latitude?: number;
              longitude?: number;
              updated_at?: string;
            };
            if (!row?.delivery_partner_id || row.latitude == null || row.longitude == null) return;
            setDriverLocations((prev) => ({
              ...prev,
              [row.delivery_partner_id!]: {
                latitude: row.latitude!,
                longitude: row.longitude!,
                updated_at: row.updated_at || new Date().toISOString(),
              },
            }));
          },
        )
        .subscribe((status) => {
          realtimeHealthy = status === 'SUBSCRIBED';
        });
    }

    const id = setInterval(poll, DRIVER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (channel) supabase.removeChannel(channel);
    };
  }, [orderId, driverIdsKey]);

  return { data, driverLocations, loading, error, autoRefreshing, refresh };
}
