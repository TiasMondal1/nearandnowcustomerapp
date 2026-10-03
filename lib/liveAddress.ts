/**
 * Module mirror of the last reverse-geocoded "live address" shown in Home's header pill (MAP §2.8 #33 escape hatch:
 * read in effects/handlers, never during render). It used to live inside app/(tabs)/home.tsx with its logout clear in
 * a Home effect, which only ran while Home was mounted; the clear now runs from `AuthContext.clearStoredSession()`
 * like every other user-scoped memory mirror (CONTRACTS §9, W3 R1-15).
 */

let liveAddress: string | null = null;
let liveAddressResolved = false;

/** The cached label (`null` when none) and whether the one-per-launch lookup has already run. */
export function getLiveAddressCache(): { address: string | null; resolved: boolean } {
  return { address: liveAddress, resolved: liveAddressResolved };
}

/** Records the lookup result (`address` may be null when the geocoder returned nothing). */
export function setLiveAddressCache(address: string | null, resolved = true): void {
  liveAddress = address;
  liveAddressResolved = resolved;
}

/** Forgets the label and lets the lookup run again — called on logout so the next user never sees it. */
export function clearLiveAddressCache(): void {
  liveAddress = null;
  liveAddressResolved = false;
}
