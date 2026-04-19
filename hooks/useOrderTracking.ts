import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '../lib/supabase';
import {
  type DriverLocation,
  type TrackingFullResponse,
  fetchDriverLocations,
  fetchOrderTrackingFull,
} from '../lib/trackingService';

const FALLBACK_POLL_MS = 5_000; // realtime fallback if Supabase channel hiccups
const DRIVER_POLL_MS = 2_000; // matches the web app — drivers move ~ every 2s

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
 *   3. 2s driver-location poll for the live map marker.
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

    // Polling fallback — covers cases where realtime is not enabled on the
    // table, or where the WebSocket gets dropped on a flaky network.
    const fallbackInterval = setInterval(refresh, FALLBACK_POLL_MS);

    return () => {
      clearInterval(fallbackInterval);
      supabase.removeChannel(channel);
    };
  }, [orderId, refresh]);

  // Driver location poll — independent from order refetch since it ticks 2.5x faster.
  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    const poll = async () => {
      const next = await fetchDriverLocations(orderId);
      if (cancelled) return;
      if (Object.keys(next).length > 0) {
        setDriverLocations((prev) => ({ ...prev, ...next }));
      }
    };

    poll();
    const id = setInterval(poll, DRIVER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId]);

  return { data, driverLocations, loading, error, autoRefreshing, refresh };
}
