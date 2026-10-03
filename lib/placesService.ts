import { apiFetch } from './apiClient';
import { getDevFlag } from './devFlags';
import { logSilentFailure } from './logSilentFailure';

// All requests go through the backend's /api/places proxy so no Google Maps
// API key is ever embedded in the app bundle (that key was previously
// extractable from every install and billable by whoever pulled it out).
//
// Typed responses (W15-location-foundations, 2026-10-03; MAP K17): the proxy
// relays Google's raw Geocoding / Places payloads (`{ status, results }`,
// `{ status, predictions }`, `{ status, result }`). This module is the ONE place
// that reads those shapes — screens consume the flattened types below and never
// re-type the payload ad hoc (select-map / add / edit used to each do it).

// ─── Public types ────────────────────────────────────────────────────────────

export type ReverseGeocodeResult = {
  formatted_address: string;
  components: {
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
    /** Neighbourhood / sublocality — the short "place name" shown above the full address on the map card. */
    area?: string;
  };
  place_id?: string;
  /** The untouched Google result row, for `google_place_data` on the saved address. */
  raw: unknown;
};

export type AutocompletePrediction = {
  place_id: string;
  description: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
};

export type PlaceDetails = {
  place_id: string;
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components?: unknown[];
  /** Parsed from `address_components` the same way `reverseGeocode` does it. */
  components: ReverseGeocodeResult['components'];
  /** The untouched Google result row, for `google_place_data` on the saved address. */
  raw: unknown;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  formatted_address: string;
  place_id?: string;
  components: ReverseGeocodeResult['components'];
  raw: unknown;
};

// ─── Raw proxy payloads (private) ────────────────────────────────────────────

type GoogleAddressComponent = { long_name?: unknown; short_name?: unknown; types?: unknown };

type GoogleGeocodeRow = {
  place_id?: unknown;
  formatted_address?: unknown;
  address_components?: unknown;
  geometry?: { location?: { lat?: unknown; lng?: unknown } };
  name?: unknown;
};

type GoogleStatusEnvelope = { status?: unknown; error_message?: unknown };
type GoogleGeocodeResponse = GoogleStatusEnvelope & { results?: unknown };
type GoogleAutocompleteResponse = GoogleStatusEnvelope & { predictions?: unknown };
type GooglePlaceDetailsResponse = GoogleStatusEnvelope & { result?: unknown };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function componentsOf(row: GoogleGeocodeRow): GoogleAddressComponent[] {
  return Array.isArray(row.address_components) ? (row.address_components as GoogleAddressComponent[]) : [];
}

/** `long_name` of the first component carrying `type` (Google lists several per row). */
function findComponent(components: GoogleAddressComponent[], type: string): string | undefined {
  for (const c of components) {
    if (Array.isArray(c.types) && c.types.includes(type)) {
      const name = asString(c.long_name);
      if (name) return name;
    }
  }
  return undefined;
}

/** City / state / pincode / country / area, with the same fallback chain select-map.tsx used (2026-09). */
function extractComponents(components: GoogleAddressComponent[]): ReverseGeocodeResult['components'] {
  const find = (type: string) => findComponent(components, type);
  return {
    city: find('locality') ?? find('postal_town') ?? find('administrative_area_level_2') ?? find('sublocality_level_1'),
    state: find('administrative_area_level_1'),
    pincode: find('postal_code'),
    country: find('country'),
    area: find('neighborhood') ?? find('sublocality_level_2') ?? find('sublocality_level_1'),
  };
}

function firstResult(response: GoogleGeocodeResponse): GoogleGeocodeRow | null {
  if (asString(response.status) !== 'OK' || !Array.isArray(response.results)) return null;
  const row = asRecord(response.results[0]);
  return row ? (row as GoogleGeocodeRow) : null;
}

/** Logs a non-OK Google status once (ZERO_RESULTS is a normal outcome and stays quiet). */
function noteStatus(context: string, response: GoogleStatusEnvelope): void {
  const status = asString(response.status) ?? 'UNKNOWN';
  if (status === 'OK' || status === 'ZERO_RESULTS') return;
  logSilentFailure(`${context} (${status})`, asString(response.error_message) ?? status);
}

/**
 * One Places Autocomplete session token (predictions + the Details call they end in are billed as one
 * session). Rotate it after `placeDetails` resolves, per Google's guidance.
 */
