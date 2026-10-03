// codename: indigo
/**
 * Dev-flag registry + store (DECISIONS D1/D2, CONTRACTS §2.2, design §4.7).
 *
 * The registry is ONE `as const` object; the panel renders the right control from `type`. Every
 * control is `Dev_<Feature>_inhibit_<Target>`; every codename has a `_inhibit_Feature` master
 * (false = feature ON). Values are read with `getDevFlag()` in handlers/effects/module code and
 * `useDevFlag()` in render.
 *
 * Flags only bite while UNLOCKED: `getDevFlag()` returns the registry default while locked, so a
 * store build carrying a stale `nn:dev:flags` blob behaves exactly like production. There is
 * deliberately NO `__DEV__` bypass anywhere in this module.
 *
 * Storage (device-scoped, never cleared in `clearStoredSession()` — MAP §7.14): `nn:dev:flags`
 * (JSON blob of non-default values), `nn:dev:unlocked` ('true'), `nn:dev:lockoutUntil` (ms epoch),
 * `nn:dev:wrongCount` (wrong PINs since the last lockout / success, so a relaunch cannot reset the 3-strike rule).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { getAppExtra } from './appExtra';
import { logSilentFailure } from './logSilentFailure';

export type DevFlagArea =
  | 'Boreal' | 'Onyx' | 'Motion' | 'Sirius' | 'Indigo' | 'Vulcan' | 'Altair' | 'Rigel' | 'Cyan' | 'Antares' | 'Lyra'
  | 'Deneb' | 'Orion' | 'Vega' | 'Pavo' | 'Nova' | 'Mira' | 'Capella' | 'Atlas' | 'Amber' | 'Cobalt' | 'Quartz'
  | 'Tango' | 'Cinder' | 'Juno' | 'Kepler' | 'Halley' | 'Zephyr'
  | 'Network' | 'Cache' | 'Location' | 'Home' | 'Search' | 'Category' | 'Cart' | 'Checkout' | 'Orders'
  | 'Tracking' | 'Payment' | 'Wallet' | 'Images' | 'Push' | 'Auth' | 'Shell' | 'Perf';

type FlagBase = { area: DevFlagArea; label: string; help: string; simulates?: true; restart?: true };
export type BoolFlagDef = FlagBase & { type: 'bool'; default: boolean };
export type NumberFlagDef = FlagBase & { type: 'number'; default: number; min: number; max: number; step?: number; presets?: readonly number[] };
export type EnumFlagDef<V extends readonly string[] = readonly string[]> = FlagBase & { type: 'enum'; values: V; default: V[number] };
export type StringFlagDef = FlagBase & { type: 'string'; default: string; placeholder?: string; validate?: RegExp };
export type DevFlagDef = BoolFlagDef | NumberFlagDef | EnumFlagDef | StringFlagDef;

// D1: every control is `Dev_<Feature>_inhibit_<Target>`; every codename has a `_inhibit_Feature` master (false = feature ON).
// Declared `as const satisfies …` — NEVER with a `: Record<…>` annotation (that widens the literals and breaks DevFlagValue).
export const DEV_FLAGS = {
  // ── Master switches: one per shipped codename (bool, default false = feature ON) ──
  Dev_Boreal_inhibit_Feature:  { area: 'Boreal',  type: 'bool', default: false, label: 'Palette (no runtime effect)', help: 'Palette is compile-time; registered for completeness' },
  Dev_Onyx_inhibit_Feature:    { area: 'Onyx',    type: 'bool', default: false, label: 'Turn off the motion layer', help: 'Animations off + press scale off + shimmer off', simulates: true },
  Dev_Sirius_inhibit_Feature:  { area: 'Sirius',  type: 'bool', default: false, label: 'Turn off all haptics and sounds', help: 'Master; user prefs ignored' },
  Dev_Indigo_inhibit_Feature:  { area: 'Indigo',  type: 'bool', default: false, label: 'Hide dev pill and stripe', help: 'Panel stays reachable via shake / long-press' },
  Dev_Vulcan_inhibit_Feature:  { area: 'Vulcan',  type: 'bool', default: false, label: 'Toasts fall back to Alert', help: 'notify() calls Alert.alert instead' },
  Dev_Altair_inhibit_Feature:  { area: 'Altair',  type: 'bool', default: false, label: 'Plain modal sheets', help: 'BottomSheet renders RN Modal slide, no pan/spring' },
  Dev_Rigel_inhibit_Feature:   { area: 'Rigel',   type: 'bool', default: false, label: 'Legacy stepper', help: 'Instant ADD/stepper swap, no roll, minus instead of bin' },
  Dev_Cyan_inhibit_Feature:    { area: 'Cyan',    type: 'bool', default: false, label: 'Hide the cart bar', help: 'CartBar never renders' },
  Dev_Antares_inhibit_Feature: { area: 'Antares', type: 'bool', default: false, label: 'Hide delivery ETA', help: 'useDeliveryEta() returns state none everywhere' },
  Dev_Lyra_inhibit_Feature:    { area: 'Lyra',    type: 'bool', default: false, label: 'Legacy search', help: 'No rotation, recents, local results, chips or count' },
  Dev_Deneb_inhibit_Feature:   { area: 'Deneb',   type: 'bool', default: false, label: 'Hide promo banners', help: 'banners item kind not rendered on Home' },
  Dev_Orion_inhibit_Feature:   { area: 'Orion',   type: 'bool', default: false, label: 'Legacy product page', help: 'No similar rail, instant paint, share or View-cart strip' },
  Dev_Vega_inhibit_Feature:    { area: 'Vega',    type: 'bool', default: false, label: 'Legacy orders list', help: 'No segments, Reorder, focus refresh or poll' },
  Dev_Pavo_inhibit_Feature:    { area: 'Pavo',    type: 'bool', default: false, label: 'Plain rating flow', help: 'No thank-you state or star stagger' },
  Dev_Nova_inhibit_Feature:    { area: 'Nova',    type: 'bool', default: false, label: 'Quiet order confirmation', help: 'Static check; explicit pay button is kept' },
  Dev_Mira_inhibit_Feature:    { area: 'Mira',    type: 'bool', default: false, label: 'Legacy tracking hero', help: '"Estimated delivery by HH:MM" instead of countdown + progress' },
  Dev_Capella_inhibit_Feature: { area: 'Capella', type: 'bool', default: false, label: 'Quiet wallet', help: 'No count-up, coin or delta chip' },
  Dev_Atlas_inhibit_Feature:   { area: 'Atlas',   type: 'bool', default: false, label: 'Account only on Home', help: 'Avatar hidden on other tabs; version row hidden' },
  Dev_Amber_inhibit_Feature:   { area: 'Amber',   type: 'bool', default: false, label: 'Plain tab bar', help: 'No icon pop or haptic' },
  Dev_Cobalt_inhibit_Feature:  { area: 'Cobalt',  type: 'bool', default: false, label: 'Disable offline layer', help: 'No banner, reconnect refetch or Pay guard' },
  Dev_Quartz_inhibit_Feature:  { area: 'Quartz',  type: 'bool', default: false, label: 'Legacy map picker', help: 'Draggable marker instead of centre pin; returnTo kept' },
  Dev_Tango_inhibit_Feature:   { area: 'Tango',   type: 'bool', default: false, label: 'Flat notifications', help: 'No day groups, swipe or unread dot' },
  Dev_Cinder_inhibit_Feature:  { area: 'Cinder',  type: 'bool', default: false, label: 'Legacy checkout validation', help: 'Alert summary instead of inline; plain remove' },
  Dev_Juno_inhibit_Feature:    { area: 'Juno',    type: 'bool', default: false, label: 'Plain coupons', help: 'No promo input or best-coupon row' },
  Dev_Kepler_inhibit_Feature:  { area: 'Kepler',  type: 'bool', default: false, label: 'Bypass data-layer caches', help: 'queryCache, instant nearby, token memo, price drift all off', simulates: true },
  Dev_Halley_inhibit_Feature:  { area: 'Halley',  type: 'bool', default: false, label: 'Hide wishlist hearts', help: 'Hearts hidden on PDP; wishlist screen still works' },
  Dev_Zephyr_inhibit_Feature:  { area: 'Zephyr',  type: 'bool', default: false, label: 'Default route transitions', help: 'No slide/modal config; welcome not tappable (read live — no restart)' },

  // ── Sirius ──
  Dev_Sirius_inhibit_Sounds:          { area: 'Sirius', type: 'bool', default: false, label: 'Mute UI sounds', help: 'Haptics unaffected' },
  Dev_Sirius_inhibit_Haptics:         { area: 'Sirius', type: 'bool', default: false, label: 'Disable haptics', help: 'Sounds unaffected' },
  Dev_Sirius_inhibit_PassiveFeedback: { area: 'Sirius', type: 'bool', default: false, label: 'Silence non-gesture feedback', help: 'Status advance, delivered, offline' },
  Dev_Sirius_inhibit_Throttle:        { area: 'Sirius', type: 'bool', default: false, label: 'Disable anti-spam windows', help: 'Hear every event; debugging only' },
  Dev_Sirius_inhibit_SilentSwitch:    { area: 'Sirius', type: 'bool', default: false, label: 'Play sounds in iOS silent mode', help: 'Re-applies audio mode; iOS only' },
  Dev_Sirius_inhibit_VolumeLevel:     { area: 'Sirius', type: 'number', default: 0.7, min: 0, max: 1, step: 0.1, presets: [0, 0.3, 0.7, 1], label: 'UI sound volume', help: 'Scales every player' },
  Dev_Sirius_inhibit_EventTrace:      { area: 'Sirius', type: 'enum', values: ['off', 'toast', 'console'], default: 'off', label: 'Trace feedback events', help: 'Shows kind + source on every call' },
  // ── Onyx / Motion ──
  Dev_Onyx_inhibit_Animations:        { area: 'Onyx', type: 'bool', default: false, label: 'Reduce motion (force)', help: 'ReducedMotionConfig Always', simulates: true },
  Dev_Onyx_inhibit_SystemReduceMotion:{ area: 'Onyx', type: 'bool', default: false, label: 'Ignore OS reduce-motion', help: 'Full motion on an a11y device' },
  Dev_Onyx_inhibit_PressScale:        { area: 'Onyx', type: 'bool', default: false, label: 'Disable press scale', help: 'Pressed background stays' },
  Dev_Onyx_inhibit_Shimmer:           { area: 'Onyx', type: 'bool', default: false, label: 'Freeze skeleton shimmer', help: 'Static skeletonLo' },
  Dev_Onyx_inhibit_SkeletonExit:      { area: 'Onyx', type: 'bool', default: false, label: 'Keep skeletons on screen', help: 'Every screen stays in its loading layout', simulates: true },
  Dev_Onyx_inhibit_LayoutTransitions: { area: 'Onyx', type: 'bool', default: false, label: 'Disable layout transitions', help: 'Collapsible / stepper / toast stack snap' },
  Dev_Motion_inhibit_SpeedFactor:     { area: 'Motion', type: 'number', default: 1, min: 1, max: 10, step: 1, presets: [1, 2, 4, 8], label: 'Slow all animations', help: 'Durations × f; springs reshaped (k/f², c/f)', simulates: true },
  // ── Indigo ──
  Dev_Indigo_inhibit_FloatingPill:     { area: 'Indigo', type: 'bool', default: false, label: 'Hide the DEV pill', help: 'Shake / long-press still open the panel' },
  Dev_Indigo_inhibit_ShakeOpen:        { area: 'Indigo', type: 'bool', default: false, label: 'Disable shake-to-open while unlocked', help: 'Bumpy commute mode' },
  Dev_Indigo_inhibit_SimulationStripe: { area: 'Indigo', type: 'bool', default: false, label: 'Hide the amber simulation stripe', help: 'Stripe otherwise shows while any simulates flag is non-default' },
  // ── Vulcan ──
  Dev_Vulcan_inhibit_AutoDismiss:  { area: 'Vulcan', type: 'bool', default: false, label: 'Toasts stay until swiped', help: 'For screenshots' },
  Dev_Vulcan_inhibit_SwipeDismiss: { area: 'Vulcan', type: 'bool', default: false, label: 'Disable toast swipe', help: 'Toasts leave only by timer or their action' },
  // ── Altair ──
  Dev_Altair_inhibit_PanDismiss: { area: 'Altair', type: 'bool', default: false, label: 'Disable sheet pan-to-dismiss', help: 'Scrim tap / back still close' },
  // ── Rigel ──
  Dev_Rigel_inhibit_Morph:     { area: 'Rigel', type: 'bool', default: false, label: 'Disable ADD → stepper morph', help: 'Instant swap' },
  Dev_Rigel_inhibit_DigitRoll: { area: 'Rigel', type: 'bool', default: false, label: 'Disable quantity digit roll', help: 'Quantity snaps instead of rolling' },
  Dev_Rigel_inhibit_TrashAtMin:{ area: 'Rigel', type: 'bool', default: false, label: 'Minus instead of bin at min qty', help: 'Minus glyph stays at qty 1; removal still works' },
  // ── Cyan ──
  Dev_Cyan_inhibit_Bounce:     { area: 'Cyan', type: 'bool', default: false, label: 'Disable CartBar bounce', help: 'No scale pop when the count increases' },
  Dev_Cyan_inhibit_Thumbnails: { area: 'Cyan', type: 'bool', default: false, label: 'Hide CartBar thumbnails', help: 'Text-only bar; height stays 56 px' },
  Dev_Cyan_inhibit_EtaChip:    { area: 'Cyan', type: 'bool', default: false, label: 'Hide ETA chip in CartBar', help: 'Removes the lightning chip from the bar' },
  // ── Antares ──
  Dev_Antares_inhibit_EtaMinutes: { area: 'Antares', type: 'number', default: 0, min: 0, max: 120, step: 1, presets: [0, 8, 12, 25, 45], label: 'Force ETA minutes', help: '0 = computed from nearest store', simulates: true },
  Dev_Antares_inhibit_StoreOpen:  { area: 'Antares', type: 'bool', default: false, label: 'Force store-closed state', help: 'Every ETA surface shows the closed copy; Pay stays enabled', simulates: true },
  Dev_Antares_inhibit_Ticker:     { area: 'Antares', type: 'bool', default: false, label: 'Freeze ETA digit roll', help: 'Number still updates' },
  // ── Lyra ──
  Dev_Lyra_inhibit_PlaceholderRotation: { area: 'Lyra', type: 'bool', default: false, label: 'Static search placeholder', help: 'Band shows "Search for milk, bread…"' },
  Dev_Lyra_inhibit_RecentSearches:      { area: 'Lyra', type: 'bool', default: false, label: 'Hide recent searches', help: 'Recents not stored or shown' },
  Dev_Lyra_inhibit_LocalResults:        { area: 'Lyra', type: 'bool', default: false, label: 'Server-only search results', help: 'Disables local-first results' },
  // ── Deneb ──
  Dev_Deneb_inhibit_AutoAdvance:   { area: 'Deneb', type: 'bool', default: false, label: 'Disable banner auto-advance', help: 'Carousel moves only by swipe' },
  Dev_Deneb_inhibit_RemoteBanners: { area: 'Deneb', type: 'bool', default: false, label: 'Local banners only', help: 'Skips the optional Supabase read' },
  // ── Orion ──
  Dev_Orion_inhibit_SimilarRail:  { area: 'Orion', type: 'bool', default: false, label: 'Hide similar products rail', help: 'PDP ends after the about block' },
  Dev_Orion_inhibit_InstantPaint: { area: 'Orion', type: 'bool', default: false, label: 'PDP ignores memory seed', help: 'Skeleton path every open', simulates: true },
  // ── Vega ──
  Dev_Vega_inhibit_ActivePoll: { area: 'Vega', type: 'bool', default: false, label: 'Disable orders poll', help: 'No 20 s poll while active orders exist' },
  Dev_Vega_inhibit_Reorder:    { area: 'Vega', type: 'bool', default: false, label: 'Hide Reorder buttons', help: 'Orders list, order detail and Order again lose the button' },
  // ── Pavo ──
  Dev_Pavo_inhibit_ThankYouState: { area: 'Pavo', type: 'bool', default: false, label: 'Skip thank-you state', help: 'Returns immediately after submit' },
  Dev_Pavo_inhibit_StarStagger:   { area: 'Pavo', type: 'bool', default: false, label: 'Disable star fill stagger', help: 'Stars fill instantly; select haptic stays' },
  // ── Nova ──
  Dev_Nova_inhibit_Confetti: { area: 'Nova', type: 'bool', default: false, label: 'Disable confetti', help: 'Check pop and chime unaffected' },
  Dev_Nova_inhibit_CheckPop: { area: 'Nova', type: 'bool', default: false, label: 'Disable check pop + ring', help: 'Check appears at scale 1; confetti unaffected' },
  Dev_Nova_inhibit_Chime:    { area: 'Nova', type: 'bool', default: false, label: 'Disable order-placed chime', help: 'Haptic stays' },
  // ── Mira ──
  Dev_Mira_inhibit_ProgressBar: { area: 'Mira', type: 'bool', default: false, label: 'Hide tracking progress bar', help: 'Hero keeps the minutes and status copy' },
  // ── Capella ──
  Dev_Capella_inhibit_CountUp: { area: 'Capella', type: 'bool', default: false, label: 'Disable wallet count-up', help: 'Balance snaps after top-up; coin and delta chip stay' },
  // ── Atlas ──
  Dev_Atlas_inhibit_UnreadDot: { area: 'Atlas', type: 'bool', default: false, label: 'Hide unread dot on avatar', help: 'Avatar and ProfileMenu row show no dot; count still fetched' },
  // ── Amber ──
  Dev_Amber_inhibit_TabPop:    { area: 'Amber', type: 'bool', default: false, label: 'Disable tab icon pop', help: 'Haptic stays' },
  // ── Cobalt ──
  Dev_Cobalt_inhibit_ReconnectRefetch: { area: 'Cobalt', type: 'bool', default: false, label: 'Disable refetch on reconnect', help: 'Screens keep stale data until pull-to-refresh' },
  // ── Quartz ──
  Dev_Quartz_inhibit_ReverseGeocode: { area: 'Quartz', type: 'bool', default: false, label: 'Skip reverse geocode on settle', help: 'Address stays "Pinned location"', simulates: true },
  // ── Tango ──
  Dev_Tango_inhibit_SwipeDismiss: { area: 'Tango', type: 'bool', default: false, label: 'Disable notification swipe', help: 'Rows only open; dismiss unavailable' },
  // ── Cinder ──
  Dev_Cinder_inhibit_InlineValidation: { area: 'Cinder', type: 'bool', default: false, label: 'Alert-based checkout validation', help: 'Pay shows the legacy Alert summary instead of inline errors' },
  Dev_Cinder_inhibit_UndoRemove:       { area: 'Cinder', type: 'bool', default: false, label: 'Remove without Undo', help: 'Removed cart lines cannot be restored from the toast' },
  // ── Juno ──
  Dev_Juno_inhibit_PromoInput: { area: 'Juno', type: 'bool', default: false, label: 'Hide promo-code input', help: 'Coupons screen lists only; best-coupon row stays' },
  // ── Kepler ──
  Dev_Kepler_inhibit_QueryCache:    { area: 'Kepler', type: 'bool', default: false, label: 'Bypass queryCache', help: 'cached() always runs the fetcher', simulates: true },
  Dev_Kepler_inhibit_InstantNearby: { area: 'Kepler', type: 'bool', default: false, label: 'Disable in-memory nearby view', help: 'Network path runs on every location change', simulates: true },
  Dev_Kepler_inhibit_TokenMemo:     { area: 'Kepler', type: 'bool', default: false, label: 'Read token from SecureStore every call', help: 'Reproduces the pre-kepler Keystore cost', simulates: true },
  // ── Halley ──
  Dev_Halley_inhibit_HeartPop: { area: 'Halley', type: 'bool', default: false, label: 'Disable heart pop', help: 'Heart fills without the spring; toggle feedback stays' },
  // ── Zephyr ──
  Dev_Zephyr_inhibit_WelcomeInterstitial: { area: 'Zephyr', type: 'bool', default: false, label: 'Skip the welcome screen', help: 'OTP → Home directly', simulates: true },
  Dev_Zephyr_inhibit_Transitions:         { area: 'Zephyr', type: 'bool', default: false, label: 'Disable route transitions', help: 'animation: none (read live via useDevFlag — no restart)' },
  // ── Network ──
  Dev_Network_inhibit_Offline:    { area: 'Network', type: 'bool', default: false, label: 'Pretend the device is offline', help: 'Every apiFetch + Supabase call throws the offline message; banner shows', simulates: true },
  Dev_Network_inhibit_LatencyMs:  { area: 'Network', type: 'number', default: 0, min: 0, max: 10000, step: 100, presets: [0, 300, 1500, 5000], label: 'Add request latency (ms)', help: 'Both transports', simulates: true },
  Dev_Network_inhibit_FailRate:   { area: 'Network', type: 'number', default: 0, min: 0, max: 1, step: 0.1, presets: [0, 0.2, 0.5, 1], label: 'Random request failure rate', help: 'Throws "Server error…"', simulates: true },
  Dev_Network_inhibit_Force500:   { area: 'Network', type: 'bool', default: false, label: 'Treat every backend response as 500', help: 'Status forced after the real fetch resolves; Supabase unaffected', simulates: true },
  Dev_Network_inhibit_TimeoutMs:  { area: 'Network', type: 'number', default: 0, min: 0, max: 30000, step: 500, presets: [0, 1000, 3000, 8000], label: 'Override request timeout (ms)', help: '0 = per-call default', simulates: true },
  Dev_Network_inhibit_ApiBaseUrl: { area: 'Network', type: 'string', default: '', placeholder: 'https://staging.example.com', validate: /^https?:\/\/.+/, label: 'API base URL override', help: 'Empty = env/extra default', simulates: true, restart: true },
  // ── Cache ──
  Dev_Cache_inhibit_HomeCatalog: { area: 'Cache', type: 'bool', default: false, label: 'Ignore the home catalog disk cache', help: 'Cold path every launch', simulates: true },
  Dev_Cache_inhibit_Orders:      { area: 'Cache', type: 'bool', default: false, label: 'Ignore the orders disk cache', help: 'readUserOrdersCache → null; network path on every open', simulates: true },
  Dev_Cache_inhibit_Addresses:   { area: 'Cache', type: 'bool', default: false, label: 'Ignore the addresses disk cache', help: 'readAddressesCache → null; network path on every open', simulates: true },
  // ── Location ──
  Dev_Location_inhibit_Gps:            { area: 'Location', type: 'bool', default: false, label: 'GPS requests fail', help: 'getCurrentPositionAsync rejects → denied states', simulates: true },
  Dev_Location_inhibit_LatLngOverride: { area: 'Location', type: 'string', default: '', placeholder: '22.5726, 88.3639', validate: /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/, label: 'Override active coordinates', help: 'lat,lng — applied to the active location', simulates: true },
  Dev_Location_inhibit_NearbyFilter:   { area: 'Location', type: 'bool', default: false, label: 'Bypass the 4 km radius filter', help: 'Platform-wide catalog (dev only)', simulates: true },
  // ── Home ──
  Dev_Home_inhibit_TileCap:        { area: 'Home', type: 'bool', default: false, label: 'Show every category tile', help: 'Disables the 8 + All cap' },
  Dev_Home_inhibit_Rails:          { area: 'Home', type: 'bool', default: false, label: 'Legacy 2×3 product blocks', help: 'Instead of horizontal rails' },
  Dev_Home_inhibit_NoStoresNearby: { area: 'Home', type: 'bool', default: false, label: 'Simulate no stores nearby', help: 'Nearby filter resolves to empty', simulates: true },
  Dev_Home_inhibit_Catalog:        { area: 'Home', type: 'bool', default: false, label: 'Simulate empty catalog', help: 'loadMasterCatalog* resolve to []', simulates: true },
  // ── Search / Category ──
  Dev_Search_inhibit_ForceError:  { area: 'Search', type: 'bool', default: false, label: 'Force search error', help: 'searchProducts throws', simulates: true },
  Dev_Category_inhibit_SortChips: { area: 'Category', type: 'bool', default: false, label: 'Hide sort chips on category page', help: 'Server order only' },
  // ── Cart / Checkout ──
  Dev_Cart_inhibit_SimulateEmpty:    { area: 'Cart', type: 'bool', default: false, label: 'Cart reads as empty', help: 'Persisted cart untouched', simulates: true },
  Dev_Cart_inhibit_Persist:          { area: 'Cart', type: 'bool', default: false, label: 'Do not persist cart changes', help: 'Cart resets on the next cold start', simulates: true },
  Dev_Checkout_inhibit_RecoNetwork:  { area: 'Checkout', type: 'bool', default: false, label: 'Hide "Did you forget?" rail', help: 'Skips its fetch', simulates: true },
  Dev_Checkout_inhibit_PriceDrift:   { area: 'Checkout', type: 'bool', default: false, label: 'Simulate a price change', help: 'First cart item reported +₹1 → "Prices updated" row', simulates: true },
  // ── Orders / Tracking ──
  Dev_Orders_inhibit_SimulateActive: { area: 'Orders', type: 'bool', default: false, label: 'Inject a synthetic active order', help: 'Home banner + Orders Active segment', simulates: true },
  Dev_Orders_inhibit_History:        { area: 'Orders', type: 'bool', default: false, label: 'Simulate no order history', help: 'getUserOrders → []', simulates: true },
  Dev_Tracking_inhibit_SyntheticStatus: { area: 'Tracking', type: 'enum', values: ['off', 'pending_at_store', 'preparing_order', 'order_picked_up', 'in_transit', 'order_delivered', 'order_cancelled'], default: 'off', label: 'Synthetic tracking status', help: 'No network; a fake snapshot at this status', simulates: true },
  Dev_Tracking_inhibit_PollMs:          { area: 'Tracking', type: 'number', default: 0, min: 0, max: 60000, step: 1000, presets: [0, 2000, 5000, 15000], label: 'Force tracking poll interval (ms)', help: '0 = adaptive', simulates: true },
  // ── Payment / Wallet ──
  Dev_Payment_inhibit_GatewayResult:    { area: 'Payment', type: 'enum', values: ['off', 'paid', 'failed', 'cancelled', 'unverified'], default: 'off', label: 'Force payment result', help: 'Order row is still created; failed/cancelled void it; paid/unverified leave it pending — use a test account', simulates: true },
  Dev_Payment_inhibit_PersistSelection: { area: 'Payment', type: 'bool', default: false, label: 'Forget payment method on restart', help: 'Defaults to "Other UPI apps" on each launch' },
  Dev_Payment_inhibit_OverlayDelayMs:   { area: 'Payment', type: 'number', default: 0, min: 0, max: 60000, step: 1000, presets: [0, 5000, 16000, 40000], label: 'Hold the processing overlay (ms)', help: 'Tests the 15 s escalation', simulates: true },
  Dev_Wallet_inhibit_FakeBalance:  { area: 'Wallet', type: 'number', default: -1, min: -1, max: 100000, step: 50, presets: [-1, 0, 50, 500, 5000], label: 'Fake wallet balance', help: '−1 = off', simulates: true },
  Dev_Wallet_inhibit_TopupGateway: { area: 'Wallet', type: 'bool', default: false, label: 'Top-up skips Razorpay', help: 'Verify resolves balance + amount', simulates: true },
  Dev_Wallet_inhibit_Transactions: { area: 'Wallet', type: 'bool', default: false, label: 'Simulate no wallet transactions', help: 'getWalletTransactions resolves []', simulates: true },
  // ── Images / Push / Auth / Shell / Perf ──
  Dev_Images_inhibit_CdnProxy:   { area: 'Images', type: 'bool', default: false, label: 'Bypass the image CDN proxy', help: 'Raw origin URLs', simulates: true },
  Dev_Images_inhibit_Prefetch:   { area: 'Images', type: 'bool', default: false, label: 'Disable image prefetch', help: 'Boot + press-in prefetch off' },
  Dev_Push_inhibit_Registration: { area: 'Push', type: 'bool', default: false, label: 'Skip push registration', help: 'No permission prompt or token upload', simulates: true },
  Dev_Auth_inhibit_EmailVerify:  { area: 'Auth', type: 'bool', default: false, label: 'Skip email verification UI', help: 'Profile hides the verify block', simulates: true },
  Dev_Shell_inhibit_BackToExitToast: { area: 'Shell', type: 'bool', default: false, label: 'Back exits immediately on Home', help: 'No "press again" toast' },
  Dev_Perf_inhibit_NetworkLog:     { area: 'Perf', type: 'bool', default: false, label: 'Record the last 50 requests', help: 'Shown in the panel Session tab' },
  Dev_Perf_inhibit_BootTimeline:   { area: 'Perf', type: 'bool', default: false, label: 'Record boot marks', help: 'module-eval, auth-ready, fonts-ready, nav-ready, home-first-paint, catalog-painted' },
  Dev_Perf_inhibit_SlowLoadHintMs: { area: 'Perf', type: 'number', default: 8000, min: 1000, max: 30000, step: 1000, presets: [2000, 8000, 15000], label: 'Slow-load hint delay (ms)', help: 'When "Still loading…" appears under a skeleton' },
} as const satisfies Record<`Dev_${string}_inhibit_${string}`, DevFlagDef>;

export type DevFlagName = keyof typeof DEV_FLAGS;
export type DevFlagValue<K extends DevFlagName> =
  (typeof DEV_FLAGS)[K] extends { type: 'bool' } ? boolean
  : (typeof DEV_FLAGS)[K] extends { type: 'number' } ? number
  : (typeof DEV_FLAGS)[K] extends { type: 'enum'; values: infer V extends readonly string[] } ? V[number]
  : string;

/** Sirius, Onyx, Motion, Indigo, then codenames A–Z, then areas (in registry order). */
export const DEV_FLAG_AREA_ORDER: readonly DevFlagArea[] = [
  'Sirius', 'Onyx', 'Motion', 'Indigo',
  'Altair', 'Amber', 'Antares', 'Atlas', 'Boreal', 'Capella', 'Cinder', 'Cobalt', 'Cyan', 'Deneb', 'Halley', 'Juno',
  'Kepler', 'Lyra', 'Mira', 'Nova', 'Orion', 'Pavo', 'Quartz', 'Rigel', 'Tango', 'Vega', 'Vulcan', 'Zephyr',
  'Network', 'Cache', 'Location', 'Home', 'Search', 'Category', 'Cart', 'Checkout', 'Orders', 'Tracking', 'Payment',
  'Wallet', 'Images', 'Push', 'Auth', 'Shell', 'Perf',
];

