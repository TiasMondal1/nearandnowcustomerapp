# Dev mode (codename indigo)

The customer app ships a hidden developer panel in every build. It is unreachable by accident: nothing is visible until a deliberate gesture sequence and a PIN have been passed, and every flag returns its production default while the panel is locked. Source of truth: `lib/devFlags.ts` (registry + store), `context/DevModeContext.tsx` (gate), `hooks/useShakeDetector.ts` (shake), `components/dev/*` (pill, stripe, PIN sheet, panel, actions).

## 1. Unlocking

Two entry paths lead to the same three-step gate (DECISIONS D2).

**Path A — shake (physical device, release build).** Shake the phone: three accelerometer peaks of |hypot(x,y,z) − 1| ≥ 1.2 g, at least 250 ms apart, all inside a 1.2 s window, then a 2 s cooldown (`hooks/useShakeDetector.ts`, sampled at 200 ms — the Android 12+ floor without `HIGH_SAMPLING_RATE_SENSORS`). The listener is active only while the app is in the foreground, never on web, and never while a native permission prompt is up. In `__DEV__` builds React Native's own dev menu owns the shake gesture, so use path B there.

**Path B — long-press (simulators, `__DEV__` builds, web).** Open the account sheet (avatar in any tab header) and long-press the footer brand line for 3 s (`components/ProfileMenu.tsx`, `DEV_LONG_PRESS_MS = 3000`). The sheet closes first and then the toast appears in the root host.

Either path shows a neutral toast reading **`Near & Now v<version> (<build>)`** for 3 s (version from `expo.version`, build from `android.versionCode` or the native build number — `lib/appExtra.ts getAppVersion()`). It carries no haptic and no sound, so a bumped phone shows only a version line.

