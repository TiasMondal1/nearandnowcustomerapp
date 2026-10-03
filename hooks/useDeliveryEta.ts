// codename: antares
import { useSyncExternalStore } from 'react';

import { useLocation } from '../context/LocationContext';
import {
  getDeliveryEta,
  getEtaSourceKey,
  subscribeDeliveryEta,
  type DeliveryEta,
} from '../lib/deliveryEta';
import { subscribeDevFlags, useDevFlag } from '../lib/devFlags';
import { nearbyKey } from '../lib/storeService';

const NONE: DeliveryEta = Object.freeze({
  minutes: null,
  state: 'none',
  nearestKm: null,
  nearestStoreName: null,
  storeCount: 0,
});

const UNKNOWN: DeliveryEta = Object.freeze({
  minutes: null,
  state: 'unknown',
  nearestKm: null,
  nearestStoreName: null,
  storeCount: 0,
});

/** Module-level so useSyncExternalStore keeps one subscription per mount. */
function subscribeEtaAndFlags(cb: () => void): () => void {
  const offEta = subscribeDeliveryEta(cb);
  const offFlags = subscribeDevFlags(cb);
  return () => {
    offEta();
    offFlags();
  };
}

/**
 * Live delivery ETA for the active location (useSyncExternalStore over
 * `subscribeDeliveryEta` + `subscribeDevFlags`, combined with `useLocation()`).
 *
 * - `Dev_Antares_inhibit_Feature` or no location → `state: 'none'` (surfaces hide)
 * - location known but `getNearbyProductFilter()` has not resolved for *this*
 *   location yet (no source, or a source for a previous address) → `'unknown'`
 * - resolved with 0 stores, or `Dev_Antares_inhibit_StoreOpen` → `'closed'`
 * - otherwise `'open'` with `minutes = clamp(round(8 + 4·km), 10, 30)`, or
 *   `Dev_Antares_inhibit_EtaMinutes` when > 0
 *
 * Returned objects are referentially stable while their fields are unchanged.
 */
export function useDeliveryEta(): DeliveryEta {
  const { location } = useLocation();
  const eta = useSyncExternalStore(subscribeEtaAndFlags, getDeliveryEta, getDeliveryEta);
  const sourceKey = useSyncExternalStore(subscribeDeliveryEta, getEtaSourceKey, getEtaSourceKey);
  const inhibited = useDevFlag('Dev_Antares_inhibit_Feature');

  if (inhibited || !location) return eta.state === 'none' ? eta : NONE;

  const locationKey = nearbyKey(location.latitude, location.longitude);
  if (sourceKey !== locationKey) return UNKNOWN;
  return eta;
}