export const DEV_PIN_FALLBACK = '7391';

export const DEV_STORAGE_KEYS = {
  flags: 'nn:dev:flags',
  unlocked: 'nn:dev:unlocked',
  lockoutUntil: 'nn:dev:lockoutUntil',
  wrongCount: 'nn:dev:wrongCount',
  pill: 'nn:dev:pill',
} as const;

// ─── Store state ───

type FlagPrimitive = boolean | number | string;

/** Only NON-default values live here (so `getChangedFlags()` is the key set). */
let values: Partial<Record<DevFlagName, FlagPrimitive>> = {};
let unlocked = false;
/** ms epoch; 0 when no lockout. */
let lockoutUntil = 0;
/** Wrong PINs since the last lockout / success — persisted in `nn:dev:wrongCount` (hydrated by `loadDevFlags`). */
let wrongCount = 0;
let loadPromise: Promise<void> | null = null;
const subscribers = new Set<() => void>();

const LOCKOUT_MS = 30_000;
const MAX_WRONG_PINS = 3;
const PERSIST_DEBOUNCE_MS = 150;

const FLAG_NAMES = Object.keys(DEV_FLAGS) as DevFlagName[];

function notify(): void {
  subscribers.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      logSilentFailure('DevFlags.notify', err);
    }
  });
}

