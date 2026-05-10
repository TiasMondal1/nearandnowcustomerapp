/**
 * Google Maps / Geocoding / Places REST key — must come from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY only.
 * Never ship a hardcoded fallback key in source.
 */
export function getGoogleMapsApiKey(): string {
  return (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
}