1. **Tap that toast 5 times within 3 s** of the first tap (taps pause the toast timer; a swipe does not count; a stale window restarts the count).
2. A **"Developer access"** bottom sheet asks for the PIN (number pad, up to 8 digits). Three wrong PINs in a row start a **30 s lockout** ("Too many attempts", button disabled with a live countdown). Both the wrong-PIN count (`nn:dev:wrongCount`) and the lockout deadline (`nn:dev:lockoutUntil`) are persisted, so killing the app does not reset the three-strike rule.
3. On the correct PIN: success haptic + chime, `nn:dev:unlocked = true` is persisted, the sheet dismisses and the panel opens (only after the sheet's native dismiss, never in the same tick).

While unlocked: the DEV pill is visible, a shake opens the panel directly (unless `Dev_Indigo_inhibit_ShakeOpen`), the long-press opens it directly, and all flags are live. The unlock survives restarts until **"Lock dev mode"** in the panel's Actions tab, which clears the unlock and resets every flag.

`__DEV__` builds show the pill immediately, but still locked: its env dot is replaced by a lock glyph and tapping it opens the PIN sheet directly (the pill is already a deliberate target, so the version-toast step is skipped).

## 2. PIN sources

`lib/devFlags.ts getDevPin()` resolves, in order:

| Priority | Source | Where it is set |
|---|---|---|
| 1 | `process.env.EXPO_PUBLIC_DEV_PANEL_PIN` | `.env` locally; the EAS dashboard per build profile |
| 2 | `Constants.expoConfig.extra.devPanelPin` | `app.config.js` mirrors the same env var into `extra` |
| 3 | `'7391'` (`DEV_PIN_FALLBACK`) | hard-coded default |

The chain uses `||`, so an empty string falls through to the next layer. **`EXPO_PUBLIC_DEV_PANEL_PIN` is required in the EAS production profile** (see `.env.example`); without it the default PIN is live, and the panel's Env tab prints **"PIN source: default"** in red (`getDevPinSource()` → `'env' | 'extra' | 'default'`). Keep the PIN out of git and never give any real secret the `EXPO_PUBLIC_` prefix (Metro inlines it into the bundle).

## 3. What the pill and the stripe mean

**DEV pill** (`components/dev/DevPill.tsx`): a 48 × 28 px near-black capsule (deliberately not brand green) that floats bottom-right by default. It is draggable anywhere, snaps to the nearest horizontal edge on release, remembers its position in `nn:dev:pill`, never overlaps the CartBar (it clamps above it, including Home's active-orders lift) and hides while a payment is in flight. Tap → panel (or PIN sheet while locked); long-press (600 ms) → a toast saying how many flags differ from default with a "Reset" action (or "No flags changed").

| Pill detail | Meaning |
|---|---|
| Dot colour | build profile from `extra.buildProfile`: grey = `local`, blue (`C.info`) = `development`, amber (`C.warning`) = `preview`, red (`C.danger`) = `production` |
| Lock glyph instead of the dot | `__DEV__` build, PIN not yet entered |
| Amber badge with a number | that many flags currently differ from their registry default |
| Pill absent | locked store build, `Dev_Indigo_inhibit_FloatingPill`, `Dev_Indigo_inhibit_Feature`, the panel or PIN sheet is open, or a payment is in progress |

**Amber simulation stripe** (`components/dev/DevSimulationStripe.tsx`): a 2 px `C.warning` line directly under the status bar while **any flag marked `simulates` holds a non-default value** (forced offline, latency, fake balance, synthetic tracking status, forced gateway result, and so on — see the table below). It is the "why is checkout failing?" guard: if the stripe is up, a simulation is on. Hidden under `Dev_Indigo_inhibit_SimulationStripe` and `Dev_Indigo_inhibit_Feature`; it never intercepts touches and is invisible to assistive tech.

## 4. The panel

`components/dev/DevPanel.tsx` is a bottom sheet titled **"Developer"** (max 92 % height) with an env badge, a version chip, a "×N" chip while `Dev_Motion_inhibit_SpeedFactor ≠ 1`, and a lock button. Five sections, selected with private pills (the one sanctioned private control; the selected pill fills ink, never brand green):

- **Env** — app version / versionCode / native version and build, build profile, `expo-updates` channel / runtimeVersion / updateId / isEmbeddedLaunch, execution environment, `__DEV__`, Hermes, React Native version, API host, Supabase host, Sentry state, **PIN source** (red when `default`), device, screen, font scale, OS reduce-motion, locale.
- **Session** — user id (first 8 chars) and phone (masked), token present, push permission / token tail / last registration error, active location + source + nearby key, cart snapshot, the Sounds / Haptics user preferences, "Unlocked since", flags changed, simulation stripe state; the last 50 requests when `Dev_Perf_inhibit_NetworkLog` is on and the boot marks when `Dev_Perf_inhibit_BootTimeline` is on (both copyable).
- **Flags** — every registry entry grouped by area in `DEV_FLAG_AREA_ORDER` (Sirius, Onyx, Motion, Indigo, then codenames A–Z, then areas), rendered by `type`: bool → switch (row tap flips it), number → editable value (numeric keyboard, clamped to min/max) plus preset pills, enum → pills, string → underline input with the registry's `validate` pattern. Names are shown **verbatim** in monospace (the only place monospace is allowed — D11 Q1), wrapping to three lines, with a per-row reset. A "Filter flags…" box narrows the list.
- **Actions** — see below.
- **Storage** — every `nn:` / `nn_` AsyncStorage row with its size in KB (rows near Android's 2 MB CursorWindow limit are drawn in red), per-row delete (confirmed), and whether a SecureStore token is present.

### Actions (`components/dev/DevActions.tsx`)

Every action is an ink-on-sand secondary button; destructive ones confirm first (native Alert, or the browser `confirm()` on web); results arrive as toasts.

| Group | Actions |
|---|---|
| Feedback previews | one chip per UI sound (tap 35 ms, toggle 75, add 110, remove 100, swoosh 140, error 240, coin 330, success 420) and per haptic (tap, select, toggle, add, remove, success, error, heavy, coin); **Play all** (600 ms apart). Previews ignore the user's Sounds/Haptics toggles. |
| Visual previews | **Toast tones** (neutral, success, error, warning, info, deal, 700 ms apart) · **Skeleton 3 s** (holds `Dev_Onyx_inhibit_SkeletonExit` for 3 s, released by a module-level timer so closing the panel cannot leave it stuck) · **Confetti** |
| Diagnostics | **Copy diagnostics JSON** (device, build, flags changed, storage sizes, cart/location summary; phone masked, user id and per-user key suffixes cut to `<uid>`, token never included) · **Send Sentry test event** (attaches the diagnostics as a breadcrumb) · **Throw test error** (exercises `ErrorBoundary`) |
| Data | **Clear nn:\* caches** (disk rows + `queryCache` + store-service caches; live memory mirrors for cart/location/nearby/recent search survive until a cold start — the copy says so) · **Clear image cache** · **Invalidate query cache** · **Simulate session expiry** (`apiClient.simulateSessionExpiry()`) · **Simulate reconnect** (`network.simulateReconnect()`) · **Simulate push received** (schedules a local notification so the receive / tap handlers can be exercised without the backend) |
| Flags | **Reset all** · **Export** (copies the JSON of non-default flags) · **Import** (iOS `Alert.prompt`, inline box elsewhere; each entry validated like `setDevFlag`, result "N applied · M rejected") |
| Lock | **Lock dev mode** — clears `nn:dev:unlocked`, resets every flag, closes the panel |

## 5. Flags

### Naming convention

Every control is named `Dev_<Feature>_inhibit_<Target>` (DECISIONS D1): `<Feature>` is the feature **codename** when the control targets a codenamed feature (`Dev_Cyan_inhibit_Bounce`), otherwise the **area** (`Network`, `Cache`, `Location`, `Home`, `Search`, `Category`, `Cart`, `Checkout`, `Orders`, `Tracking`, `Payment`, `Wallet`, `Images`, `Push`, `Auth`, `Shell`, `Perf`, `Motion`). Numbers, enums and strings keep the same shape (`Dev_Network_inhibit_LatencyMs`). Every codename also has a master `Dev_<Codename>_inhibit_Feature` (bool, default `false` = feature ON) whose exact effect is fixed in CONTRACTS §7; `Dev_Boreal_inhibit_Feature` is the documented no-op (the palette is compile-time).

### Codename registry

| Codename | Feature | Main module |
|---|---|---|
| boreal | Palette | `constants/colors.ts` |
| onyx | Motion system | `components/ui/motion/presets.ts` |
| sirius | Haptics + UI sounds | `lib/feedback.ts` |
| indigo | Dev mode (this document) | `lib/devFlags.ts` |
| vulcan | Toasts | `components/ui/Toast.tsx` |
| altair | BottomSheet | `components/ui/BottomSheet.tsx` |
| rigel | Stepper | `components/ui/Stepper.tsx` |
| cyan | CartBar | `components/ui/CartBar.tsx` |
| antares | Delivery ETA | `lib/deliveryEta.ts` |
| lyra | Search+ | `lib/recentSearches.ts` |
| deneb | Banners | `constants/banners.ts` |
| orion | Product page | `app/product/[id].tsx` |
| vega | Orders+ | `app/orders.tsx` |
| pavo | Rating | `app/order/rate/[id].tsx` |
| nova | Order celebration | `app/order/confirmation/[id].tsx` |
| mira | Tracking+ | `hooks/useOrderTracking.ts` |
| capella | Wallet delight | `app/wallet.tsx` |
| atlas | Account everywhere | `context/ProfileMenuContext.tsx` |
| amber | Tab bar | `app/(tabs)/_layout.tsx` |
| cobalt | Offline | `lib/network.ts` |
| quartz | Addresses | `app/location/select-map.tsx` |
| tango | Notifications | `lib/notificationService.ts` |
| cinder | Checkout = cart | `app/support/checkout.tsx` |
| juno | Coupons | `lib/couponService.ts` |
| kepler | Data layer | `lib/queryCache.ts` |
| halley | Wishlist | `lib/wishlistStore.ts` |
| zephyr | Route transitions | `app/_layout.tsx` |

Each main module starts with `// codename: <name>` on line 1. Codenames never appear in user-facing copy.

### Reading flags in code

- `getDevFlag('Dev_X_inhibit_Y')` in handlers, effects and module code; `useDevFlag('Dev_X_inhibit_Y')` in render (it subscribes). Never read a flag inside the render of a memoised list cell.
- Flags are hydrated from `nn:dev:flags` at `app/_layout.tsx` module scope and read synchronously afterwards. **While locked, `getDevFlag()` returns the registry default** — a store build carrying a stale flags blob behaves exactly like production. There is no `__DEV__` bypass.
- Storage (device-scoped, survives logout): `nn:dev:flags`, `nn:dev:unlocked`, `nn:dev:lockoutUntil`, `nn:dev:wrongCount`, `nn:dev:pill`.
- Adding a flag = adding one entry to `DEV_FLAGS`; the panel renders it from `type` and the table below is regenerated with `npm run docs:dev-flags` (`npm run docs:dev-flags:check` fails when the doc is stale).

### All flags

<!-- dev-flags:start -->
_Generated from `lib/devFlags.ts` by `scripts/gen-dev-flags-doc.js` — do not edit by hand. 126 flags: 111 bool · 10 number · 3 enum · 2 string; 27 codename masters; 44 marked `simulates` (they light the amber stripe)._

| Name | Type | Default | Area | Label | Help |
|---|---|---|---|---|---|
| `Dev_Sirius_inhibit_Feature` | bool | `false` | Sirius | Turn off all haptics and sounds | Master; user prefs ignored |
| `Dev_Sirius_inhibit_Sounds` | bool | `false` | Sirius | Mute UI sounds | Haptics unaffected |
| `Dev_Sirius_inhibit_Haptics` | bool | `false` | Sirius | Disable haptics | Sounds unaffected |
| `Dev_Sirius_inhibit_PassiveFeedback` | bool | `false` | Sirius | Silence non-gesture feedback | Status advance, delivered, offline |
| `Dev_Sirius_inhibit_Throttle` | bool | `false` | Sirius | Disable anti-spam windows | Hear every event; debugging only |
| `Dev_Sirius_inhibit_SilentSwitch` | bool | `false` | Sirius | Play sounds in iOS silent mode | Re-applies audio mode; iOS only |
| `Dev_Sirius_inhibit_VolumeLevel` | number 0–1, step 0.1 | `0.7` | Sirius | UI sound volume | Scales every player |
| `Dev_Sirius_inhibit_EventTrace` | enum: off / toast / console | `off` | Sirius | Trace feedback events | Shows kind + source on every call |
| `Dev_Onyx_inhibit_Feature` | bool | `false` | Onyx | Turn off the motion layer | Animations off + press scale off + shimmer off _(simulates)_ |
| `Dev_Onyx_inhibit_Animations` | bool | `false` | Onyx | Reduce motion (force) | ReducedMotionConfig Always _(simulates)_ |
| `Dev_Onyx_inhibit_SystemReduceMotion` | bool | `false` | Onyx | Ignore OS reduce-motion | Full motion on an a11y device |
| `Dev_Onyx_inhibit_PressScale` | bool | `false` | Onyx | Disable press scale | Pressed background stays |
| `Dev_Onyx_inhibit_Shimmer` | bool | `false` | Onyx | Freeze skeleton shimmer | Static skeletonLo |
| `Dev_Onyx_inhibit_SkeletonExit` | bool | `false` | Onyx | Keep skeletons on screen | Every screen stays in its loading layout _(simulates)_ |
| `Dev_Onyx_inhibit_LayoutTransitions` | bool | `false` | Onyx | Disable layout transitions | Collapsible / stepper / toast stack snap |
| `Dev_Motion_inhibit_SpeedFactor` | number 1–10, step 1 | `1` | Motion | Slow all animations | Durations × f; springs reshaped (k/f², c/f) _(simulates)_ |
| `Dev_Indigo_inhibit_Feature` | bool | `false` | Indigo | Hide dev pill and stripe | Panel stays reachable via shake / long-press |
| `Dev_Indigo_inhibit_FloatingPill` | bool | `false` | Indigo | Hide the DEV pill | Shake / long-press still open the panel |
| `Dev_Indigo_inhibit_ShakeOpen` | bool | `false` | Indigo | Disable shake-to-open while unlocked | Bumpy commute mode |
| `Dev_Indigo_inhibit_SimulationStripe` | bool | `false` | Indigo | Hide the amber simulation stripe | Stripe otherwise shows while any simulates flag is non-default |
| `Dev_Altair_inhibit_Feature` | bool | `false` | Altair | Plain modal sheets | BottomSheet renders RN Modal slide, no pan/spring |
| `Dev_Altair_inhibit_PanDismiss` | bool | `false` | Altair | Disable sheet pan-to-dismiss | Scrim tap / back still close |
| `Dev_Amber_inhibit_Feature` | bool | `false` | Amber | Plain tab bar | No icon pop or haptic |
| `Dev_Amber_inhibit_TabPop` | bool | `false` | Amber | Disable tab icon pop | Haptic stays |
| `Dev_Antares_inhibit_Feature` | bool | `false` | Antares | Hide delivery ETA | useDeliveryEta() returns state none everywhere |
| `Dev_Antares_inhibit_EtaMinutes` | number 0–120, step 1 | `0` | Antares | Force ETA minutes | 0 = computed from nearest store _(simulates)_ |
| `Dev_Antares_inhibit_StoreOpen` | bool | `false` | Antares | Force store-closed state | Every ETA surface shows the closed copy; Pay stays enabled _(simulates)_ |
| `Dev_Antares_inhibit_Ticker` | bool | `false` | Antares | Freeze ETA digit roll | Number still updates |
| `Dev_Atlas_inhibit_Feature` | bool | `false` | Atlas | Account only on Home | Avatar hidden on other tabs; version row hidden |
| `Dev_Atlas_inhibit_UnreadDot` | bool | `false` | Atlas | Hide unread dot on avatar | Avatar and ProfileMenu row show no dot; count still fetched |
| `Dev_Boreal_inhibit_Feature` | bool | `false` | Boreal | Palette (no runtime effect) | Palette is compile-time; registered for completeness |
| `Dev_Capella_inhibit_Feature` | bool | `false` | Capella | Quiet wallet | No count-up, coin or delta chip |
| `Dev_Capella_inhibit_CountUp` | bool | `false` | Capella | Disable wallet count-up | Balance snaps after top-up; coin and delta chip stay |
| `Dev_Cinder_inhibit_Feature` | bool | `false` | Cinder | Legacy checkout validation | Alert summary instead of inline; plain remove |
| `Dev_Cinder_inhibit_InlineValidation` | bool | `false` | Cinder | Alert-based checkout validation | Pay shows the legacy Alert summary instead of inline errors |
| `Dev_Cinder_inhibit_UndoRemove` | bool | `false` | Cinder | Remove without Undo | Removed cart lines cannot be restored from the toast |
| `Dev_Cobalt_inhibit_Feature` | bool | `false` | Cobalt | Disable offline layer | No banner, reconnect refetch or Pay guard |
| `Dev_Cobalt_inhibit_ReconnectRefetch` | bool | `false` | Cobalt | Disable refetch on reconnect | Screens keep stale data until pull-to-refresh |
| `Dev_Cyan_inhibit_Feature` | bool | `false` | Cyan | Hide the cart bar | CartBar never renders |
| `Dev_Cyan_inhibit_Bounce` | bool | `false` | Cyan | Disable CartBar bounce | No scale pop when the count increases |
| `Dev_Cyan_inhibit_Thumbnails` | bool | `false` | Cyan | Hide CartBar thumbnails | Text-only bar; height stays 56 px |
| `Dev_Cyan_inhibit_EtaChip` | bool | `false` | Cyan | Hide ETA chip in CartBar | Removes the lightning chip from the bar |
| `Dev_Deneb_inhibit_Feature` | bool | `false` | Deneb | Hide promo banners | banners item kind not rendered on Home |
| `Dev_Deneb_inhibit_AutoAdvance` | bool | `false` | Deneb | Disable banner auto-advance | Carousel moves only by swipe |
| `Dev_Deneb_inhibit_RemoteBanners` | bool | `false` | Deneb | Local banners only | Skips the optional Supabase read |
| `Dev_Halley_inhibit_Feature` | bool | `false` | Halley | Hide wishlist hearts | Hearts hidden on PDP; wishlist screen still works |
| `Dev_Halley_inhibit_HeartPop` | bool | `false` | Halley | Disable heart pop | Heart fills without the spring; toggle feedback stays |
| `Dev_Juno_inhibit_Feature` | bool | `false` | Juno | Plain coupons | No promo input or best-coupon row |
| `Dev_Juno_inhibit_PromoInput` | bool | `false` | Juno | Hide promo-code input | Coupons screen lists only; best-coupon row stays |
| `Dev_Kepler_inhibit_Feature` | bool | `false` | Kepler | Bypass data-layer caches | queryCache, instant nearby, token memo, price drift all off _(simulates)_ |
| `Dev_Kepler_inhibit_QueryCache` | bool | `false` | Kepler | Bypass queryCache | cached() always runs the fetcher _(simulates)_ |
| `Dev_Kepler_inhibit_InstantNearby` | bool | `false` | Kepler | Disable in-memory nearby view | Network path runs on every location change _(simulates)_ |
| `Dev_Kepler_inhibit_TokenMemo` | bool | `false` | Kepler | Read token from SecureStore every call | Reproduces the pre-kepler Keystore cost _(simulates)_ |
| `Dev_Lyra_inhibit_Feature` | bool | `false` | Lyra | Legacy search | No rotation, recents, local results, chips or count |
| `Dev_Lyra_inhibit_PlaceholderRotation` | bool | `false` | Lyra | Static search placeholder | Band shows "Search for milk, bread…" |
| `Dev_Lyra_inhibit_RecentSearches` | bool | `false` | Lyra | Hide recent searches | Recents not stored or shown |
| `Dev_Lyra_inhibit_LocalResults` | bool | `false` | Lyra | Server-only search results | Disables local-first results |
| `Dev_Mira_inhibit_Feature` | bool | `false` | Mira | Legacy tracking hero | "Estimated delivery by HH:MM" instead of countdown + progress |
| `Dev_Mira_inhibit_ProgressBar` | bool | `false` | Mira | Hide tracking progress bar | Hero keeps the minutes and status copy |
| `Dev_Nova_inhibit_Feature` | bool | `false` | Nova | Quiet order confirmation | Static check; explicit pay button is kept |
| `Dev_Nova_inhibit_Confetti` | bool | `false` | Nova | Disable confetti | Check pop and chime unaffected |
| `Dev_Nova_inhibit_CheckPop` | bool | `false` | Nova | Disable check pop + ring | Check appears at scale 1; confetti unaffected |
| `Dev_Nova_inhibit_Chime` | bool | `false` | Nova | Disable order-placed chime | Haptic stays |
| `Dev_Orion_inhibit_Feature` | bool | `false` | Orion | Legacy product page | No similar rail, instant paint, share or View-cart strip |
| `Dev_Orion_inhibit_SimilarRail` | bool | `false` | Orion | Hide similar products rail | PDP ends after the about block |
| `Dev_Orion_inhibit_InstantPaint` | bool | `false` | Orion | PDP ignores memory seed | Skeleton path every open _(simulates)_ |
| `Dev_Pavo_inhibit_Feature` | bool | `false` | Pavo | Plain rating flow | No thank-you state or star stagger |
| `Dev_Pavo_inhibit_ThankYouState` | bool | `false` | Pavo | Skip thank-you state | Returns immediately after submit |
| `Dev_Pavo_inhibit_StarStagger` | bool | `false` | Pavo | Disable star fill stagger | Stars fill instantly; select haptic stays |
| `Dev_Quartz_inhibit_Feature` | bool | `false` | Quartz | Legacy map picker | Draggable marker instead of centre pin; returnTo kept |
| `Dev_Quartz_inhibit_ReverseGeocode` | bool | `false` | Quartz | Skip reverse geocode on settle | Address stays "Pinned location" _(simulates)_ |
| `Dev_Rigel_inhibit_Feature` | bool | `false` | Rigel | Legacy stepper | Instant ADD/stepper swap, no roll, minus instead of bin |
| `Dev_Rigel_inhibit_Morph` | bool | `false` | Rigel | Disable ADD → stepper morph | Instant swap |
| `Dev_Rigel_inhibit_DigitRoll` | bool | `false` | Rigel | Disable quantity digit roll | Quantity snaps instead of rolling |
| `Dev_Rigel_inhibit_TrashAtMin` | bool | `false` | Rigel | Minus instead of bin at min qty | Minus glyph stays at qty 1; removal still works |
| `Dev_Tango_inhibit_Feature` | bool | `false` | Tango | Flat notifications | No day groups, swipe or unread dot |
| `Dev_Tango_inhibit_SwipeDismiss` | bool | `false` | Tango | Disable notification swipe | Rows only open; dismiss unavailable |
| `Dev_Vega_inhibit_Feature` | bool | `false` | Vega | Legacy orders list | No segments, Reorder, focus refresh or poll |
| `Dev_Vega_inhibit_ActivePoll` | bool | `false` | Vega | Disable orders poll | No 20 s poll while active orders exist |
| `Dev_Vega_inhibit_Reorder` | bool | `false` | Vega | Hide Reorder buttons | Orders list, order detail and Order again lose the button |
| `Dev_Vulcan_inhibit_Feature` | bool | `false` | Vulcan | Toasts fall back to Alert | notify() calls Alert.alert instead |
| `Dev_Vulcan_inhibit_AutoDismiss` | bool | `false` | Vulcan | Toasts stay until swiped | For screenshots |
| `Dev_Vulcan_inhibit_SwipeDismiss` | bool | `false` | Vulcan | Disable toast swipe | Toasts leave only by timer or their action |
| `Dev_Zephyr_inhibit_Feature` | bool | `false` | Zephyr | Default route transitions | No slide/modal config; welcome not tappable (read live — no restart) |
| `Dev_Zephyr_inhibit_WelcomeInterstitial` | bool | `false` | Zephyr | Skip the welcome screen | OTP → Home directly _(simulates)_ |
| `Dev_Zephyr_inhibit_Transitions` | bool | `false` | Zephyr | Disable route transitions | animation: none (read live via useDevFlag — no restart) |
| `Dev_Network_inhibit_Offline` | bool | `false` | Network | Pretend the device is offline | Every apiFetch + Supabase call throws the offline message; banner shows _(simulates)_ |
| `Dev_Network_inhibit_LatencyMs` | number 0–10000, step 100 | `0` | Network | Add request latency (ms) | Both transports _(simulates)_ |
| `Dev_Network_inhibit_FailRate` | number 0–1, step 0.1 | `0` | Network | Random request failure rate | Throws "Server error…" _(simulates)_ |
| `Dev_Network_inhibit_Force500` | bool | `false` | Network | Treat every backend response as 500 | Status forced after the real fetch resolves; Supabase unaffected _(simulates)_ |
| `Dev_Network_inhibit_TimeoutMs` | number 0–30000, step 500 | `0` | Network | Override request timeout (ms) | 0 = per-call default _(simulates)_ |
| `Dev_Network_inhibit_ApiBaseUrl` | string (e.g. `https://staging.example.com`) | `''` | Network | API base URL override | Empty = env/extra default _(simulates, restart)_ |
| `Dev_Cache_inhibit_HomeCatalog` | bool | `false` | Cache | Ignore the home catalog disk cache | Cold path every launch _(simulates)_ |
| `Dev_Cache_inhibit_Orders` | bool | `false` | Cache | Ignore the orders disk cache | readUserOrdersCache → null; network path on every open _(simulates)_ |
| `Dev_Cache_inhibit_Addresses` | bool | `false` | Cache | Ignore the addresses disk cache | readAddressesCache → null; network path on every open _(simulates)_ |
| `Dev_Location_inhibit_Gps` | bool | `false` | Location | GPS requests fail | getCurrentPositionAsync rejects → denied states _(simulates)_ |
| `Dev_Location_inhibit_LatLngOverride` | string (e.g. `22.5726, 88.3639`) | `''` | Location | Override active coordinates | lat,lng — applied to the active location _(simulates)_ |
| `Dev_Location_inhibit_NearbyFilter` | bool | `false` | Location | Bypass the 4 km radius filter | Platform-wide catalog (dev only) _(simulates)_ |
| `Dev_Home_inhibit_TileCap` | bool | `false` | Home | Show every category tile | Disables the 8 + All cap |
| `Dev_Home_inhibit_Rails` | bool | `false` | Home | Legacy 2×3 product blocks | Instead of horizontal rails |
| `Dev_Home_inhibit_NoStoresNearby` | bool | `false` | Home | Simulate no stores nearby | Nearby filter resolves to empty _(simulates)_ |
| `Dev_Home_inhibit_Catalog` | bool | `false` | Home | Simulate empty catalog | loadMasterCatalog* resolve to [] _(simulates)_ |
| `Dev_Search_inhibit_ForceError` | bool | `false` | Search | Force search error | searchProducts throws _(simulates)_ |
| `Dev_Category_inhibit_SortChips` | bool | `false` | Category | Hide sort chips on category page | Server order only |
| `Dev_Cart_inhibit_SimulateEmpty` | bool | `false` | Cart | Cart reads as empty | Persisted cart untouched _(simulates)_ |
| `Dev_Cart_inhibit_Persist` | bool | `false` | Cart | Do not persist cart changes | Cart resets on the next cold start _(simulates)_ |
| `Dev_Checkout_inhibit_RecoNetwork` | bool | `false` | Checkout | Hide "Did you forget?" rail | Skips its fetch _(simulates)_ |
| `Dev_Checkout_inhibit_PriceDrift` | bool | `false` | Checkout | Simulate a price change | First cart item reported +₹1 → "Prices updated" row _(simulates)_ |
| `Dev_Orders_inhibit_SimulateActive` | bool | `false` | Orders | Inject a synthetic active order | Home banner + Orders Active segment _(simulates)_ |
| `Dev_Orders_inhibit_History` | bool | `false` | Orders | Simulate no order history | getUserOrders → [] _(simulates)_ |
| `Dev_Tracking_inhibit_SyntheticStatus` | enum: off / pending_at_store / preparing_order / order_picked_up / in_transit / order_delivered / order_cancelled | `off` | Tracking | Synthetic tracking status | No network; a fake snapshot at this status _(simulates)_ |
| `Dev_Tracking_inhibit_PollMs` | number 0–60000, step 1000 | `0` | Tracking | Force tracking poll interval (ms) | 0 = adaptive _(simulates)_ |
| `Dev_Payment_inhibit_GatewayResult` | enum: off / paid / failed / cancelled / unverified | `off` | Payment | Force payment result | Order row is still created; failed/cancelled void it; paid/unverified leave it pending — use a test account _(simulates)_ |
| `Dev_Payment_inhibit_PersistSelection` | bool | `false` | Payment | Forget payment method on restart | Defaults to "Other UPI apps" on each launch |
| `Dev_Payment_inhibit_OverlayDelayMs` | number 0–60000, step 1000 | `0` | Payment | Hold the processing overlay (ms) | Tests the 15 s escalation _(simulates)_ |
| `Dev_Wallet_inhibit_FakeBalance` | number -1–100000, step 50 | `-1` | Wallet | Fake wallet balance | −1 = off _(simulates)_ |
| `Dev_Wallet_inhibit_TopupGateway` | bool | `false` | Wallet | Top-up skips Razorpay | Verify resolves balance + amount _(simulates)_ |
| `Dev_Wallet_inhibit_Transactions` | bool | `false` | Wallet | Simulate no wallet transactions | getWalletTransactions resolves [] _(simulates)_ |
| `Dev_Images_inhibit_CdnProxy` | bool | `false` | Images | Bypass the image CDN proxy | Raw origin URLs _(simulates)_ |
| `Dev_Images_inhibit_Prefetch` | bool | `false` | Images | Disable image prefetch | Boot + press-in prefetch off |
| `Dev_Push_inhibit_Registration` | bool | `false` | Push | Skip push registration | No permission prompt or token upload _(simulates)_ |
| `Dev_Auth_inhibit_EmailVerify` | bool | `false` | Auth | Skip email verification UI | Profile hides the verify block _(simulates)_ |
| `Dev_Shell_inhibit_BackToExitToast` | bool | `false` | Shell | Back exits immediately on Home | No "press again" toast |
| `Dev_Perf_inhibit_NetworkLog` | bool | `false` | Perf | Record the last 50 requests | Shown in the panel Session tab |
| `Dev_Perf_inhibit_BootTimeline` | bool | `false` | Perf | Record boot marks | module-eval, auth-ready, fonts-ready, nav-ready, home-first-paint, catalog-painted |
| `Dev_Perf_inhibit_SlowLoadHintMs` | number 1000–30000, step 1000 | `8000` | Perf | Slow-load hint delay (ms) | When "Still loading…" appears under a skeleton |
<!-- dev-flags:end -->