function isFlagName(name: string): name is DevFlagName {
  return Object.prototype.hasOwnProperty.call(DEV_FLAGS, name);
}

function defOf(name: DevFlagName): DevFlagDef {
  return DEV_FLAGS[name];
}

// ─── Validation ───

type Validation = { ok: true; value: FlagPrimitive } | { ok: false; reason: string };

/**
 * Validates a raw value against its definition. Numbers are CLAMPED to [min, max] (numeric strings
 * accepted); bool / enum / string failures are rejected with a one-line reason the panel shows inline.
 * The empty string always passes a string flag (it is every string flag's "off" default).
 */
function validateValue(name: DevFlagName, raw: unknown): Validation {
  const def = defOf(name);
  switch (def.type) {
    case 'bool':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, reason: 'Expected true or false' };
    case 'number': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        return { ok: false, reason: `Expected a number between ${def.min} and ${def.max}` };
      }
      return { ok: true, value: Math.min(def.max, Math.max(def.min, n)) };
    }
    case 'enum':
      return typeof raw === 'string' && def.values.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, reason: `Expected one of ${def.values.join(', ')}` };
    case 'string': {
      if (typeof raw !== 'string') return { ok: false, reason: 'Expected text' };
      if (raw !== '' && def.validate && !def.validate.test(raw)) {
        return { ok: false, reason: `Expected the format ${def.placeholder ?? def.validate.source}` };
      }
      return { ok: true, value: raw };
    }
  }
}

