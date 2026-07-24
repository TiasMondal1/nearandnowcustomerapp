import { apiFetch } from "./apiClient";

// All requests go through the backend's /api/places proxy so no Google Maps
// API key is ever embedded in the app bundle (that key was previously
// extractable from every install and billable by anyone who pulled it out).

export async function reverseGeocode(lat: number, lng: number) {
  return apiFetch<any>(
    `/api/places/reverse-geocode?lat=${lat}&lng=${lng}`,
  );
}

export async function geocodeAddress(address: string) {
  return apiFetch<any>(
    `/api/places/geocode?address=${encodeURIComponent(address)}`,
  );
}

export async function autocomplete(input: string, sessionToken?: string) {
  const params = new URLSearchParams({ input });
  if (sessionToken) params.set("sessiontoken", sessionToken);
  return apiFetch<any>(`/api/places/autocomplete?${params.toString()}`);
}

export async function placeDetails(placeId: string, sessionToken?: string) {
  const params = new URLSearchParams({ place_id: placeId });
  if (sessionToken) params.set("sessiontoken", sessionToken);
  return apiFetch<any>(`/api/places/details?${params.toString()}`);
}
