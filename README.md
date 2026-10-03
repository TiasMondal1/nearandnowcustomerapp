# Near & Now — customer app

The customer-facing mobile app for Near & Now, a hyperlocal grocery / essentials delivery service: browse the catalog of stores within 4 km of a saved address, build a cart, pay by UPI / card / netbanking (Razorpay), wallet or cash on delivery, and track the order live. Android is the shipping platform; iOS and web bundles build from the same code.

## Stack

| Layer | What |
|---|---|
| Runtime | Expo SDK 54, React Native 0.81, React 19 (React Compiler on), Hermes, New Architecture |
| Navigation | expo-router 6 with **typed routes** (`experiments.typedRoutes`); every file under `app/` is a route |
| Motion / gestures | react-native-reanimated 4, react-native-gesture-handler, @shopify/flash-list 2 |
| Data | Supabase (anon key — public catalog reads, RPCs, realtime) + the Near & Now REST backend (`lib/apiClient.ts`, bearer token) |
| Payments | `@codearcade/expo-razorpay` |
| Feedback | expo-haptics, expo-audio (8 UI sounds in `assets/sounds/`), expo-sensors (shake gate for dev mode) |
| Infra | expo-notifications (push), expo-location + react-native-maps, expo-secure-store, @sentry/react-native, expo-updates (installed, OTA not configured) |
| Type | Plus Jakarta Sans 400 / 500 / 600 / 700 / 800 via `@expo-google-fonts/plus-jakarta-sans` — the only five faces loaded |

## Setup

```bash
npm install
cp .env.example .env        # then fill in the values
npx expo start              # dev server (press a for Android, i for iOS, w for web)
```

`.env.example` lists every `EXPO_PUBLIC_*` key the app reads (API base URL, Supabase URL + anon key, Google Maps key, EAS project id, support phone / email, saved-methods switch, Sentry DSN, dev-panel PIN) with a one-line note each. Values are read with a static two-layer pattern — `process.env.EXPO_PUBLIC_X || getAppExtra().x` — and `app.config.js` mirrors each key into `expo.extra`, so the same keys must be set in the EAS dashboard per build profile. `lib/appExtra.ts` is the only place `extra` is cast.

Never prefix a secret with `EXPO_PUBLIC_`: Metro inlines every static reference into the client bundle. Backend-only keys do not belong in this repo's `.env`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run android` / `npm run ios` / `npm run web` | Expo dev server / native run / web |
| `npm run typecheck` | `tsc --noEmit` (must stay at 0 errors) |
| `npm run lint` / `npm run lint:fix` | `eslint .` over the whole repo (`app/`, `components/`, `lib/`, `hooks/`, `context/`, `constants/`, `scripts/`, …) — a bare `expo lint` would cover only `app/`, `components/` and `src/`, which is why the script no longer uses it |
| `npm run routes:types` | regenerates `.expo/types/router.d.ts`; run it after adding, removing or renaming anything under `app/`, before `tsc` (a fresh clone has no `.expo/types`, so CI must run it first) |
| `npm run check` | `routes:types` + `typecheck` + `lint` |
| `npm run doctor` | `expo-doctor` (currently 16/18: a missing `react-native-webview` peer for the Razorpay module and two patch-version drifts, both need installs) |
| `npm run docs:dev-flags` / `docs:dev-flags:check` | regenerate / verify the flag table in `docs/DEV_MODE.md` from `lib/devFlags.ts` |
| `npm run build` | `expo export` (static web bundle) |
| `npm run build:apk*`, `build:aab`, `build:android`, `prebuild:android`, `patch:android` | local Gradle builds and the EAS production build — see `BUILD_COMMANDS.md` and the signing warning below |
| `npm run icons:generate` | regenerate every icon / splash variant from `assets/near_and_now_logo.png` |

## Architecture pointers