/** Writes into `values` (deleting when equal to the default). Returns whether anything changed. */
function applyValue(name: DevFlagName, value: FlagPrimitive): boolean {
  const def = defOf(name);
  if (value === def.default) {
    if (!(name in values)) return false;
    delete values[name];
    return true;
  }
  if (values[name] === value) return false;
  values[name] = value;
  return true;
}

// ─── Persistence ───

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistWaiters: (() => void)[] = [];

async function flushPersist(): Promise<void> {
  const waiters = persistWaiters;
  persistWaiters = [];
  try {
    if (Object.keys(values).length === 0) await AsyncStorage.removeItem(DEV_STORAGE_KEYS.flags);
    else await AsyncStorage.setItem(DEV_STORAGE_KEYS.flags, JSON.stringify(values));
  } catch (err) {
    logSilentFailure('DevFlags.persist', err);
  }
  waiters.forEach((resolve) => resolve());
}

/** Debounced (150 ms) write of the whole blob; resolves once the write that covers this call settles. */
function schedulePersist(): Promise<void> {
  return new Promise<void>((resolve) => {
    persistWaiters.push(resolve);
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  });
}

function cancelPendingPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const waiters = persistWaiters;
  persistWaiters = [];
  waiters.forEach((resolve) => resolve());
}

