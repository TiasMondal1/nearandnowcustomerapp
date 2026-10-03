// codename: mira
// Synthetic tracking snapshot for the dev panel (`Dev_Tracking_inhibit_SyntheticStatus`, design/speed-and-ease #8).
// Pure: no network, no timers. `useOrderTracking.refresh()` resolves this instead of `/api/tracking/orders/:id/full`
// while the flag is not 'off', so the whole tracking screen (hero countdown, 4-step progress, map, rider card, OTP
// block, delivered → Rate CTA, cancelled banner) can be exercised offline at any status.
import { ORDER_TIMELINE, getTimelineIndex } from '../../constants/orderStatus';
import { getActiveLocationSync } from '../../context/LocationContext';
import { shouldShowOTP } from '../orderService';
import type {
  DriverLocation,
  TrackingDeliveryAgent,
  TrackingFullResponse,
  TrackingOrderItem,
  TrackingStatusEvent,
  TrackingStoreLocation,
} from '../trackingService';

/** ETA = `startedAt` + this many minutes, so the hero counts down from 18 and reaches "Running late" after 18 min. */
export const SYNTHETIC_ETA_MINUTES = 18;
/** Spacing between consecutive `statusHistory` events. */
const STATUS_SPACING_MS = 2 * 60_000;
/** The fake store sits this far from the door (diagonal north-east), close enough for a readable map region. */
const STORE_OFFSET_KM = 1.2;
/** Fallback door when no location is saved (Kolkata, same default as location/select-map). */
const KOLKATA = { latitude: 22.5726, longitude: 88.3639 };
/** Mean metres per degree of latitude; longitude is scaled by cos(lat). */
const KM_PER_DEG_LAT = 111.32;

export const SYNTHETIC_RIDER_ID = 'dev-rider-ravi';
const SYNTHETIC_STORE_ID = 'dev-store';
const SYNTHETIC_STORE_ORDER_ID = 'dev-store-order';
const SYNTHETIC_OTP = '4821';

const RIDER: TrackingDeliveryAgent = {
  id: SYNTHETIC_RIDER_ID,
  name: 'Ravi',
  phone: '+919999900001',
  vehicle_number: 'WB 02 AB 1234',
};

const ITEMS: TrackingOrderItem[] = [
  { product_name: 'Amul Taaza Toned Milk', quantity: 2, unit_price: 27, unit: '500 ml' },
  { product_name: 'Britannia Brown Bread', quantity: 1, unit_price: 45, unit: '400 g' },
  { product_name: 'Fresh Bananas', quantity: 1, unit_price: 48, unit: '1 dozen' },
];

export type SyntheticTracking = {
  snapshot: TrackingFullResponse;
  /** `delivery_partner_id` → coords at the store (empty before the rider is assigned). */
  driverLocations: Record<string, DriverLocation>;
};

/** Index of the rider-assignment step in `ORDER_TIMELINE`; the agent and driver location exist from here on. */
const RIDER_STEP = getTimelineIndex('delivery_partner_assigned');

function offsetKm(origin: { latitude: number; longitude: number }, km: number): { latitude: number; longitude: number } {
  // Split the distance evenly over both axes so the store lies on a 45° diagonal `km` away.
  const leg = km * Math.SQRT1_2;
  const dLat = leg / KM_PER_DEG_LAT;
  const dLng = leg / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos((origin.latitude * Math.PI) / 180)));
  return { latitude: origin.latitude + dLat, longitude: origin.longitude + dLng };
}

function buildHistory(status: string, startedAt: number): TrackingStatusEvent[] {
  const at = (i: number) => new Date(startedAt + i * STATUS_SPACING_MS).toISOString();
  if (status === 'order_cancelled') {
    return [
      { status: 'pending_at_store', created_at: at(0) },
      { status: 'order_cancelled', created_at: at(1), notes: 'Cancelled from the dev panel' },
    ];
  }
  const index = getTimelineIndex(status);
  const upto = index >= 0 ? index : 0;
  return ORDER_TIMELINE.slice(0, upto + 1).map((step, i) => ({ status: step.key, created_at: at(i) }));
}

/**
 * A complete `/full` response for `orderId` at `status`, placed at `startedAt`:
 * store 1.2 km from the active location (or Kolkata), `estimated_delivery_time = startedAt + 18 min`, the
 * `statusHistory` filled up to `status` with 2-min spacing, one delivery agent "Ravi" once the status is at or past
 * `delivery_partner_assigned` (driver location at the store), the 4-digit OTP while `shouldShowOTP(status)`.
 */
export function buildSyntheticTracking(orderId: string, status: string, startedAt: number): SyntheticTracking {
  const saved = getActiveLocationSync();
  const door = saved ? { latitude: saved.latitude, longitude: saved.longitude } : KOLKATA;
  const store = offsetKm(door, STORE_OFFSET_KM);
  const timelineIndex = getTimelineIndex(status);
  const cancelled = status === 'order_cancelled';
  const delivered = status === 'order_delivered';
  const riderAssigned = !cancelled && timelineIndex >= RIDER_STEP;
  const placedIso = new Date(startedAt).toISOString();

  const storeLocation: TrackingStoreLocation = {
    lat: store.latitude,
    lng: store.longitude,
    label: 'Near & Now Daily Mart',
    address: saved?.address ? `Near ${saved.address}` : 'Park Street, Kolkata',
    phone: '+913340000000',
    store_id: SYNTHETIC_STORE_ID,
  };

  const snapshot: TrackingFullResponse = {
    order: {
      id: orderId,
      order_code: `DEV-${orderId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || '0001'}`,
      status,
      placed_at: placedIso,
      created_at: placedIso,
      delivery_address: saved?.address || saved?.label || 'Synthetic address · Kolkata',
      total_amount: ITEMS.reduce((sum, it) => sum + it.quantity * it.unit_price, 0),
      payment_method: 'cod',
      payment_status: delivered ? 'paid' : 'pending',
      delivery_latitude: door.latitude,
      delivery_longitude: door.longitude,
      estimated_delivery_time: new Date(startedAt + SYNTHETIC_ETA_MINUTES * 60_000).toISOString(),
      store_orders: [
        {
          id: SYNTHETIC_STORE_ORDER_ID,
          store_id: SYNTHETIC_STORE_ID,
          // The screen hides the map until a store has left 'pending_at_store' — mirror the real per-store status.
          status: status === 'pending_at_store' ? 'pending_at_store' : status,
          delivery_partner_id: riderAssigned ? SYNTHETIC_RIDER_ID : undefined,
          order_items: ITEMS,
        },
      ],
      delivery_otp: shouldShowOTP(status) ? SYNTHETIC_OTP : undefined,
    },
    statusHistory: buildHistory(status, startedAt),
    storeLocations: [storeLocation],
    deliveryAgent: riderAssigned ? RIDER : undefined,
    deliveryAgents: riderAssigned ? { [SYNTHETIC_RIDER_ID]: RIDER } : undefined,
  };

  const driverLocations: Record<string, DriverLocation> = riderAssigned
    ? { [SYNTHETIC_RIDER_ID]: { latitude: store.latitude, longitude: store.longitude, updated_at: new Date().toISOString() } }
    : {};

  return { snapshot, driverLocations };
}
