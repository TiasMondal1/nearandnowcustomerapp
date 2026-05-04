import { apiFetch } from './apiClient';

/**
 * Mobile equivalent of `near-and-now/frontend/src/services/trackingApi.ts`.
 *
 * Uses the public, server-side-only tracking endpoints exposed by the
 * `near-and-now` backend. These endpoints bypass Supabase RLS so the
 * customer can see order status, store coordinates, the assigned delivery
 * partner, and live driver location without us shipping the service-role
 * key into the binary for those fields.
 *
 * Backend mounts these at `/api/tracking/*`
 * (see `near-and-now/backend/src/routes/tracking.routes.ts`).
 */

export interface TrackingOrderItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  image_url?: string;
  unit?: string;
}

export interface TrackingStoreOrder {
  id: string;
  store_id: string;
  status?: string;
  delivery_partner_id?: string;
  order_items?: TrackingOrderItem[];
}

export interface TrackingOrder {
  id: string;
  order_code?: string;
  status: string;
  placed_at?: string;
  created_at?: string;
  delivery_address: string;
  total_amount: number;
  payment_method: string;
  payment_status?: string;
  delivery_latitude?: number;
  delivery_longitude?: number;
  estimated_delivery_time?: string;
  store_orders?: TrackingStoreOrder[];
  /** 4-digit delivery verification PIN, generated when order is dispatched */
  delivery_otp?: string;
}

export interface TrackingStoreLocation {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
  phone?: string;
  store_id?: string;
}

export interface TrackingDeliveryAgent {
  id: string;
  name: string;
  phone: string;
  vehicle_number?: string;
}

export interface TrackingStatusEvent {
  status: string;
  notes?: string;
  created_at: string;
}

export interface DriverLocation {
  latitude: number;
  longitude: number;
  updated_at: string;
}

export interface TrackingFullResponse {
  order: TrackingOrder;
  statusHistory: TrackingStatusEvent[];
  storeLocations: TrackingStoreLocation[];
  /** Legacy single-agent field — first store's partner. Prefer `deliveryAgents`. */
  deliveryAgent?: TrackingDeliveryAgent;
  /** Map of `delivery_partner_id` → agent details. Use this for multi-store orders. */
  deliveryAgents?: Record<string, TrackingDeliveryAgent>;
}

/** Snapshot of an order + its history + store/agent context. */
export async function fetchOrderTrackingFull(
  orderId: string,
): Promise<TrackingFullResponse | null> {
  if (!orderId) return null;
  try {
    return await apiFetch<TrackingFullResponse>(
      `/api/tracking/orders/${encodeURIComponent(orderId)}/full`,
    );
  } catch (err) {
    console.warn('[TRACKING] fetchOrderTrackingFull failed', err);
    return null;
  }
}

/**
 * Map of `delivery_partner_id` → `{ latitude, longitude, updated_at }`.
 * Polled every 2s on the tracking page to drive live driver-marker movement.
 * Returns an empty object on failure so the caller doesn't have to null-guard.
 */
export async function fetchDriverLocations(
  orderId: string,
): Promise<Record<string, DriverLocation>> {
  if (!orderId) return {};
  try {
    return await apiFetch<Record<string, DriverLocation>>(
      `/api/tracking/orders/${encodeURIComponent(orderId)}/driver-locations`,
    );
  } catch (err) {
    console.warn('[TRACKING] fetchDriverLocations failed', err);
    return {};
  }
}