async function safeSet(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (err) {
    logSilentFailure('DevFlags.set', err);
  }
}

async function safeRemove(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove(keys);
  } catch (err) {
    logSilentFailure('DevFlags.remove', err);
  }
}

function parseBlob(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ─── Hydration ───

/**
 * Hydrates flags + unlocked + lockout from AsyncStorage. Idempotent (one shared promise); called at
 * app/_layout.tsx module scope. Unknown keys are dropped, every value is validated against its
 * definition, and a value set in-session before hydration finished wins over the disk blob.
 */
export function loadDevFlags(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const rows = await AsyncStorage.multiGet([
          DEV_STORAGE_KEYS.flags,
          DEV_STORAGE_KEYS.unlocked,
          DEV_STORAGE_KEYS.lockoutUntil,
          DEV_STORAGE_KEYS.wrongCount,
        ]);
        const byKey = new Map<string, string | null>(rows);
        const blob = parseBlob(byKey.get(DEV_STORAGE_KEYS.flags) ?? null);
        for (const [name, raw] of Object.entries(blob)) {
          if (!isFlagName(name) || name in values) continue;
          const v = validateValue(name, raw);
          if (v.ok) applyValue(name, v.value);
        }
        if (byKey.get(DEV_STORAGE_KEYS.unlocked) === 'true') unlocked = true;
        const until = Number(byKey.get(DEV_STORAGE_KEYS.lockoutUntil) ?? 0);
        if (Number.isFinite(until) && until > Date.now()) lockoutUntil = until;
        // In-session wrong attempts made before hydration finished are kept (max), capped below the lockout threshold.
        const wrong = Number(byKey.get(DEV_STORAGE_KEYS.wrongCount) ?? 0);
        if (Number.isFinite(wrong) && wrong > 0) wrongCount = Math.max(wrongCount, Math.min(MAX_WRONG_PINS - 1, Math.floor(wrong)));
      } catch (err) {
        logSilentFailure('DevFlags.load', err);
      }
      notify();
    })();
  }
  return loadPromise;
}