- `app/` — routes only (tabs `home`, `categories`, `order-again`; checkout at `support/checkout` **is** the cart; `product/[id]`, `orders`, `order/*`, `location/*`, `settings/*`, `wallet`, `wishlist`, `notifications`, auth screens, `+not-found`). Shared components never live here.
- `components/ui/` — the primitive library and the design rules: **read [`components/ui/README.md`](components/ui/README.md) first.** Import primitives only from the barrel `components/ui/index.ts`.
- `components/<area>/` — feature components (`checkout`, `confirmation`, `home`, `location`, `orders`, `search`, `tracking`, `dev`).
- `lib/` — services (`*Service.ts`, plain async functions over the two transports), `queryCache`, `feedback` (haptics + sounds), `devFlags`, `network`, `bootGate`; `lib/gstin.ts`, `lib/couponMath.ts`, `lib/invoiceEligibility.ts`, `constants/orderStatus.ts` and `constants/fees.ts` are byte-compatible mirrors of backend logic.
- `context/` — `AuthContext`, `CartContext` (module store + thin provider), `LocationContext`, `ProfileMenuContext`, `DevModeContext`.
- `constants/` — `colors.ts` (`C`, the one palette), `ui.ts` (text presets, radius, spacing, shadows, motion tokens), `banners.ts`, `categoryGroups.ts`, `categoryTints.ts`, `searchTrending.ts`.
- `docs/DEV_MODE.md` — the hidden developer panel: how to unlock it, PIN sources, what the pill and stripe mean, every action, and the generated table of all 126 `Dev_<Feature>_inhibit_<Target>` flags.
- Every shipped feature has a codename (`cyan`, `vulcan`, `rigel`, …) that appears in its flag names, in the dev panel and in a `// codename:` comment on line 1 of its main module — never in user-facing copy. The registry is in `docs/DEV_MODE.md`.

## Design rules in brief

Full rules with the token tables are in `components/ui/README.md`.

- One palette (`C` from `constants/colors.ts`), tokens from `constants/ui.ts`; no hex / rgba literals, no local palettes, no `fontWeight` (Jakarta family names only), nothing under 11 px, nothing under 14 px in ExtraBold, sentence case.
- `Pressable` / `PressableScale` only — scale plus background highlight, never opacity fades, never `TouchableOpacity`; a11y role + label on every control; 44 pt targets.
- Skeleton-first loading, explicit empty and error states on every screen.
- Reanimated 4 for motion (`.set()` / `.get()`), reduced motion respected, no `LayoutAnimation`, no idle loops except the shared skeleton clock and the payment overlay.
- Feedback through `lib/feedback.ts` only: pure navigation is silent; one gesture → one haptic → at most one sound; cart mutations own their add / remove feedback; order placement plays `success` once, on the confirmation.
- Typed routes: absolute hrefs, no `as any` / `as Href`; `router.replace` for flow transitions, `router.push` for drill-ins; omit `onBack` so deep links fall back correctly.
- Every new feature sits behind a `Dev_<Codename>_inhibit_Feature` flag; new storage keys use the `nn:` prefix.

## Signing and native builds — read before touching `android/`

- **Never run `npm run keystore:generate`.** The Play upload key is the shared EAS keystore referenced in place from the store-owner project; a freshly generated key would not be accepted by Play and the script's overwrite guard does not protect the real key.
- `npm run prebuild:android` runs `expo prebuild --clean`, which **deletes `android/keystore.properties`**. `scripts/patch-android.js` restores it only from `credentials/keystore.properties` (gitignored). **Back up `android/keystore.properties` to `credentials/` before every prebuild**; without it a release APK silently falls back to the debug key and the AAB build fails.
- Local release builds need JDK 17; `android/gradle.properties` carries a Metaspace setting that fixes an R8 hang — keep it (the patch script re-applies it).
- `app.config.js` must keep `["expo-audio", { recordAudioAndroid: false }]` (the bare string would add a microphone permission) and `["expo-sensors", { motionPermission: false }]`.

See `BUILD_COMMANDS.md` for the APK / AAB recipes.