export function newPlacesSessionToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Lat/lng → the nearest formatted address. Resolves `null` under `Dev_Quartz_inhibit_ReverseGeocode`
 * (callers keep "Pinned location"), on a non-OK status and on every failure (logged) — it never throws,
 * so a dropped request can never break a map settle or a GPS fix.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  if (getDevFlag('Dev_Quartz_inhibit_ReverseGeocode')) return null;
  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const response = await apiFetch<GoogleGeocodeResponse>(`/api/places/reverse-geocode?${params.toString()}`);
    const row = firstResult(response);
    if (!row) {
      noteStatus('Reverse geocode', response);
      return null;
    }
    const formatted = asString(row.formatted_address);
    if (!formatted) return null;
    return {
      formatted_address: formatted,
      components: extractComponents(componentsOf(row)),
      place_id: asString(row.place_id),
      raw: row,
    };
  } catch (err) {
    logSilentFailure('Reverse geocode', err);
    return null;
  }
}

/**
 * Free-text address → coordinates (the "type an address, move the pin" path). Resolves `null` on a
 * non-OK status and on every failure (logged); never throws.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const query = address.trim();
  if (!query) return null;
  try {
    const response = await apiFetch<GoogleGeocodeResponse>(
      `/api/places/geocode?address=${encodeURIComponent(query)}`,
    );
    const row = firstResult(response);
    if (!row) {
      noteStatus('Geocode address', response);
      return null;
    }
    const lat = asNumber(row.geometry?.location?.lat);
    const lng = asNumber(row.geometry?.location?.lng);
    if (lat === undefined || lng === undefined) return null;
    return {
      lat,
      lng,
      formatted_address: asString(row.formatted_address) ?? query,
      place_id: asString(row.place_id),
      components: extractComponents(componentsOf(row)),
      raw: row,
    };
  } catch (err) {
    logSilentFailure('Geocode address', err);
    return null;
  }
}

/**
 * Places Autocomplete. Resolves `[]` for an empty input, `ZERO_RESULTS`, a non-OK status (logged) and on
 * every failure (logged) — a search box must never throw while the user types. Pass the same
 * `sessionToken` to the `placeDetails` call that ends the search.
 */
export async function autocomplete(input: string, sessionToken?: string): Promise<AutocompletePrediction[]> {
  const query = input.trim();
  if (!query) return [];
  try {
    const params = new URLSearchParams({ input: query });
    if (sessionToken) params.set('sessiontoken', sessionToken);
    const response = await apiFetch<GoogleAutocompleteResponse>(`/api/places/autocomplete?${params.toString()}`);
    if (asString(response.status) !== 'OK' || !Array.isArray(response.predictions)) {
      noteStatus('Places autocomplete', response);
      return [];
    }
    const out: AutocompletePrediction[] = [];
    for (const item of response.predictions) {
      const p = asRecord(item);
      if (!p) continue;
      const placeId = asString(p.place_id);
      const description = asString(p.description);
      if (!placeId || !description) continue;
      const sf = asRecord(p.structured_formatting);
      out.push({
        place_id: placeId,
        description,
        structured_formatting: sf
          ? { main_text: asString(sf.main_text), secondary_text: asString(sf.secondary_text) }
          : undefined,
      });
    }
    return out;
  } catch (err) {
    logSilentFailure('Places autocomplete', err);
    return [];
  }
}

/**
 * Place Details for a prediction. Resolves `null` when Google answers without a usable row or without
 * coordinates (logged). Network / server failures THROW the `apiFetch` message — this is a tap-driven
 * action with a visible outcome, so the screen shows `err.message` (MAP §2.6 #25).
 */
export async function placeDetails(placeId: string, sessionToken?: string): Promise<PlaceDetails | null> {
  const params = new URLSearchParams({ place_id: placeId });
  if (sessionToken) params.set('sessiontoken', sessionToken);
  const response = await apiFetch<GooglePlaceDetailsResponse>(`/api/places/details?${params.toString()}`);
  const row = asRecord(response.result) as GoogleGeocodeRow | null;
  if (asString(response.status) !== 'OK' || !row) {
    noteStatus('Place details', response);
    return null;
  }
  const lat = asNumber(row.geometry?.location?.lat);
  const lng = asNumber(row.geometry?.location?.lng);
  if (lat === undefined || lng === undefined) {
    logSilentFailure('Place details', `no coordinates for ${placeId}`);
    return null;
  }
  const components = componentsOf(row);
  return {
    place_id: asString(row.place_id) ?? placeId,
    formatted_address: asString(row.formatted_address) ?? asString(row.name) ?? '',
    geometry: { location: { lat, lng } },
    address_components: components,
    components: extractComponents(components),
    raw: row,
  };
}