// ─── Reads ───

/** Sync. Returns the registry DEFAULT while locked, otherwise the stored value or the default. */
export function getDevFlag<K extends DevFlagName>(name: K): DevFlagValue<K> {
  const value = unlocked && name in values ? values[name] : DEV_FLAGS[name].default;
  return value as unknown as DevFlagValue<K>;
}

/** `useSyncExternalStore(subscribeDevFlags, () => getDevFlag(name))` — for render paths. */
export function useDevFlag<K extends DevFlagName>(name: K): DevFlagValue<K> {
  return useSyncExternalStore(
    subscribeDevFlags,
    () => getDevFlag(name),
    () => getDevFlag(name),
  );
}

/** Subscribe to any store change (values, unlock state, lockout); returns the unsubscribe. */
export function subscribeDevFlags(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Non-default flags in registry order. Empty while locked (flags do not bite while locked). */
export function getChangedFlags(): { name: DevFlagName; value: boolean | number | string }[] {
  if (!unlocked) return [];
  const out: { name: DevFlagName; value: FlagPrimitive }[] = [];
  for (const name of FLAG_NAMES) {
    const value = values[name];
    if (value !== undefined) out.push({ name, value });
  }
  return out;
}

/** True while unlocked and any `simulates` flag holds a non-default value (drives the amber stripe). */
export function isSimulating(): boolean {
  if (!unlocked) return false;
  for (const name of FLAG_NAMES) {
    if (values[name] !== undefined && defOf(name).simulates) return true;
  }
  return false;
}

export function isDevUnlocked(): boolean {
  return unlocked;
}

/** `useSyncExternalStore` over the unlock state. */
export function useDevUnlocked(): boolean {
  return useSyncExternalStore(subscribeDevFlags, isDevUnlocked, isDevUnlocked);
}

/** ms epoch of the current lockout, 0 when none (or expired). */
export function getDevLockoutUntil(): number {
  return lockoutUntil > Date.now() ? lockoutUntil : 0;
}

// ─── Writes ───

/**
 * Validates (numbers clamped; bool/enum/string failures reject with a plain `Error` the panel shows
 * inline), stores, notifies synchronously, then persists the whole blob (debounced 150 ms).
 */
export async function setDevFlag<K extends DevFlagName>(name: K, value: DevFlagValue<K>): Promise<void> {
  if (!isFlagName(name)) throw new Error(`Unknown flag ${String(name)}`);
  const v = validateValue(name, value);
  if (!v.ok) throw new Error(v.reason);
  if (!applyValue(name, v.value)) return;
  notify();
  await schedulePersist();
}

/** Back to the registry default; persists; notifies. */
export async function resetDevFlag(name: DevFlagName): Promise<void> {
  if (!isFlagName(name) || !(name in values)) return;
  delete values[name];
  notify();
  await schedulePersist();
}

/** Every flag back to its default; removes the blob; notifies. Unlock state is kept (see `lockDev`). */
export async function resetDevFlags(): Promise<void> {
  if (Object.keys(values).length === 0) return;
  values = {};
  notify();
  await schedulePersist();
}

// ─── Unlock / lock (DECISIONS D2) ───

/**
 * `process.env.EXPO_PUBLIC_DEV_PANEL_PIN || getAppExtra().devPanelPin || DEV_PIN_FALLBACK`.
 * `||` is DELIBERATE (CONTRACTS §2.2): app.config.js sets `extra.devPanelPin` to '' when the env var is
 * unset, so `??` would accept an EMPTY pin. The selection ORDER is D2's.
 */
function getDevPin(): string {
  return process.env.EXPO_PUBLIC_DEV_PANEL_PIN || getAppExtra().devPanelPin || DEV_PIN_FALLBACK;
}

/** Which layer `getDevPin()` resolved from (the Env tab shows "PIN source: default" in red). */
export function getDevPinSource(): 'env' | 'extra' | 'default' {
  if (process.env.EXPO_PUBLIC_DEV_PANEL_PIN) return 'env';
  if (getAppExtra().devPanelPin) return 'extra';
  return 'default';
}

/**
 * Compares `pin` with `getDevPin()`.
 * - lockout still running → 'locked_out' (no comparison, no count);
 * - wrong → 'wrong' (count persisted in `nn:dev:wrongCount` so a relaunch does not reset it); the THIRD
 *   consecutive wrong PIN starts a 30 s lockout (persisted in `nn:dev:lockoutUntil`), resets the count and
 *   returns 'locked_out' immediately;
 * - correct → `unlocked = true`, persisted in `nn:dev:unlocked`, notifies, 'ok'.
 * An empty `extra.devPanelPin` never unlocks with an empty string (`getDevPin()` falls through to the default).
 */
export async function unlockDev(pin: string): Promise<'ok' | 'wrong' | 'locked_out'> {
  const now = Date.now();
  if (now < lockoutUntil) return 'locked_out';
  if (lockoutUntil) {
    // Expired lockout — clear it before judging this attempt.
    lockoutUntil = 0;
    await safeRemove([DEV_STORAGE_KEYS.lockoutUntil]);
  }
  if (!pin || pin !== getDevPin()) {
    wrongCount += 1;
    if (wrongCount >= MAX_WRONG_PINS) {
      wrongCount = 0;
      lockoutUntil = now + LOCKOUT_MS;
      notify();
      await safeSet(DEV_STORAGE_KEYS.lockoutUntil, String(lockoutUntil));
      await safeRemove([DEV_STORAGE_KEYS.wrongCount]);
      return 'locked_out';
    }
    await safeSet(DEV_STORAGE_KEYS.wrongCount, String(wrongCount));
    return 'wrong';
  }
  if (wrongCount) {
    wrongCount = 0;
    await safeRemove([DEV_STORAGE_KEYS.wrongCount]);
  }
  if (!unlocked) {
    unlocked = true;
    notify();
  }
  await safeSet(DEV_STORAGE_KEYS.unlocked, 'true');
  return 'ok';
}

/** Locks dev mode: clears the unlock + every flag (memory and disk), notifies. The lockout (if any) is left alone. */
export async function lockDev(): Promise<void> {
  cancelPendingPersist();
  unlocked = false;
  values = {};
  wrongCount = 0;
  notify();
  await safeRemove([DEV_STORAGE_KEYS.flags, DEV_STORAGE_KEYS.unlocked, DEV_STORAGE_KEYS.wrongCount]);
}

// ─── Export / import ───

/** Pretty JSON `{ [name]: value }` of the non-default flags ('{}' while locked). */
export function exportDevFlags(): string {
  const out: Record<string, FlagPrimitive> = {};
  for (const { name, value } of getChangedFlags()) out[name] = value;
  return JSON.stringify(out, null, 2);
}

/**
 * Applies a JSON object produced by `exportDevFlags()`. Each entry is validated like `setDevFlag`
 * (numbers clamped); unknown names and invalid values are listed in `rejected`; valid ones are applied
 * in one notify + one persist. Unparseable input applies nothing and rejects `'<invalid JSON>'`.
 */
export async function importDevFlags(json: string): Promise<{ applied: number; rejected: string[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { applied: 0, rejected: ['<invalid JSON>'] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { applied: 0, rejected: ['<invalid JSON>'] };
  }
  const rejected: string[] = [];
  let applied = 0;
  let changed = false;
  for (const [name, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isFlagName(name)) {
      rejected.push(name);
      continue;
    }
    const v = validateValue(name, raw);
    if (!v.ok) {
      rejected.push(name);
      continue;
    }
    applied += 1;
    if (applyValue(name, v.value)) changed = true;
  }
  if (changed) {
    notify();
    await schedulePersist();
  }
  return { applied, rejected };
}
