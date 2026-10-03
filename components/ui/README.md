# components/ui — primitives, tokens, motion, feedback, flags

Working rules for every screen and primitive in the customer app (Expo SDK 54, RN 0.81, React 19 with the React Compiler, expo-router 6 typed routes, reanimated 4, FlashList 2). Binding sources, in order: `DECISIONS.md` (D1–D11), `CONTRACTS.md` (frozen exports), `understand/MAP.md` §2 (conventions) and §7 (landmines). Reconciled with the shipped code by the W3 verify pass (2026-10-03).

## 1. Importing

- Primitives come from the barrel only: `import { Screen, ScreenHeader, PressableScale, Stepper } from "../../components/ui";` — never from `components/ui/<File>`. The ONE exception is `components/ErrorBoundary.tsx` (the crash path must not pull the whole barrel in).
- `constants/*` may do `import type { IconName } from '../components/ui/types'` — type-only. A value import of the barrel from `constants/` evaluates every primitive at constants load and creates a cycle.
- Relative imports only (no `@/`). Quotes: double in `app/` and `components/`; single in `lib/`, `context/`, `hooks/`, `constants/`.
- Colours: `import { C } from "../../constants/colors"`. Everything else: `import { text, radius, space, layout, shadow, motion, fontFamily } from "../../constants/ui"`.
- Only route files live under `app/` (any default export there becomes a route). Shared components go in `components/`.
- New primitive = named export + exported `XProps` type + `style`/`testID` props + `StyleSheet.create` at the bottom + a doc comment on every prop stating its pixel default.

## 2. Tokens

### Colours — `C` (codename boreal: one brand, forest green on cream)

| Role | Tokens |
|---|---|
| Surfaces | `bg` cream (browse ground) · `bgSoft` sand (pressed rows, idle chips) · `surfaceBand` 8 px separator bands · `card` / `white` · `onPrimary` text on brand fills · `border` · `borderSoft` · `hairline` card borders on cream |
| Brand | `primary` · `primaryDark` (pressed CTA face, links) · `primaryLight` (selected wash) · `primaryXLight` (band top stop, badge bg) · `link` (= primaryDark; blue links are gone) |
| Text | `text` · `textSub` (body/secondary) · `textLight` (≥ 14 px only, never body copy) · `onDarkSub` (secondary text on dark toasts) |
| Semantic | `danger` / `dangerLight` / `dangerBorder` · `warning` / `warningLight` / `warningBorder` / `warningText` · `success` / `successLight` / `successBorder` / `successText` · `info` / `infoLight` |
| Deal | `deal` / `dealDark` / `dealLight` — % off, savings, coupon tags ONLY. Never errors or CTAs. |
| Overlays | `scrim` · `skeletonLo` / `skeletonHi` · `shadow` |

Rules: no hex or rgba literal in `app/` or `components/` (not even a token-derived one — W3 removed DoodleBackdrop's `SoftPanel` wash with its end stop). No local `const T = {…}` palettes. The old aliases for danger / deal / dealLight were deleted in W3 — use `C.danger`, `C.deal`, `C.dealLight`. The one hex that lives outside `constants/colors.ts` is the notification accent in `app.config.js` (it mirrors `C.primary`). `constants/categoryTints.ts` is the one sanctioned exception to the single-palette rule: 8 pastel washes behind category art (data, not chrome — CONTRACTS §1.3; W3 r2 F7 keeps them out of `C` so every `C` value stays a plain colour string).

### Text presets — `text.*` (family via `fontFamily.*`, never `fontWeight`)

| Group | Preset — family / size / lineHeight |
|---|---|
| Display | `display` 800 / 44 / 48 · `h1` 800 / 24 / 30 · `h2` (= `tabTitle`) 800 / 22 / 28 · `h3` 700 / 17 / 22 |
| Titles | `screenTitle` 800 / 18 · `screenTitleLg` 800 / 20 · `sectionTitle` 800 / 15 · `sectionTitleLg` 800 / 17 · `cardTitle` 800 / 15 · `emptyTitle` 800 / 16 |
| Body | `bodyLg` 400 / 16 / 24 · `body` 400 / 14 / 20 · `bodyStrong` 600 / 14 · `bodySm` 400 / 13 / 19 · `rowTitle` 700 / 14 · `rowSubtitle` 400 / 12 · `rowValue` 400 / 13 · `label` 600 / 12 · `caption` 500 / 11 / 14 · `eyebrow` 700 / 11 uppercase |
| Commerce | `cardName` 600 / 12 / 16 · `cardUnit` 500 / 11 / 14 · **`cardPrice` 700 / 13 / 16 (NOT 800)** · `mrp` 400 / 11 line-through · `price` 800 / 28 ink (`C.text`) · `priceLg` 800 / 22 · `amount` 800 / 18 · `amountLg` 800 / 22 |
| Controls | `buttonLg` 800 / 16 · `button` 800 / 15 · `buttonSm` 700 / 14 · `buttonXs` 700 / 13 (all `C.onPrimary`) · `link` 700 / 13 `C.link` · `badge` 700 / 12 · `badgeSm` 700 / 11 · `code` 500 / 12 tabular · `codeSm` 500 / 11 tabular |

Rules: nothing under 11 px, no fractional sizes, **nothing under 14 px is ExtraBold** (D10 — no exceptions, which is why `cardPrice` is 700). The loaded Jakarta faces are `fontFamily.regular | medium | semibold | bold | extrabold` → `PlusJakartaSans_400Regular … _800ExtraBold` (five faces; the Light face is no longer loaded — W1.5); `fontWeight` silently drops to the system font on Android. Monospace (`Platform.select({ ios: 'Menlo', android: 'monospace' })`) is allowed only under `components/dev/*` (D11 Q1). Dense new text gets `maxFontSizeMultiplier={1.3}`. Sentence case everywhere.

### Radius, spacing, layout, shadow

- `radius`: xs 4 · sm 6 · md 8 · lg 10 · xl 12 (most common) · xxl 14 · card 16 · xxxl 20 · sheet 24 · pill 999. Write `radius.xl`, never `borderRadius: 12`.
- `space[2…40]` raw scale. `layout`: `gutter` 16 · `gutterTight` 12 · `scrollBottom` 40 · `scrollBottomTab` 120 (tab screens + above docks) · `cartBarHeight` 56 · `cartBarGap` 12 · `dockPaddingTop` 14 · `dockMinInset` 12 · `tabHeaderBand` 84 · `searchBandHeight` 48 · `railCardWidth` 132 · `gridGap` 8. New code reads the live dock height with `useDockHeight()`, not `layout.dockBottom`.
- `shadow.card | cardMd | cardLg | primarySm | primaryLg | dock | sheet` always pair iOS `shadow*` with Android `elevation`. Android drops elevation under `overflow: hidden`: clip an INNER view (`clipOverflow`), keep the shadow on the OUTER view.
- `HIT_SLOP` 8 (hoist hit slops to module scope; lift targets < 44 pt to 44 pt) · `TAB_BAR_BASE_HEIGHT` 60 (the tab bar is absolute) · `iconSize.xs…heroLg` 14–56 · `iconWrap.sm|md|lg` 34/38/44 · `border.thin|input|emphasis` 1/1.5/2. `opacity.press*` exist for legacy reads only — new code never uses opacity fades.

### Motion — `motion.*` (codename onyx)

- Durations (system-driven): `instant` 80 · `fast` 120 · `base` 220 · `slow` 340 · `slower` 520 · `countUp` 900. Springs (finger-driven): `press` {18, 280} · `pop` {14, 220} · `gentle` {20, 160} · `bouncy` {12, 180} · `snappy` {22, 320, mass 0.8}.
- Scales: `row` 0.98 · `cta` 0.97 · `card` 0.97 · `tile` 0.94 · `chip` 0.94 · `icon` 0.9 · `pop` 1.08 · `popLg` 1.15. Also `imageFade` 120 · `stagger` 60 · `skeletonPeriod` 1100 · `pulsePeriod` 1400 · `swipeDismiss` {80 px, 800} · `sheetDismiss` {0.3, 1000}.
- Presets from the barrel: `ease`, `dur`, `spr`, `enter`, `exit`, `layoutSpring`, `layoutTiming`, `useMotionReduced()`, `useLayoutTransitionsEnabled()`, `MotionConfig`; primitives `PressableScale`, `Pulse`, `Shake`, `Collapsible`/`ChevronRotate`, `AnimatedNumber`, `Confetti`.
- Reanimated 4 only: shared values via `.set()` / `.get()` (React Compiler); no `LayoutAnimation`; no new RN `Animated`; no `entering`/`exiting` on recycled FlashList cells — a `ProductCard` rendered by a FlashList passes `recycled`, which turns the Stepper's width morph and enter/exit crossfades off (`animateLayout={false} animateSwap={false}`); the Stepper never fades its controls in on mount either (the fade is latched to an in-place ADD). Reduced motion (OS setting or `Dev_Onyx_inhibit_Animations`) → scale 1, no shimmer, no loops. The only idle loops allowed are the shared Skeleton clock and the payment overlay halo; motion is otherwise a response to input. Route transitions read the same `useMotionReduced()`.

## 3. The press recipe

`PressableScale` (or `usePressScale()` for cells that own their `Pressable`) replaces every `TouchableOpacity` and opacity fade:

- `scale` default `motion.scale.card` 0.97; rows pass `motion.scale.row` 0.98, tiles/chips 0.94, icons 0.9. `spring` default `motion.spring.press` {damping 18, stiffness 280}.
- `pressedStyle` is the background highlight: rows `C.bgSoft`, tiles `C.border`, primary CTA `C.primaryDark`, selected pills fill solid. `style` = the outer `Animated.View` (receives the transform); `innerStyle` = the `Pressable` itself (keeps dividers outside the scaled view).
- `accessibilityRole="button"` by default; icon-only controls must pass `accessibilityLabel`; stepper labels include the product name; use `accessibilityState` for `disabled` / `selected` / `checked` / `expanded` / `busy`.
- **Haptics are OFF by default (`haptic={false}`).** A press that only navigates or opens something — tiles, banners, avatar, search band, icon buttons, rows, cards, CTAs, back, share, close — is silent. Opt in ONLY where the press itself changes state: `Chip` 'select' (pass `haptic={selected ? false : "select"}` so re-pressing the active chip is silent), `Toggle` 'toggle', `SegmentedControl` 'select', rating stars 'select', dev-panel controls. A control that toggles OFF as well as ON (tip chips, wallet quick chips) calls `feedback.toggle(on)` in its handler with `haptic={false}` — the prop path cannot carry the direction. Never pass `haptic` to a control whose handler mutates the cart — `CartContext` fires add/remove itself. `sound` (ui_tap) is for pull-to-refresh and dev controls only (a tab switch is a `select` haptic with no sound — D11 Q2). `Chip` takes `accessibilityRole="tab"` inside a `tablist` strip and `"radio"` inside a `radiogroup`.

## 4. Feedback rules — `lib/feedback.ts` (codename sirius)

One gesture → one haptic → at most one sound. Screens call the semantic pairs (`feedback.add()`, `feedback.select()`, …), never `expo-haptics` / `expo-audio` directly. Pure navigation is silent. Toasts are silent. Order placement plays `success` exactly once, on the confirmation screen (checkout fires nothing on success). `feedback.success()` is **reserved for order placement** (W3 F7 / R2-24, lead decision): every other saved / verified moment is a toast plus `feedback.tap()` (light haptic, no sound), and wallet top-up is `feedback.coin()`. Where each event may play (CONTRACTS §8):

| Event | Call | Where |
|---|---|---|
| Any press that only navigates or opens something (tiles, banners, avatar, search band, icon buttons, rows, cards, CTAs, back, share, close) | **none** — primitive defaults are `haptic={false}` | every primitive default |
| Press that changes a selection/state in place | `feedback.select()` (Chip default, SegmentedControl, stars, map settle, recents/trending chip that sets the query) · `feedback.toggle(on)` (Toggle, tip chips, payment radio, address pick, heart) | Chip `haptic` prop, Toggle, SegmentedControl, rate screen, select-map |
| Cart add / + | `feedback.add()` | CartContext mutation |
| Cart − / remove / clear | `feedback.remove()` | CartContext mutation (clear fires once; batch restores silent) |
| Max 99 | `feedback.error()` + toast | Stepper |
| Tab switch | `feedback.select()` — haptic only, no sound (D11 Q2) | `(tabs)/_layout` |
| Pull-to-refresh trigger | `feedback.tapSound()` | each `onRefresh` |
| Sheet open | `feedback.swoosh()` | BottomSheet |
| View cart | `feedback.swoosh()` | CartBar, PDP strip |
| Order placed, and Pay-now completion of a placed order (orders / order detail) (every payment mode) — and nothing else | `feedback.success()` | **Reserved for order placement (W3 F7 / R2-24, lead decision).** The order-placement chime fires once per order id from the confirmation screen only — the mount via SuccessHeader's low-level pair (next row; skipped for orders older than 10 min), and `app/order/confirmation/[id].tsx` itself is the only app caller of `feedback.success()`, once, when its explicit "Add items" payment is verified. The only other callers are `lib/feedback.ts` itself and the dev-only `components/dev/` sound previews / DevUnlockSheet |
| Any other saved / verified moment — profile name saved, address added / edited, email verified, OTP verified, rating submitted | toast + `feedback.tap()` | one light haptic per completed submit, never per field; the toast stays silent; these sites used to play `success` and must not again |
| Reorder batch added ("Add all", OrderRow reorder) | ONE `feedback.add()` per batch | `addMany({ silent: true })` plays nothing per line, so the batch gets the single cart-add pair, then the toast — never `success`, never a sound per line |
| The SuccessHeader exception | low-level `haptic('success')` + `sound('success')` instead of `feedback.success()` | `components/confirmation/SuccessHeader.tsx` only — so `Dev_Nova_inhibit_Chime` can drop the chime while the haptic stays |
| Payment failed/cancelled / wrong OTP / validation summary / tip cap / wrong PIN | `feedback.error()` (once, not per field) | checkout, otp, DevUnlockSheet |
| Wallet top-up verified / coupon applied | `feedback.coin()` | wallet, coupons |
| Clear cart confirmed / long-press recognised | `feedback.heavy()` — checkout calls `clearCart({ silent: true })` so the store's `remove` does not stack on it | checkout, DevPill |
| Status advanced while focused / delivered / went offline | `feedback.passive('tap' \| 'success' \| 'error')` — machine events; never exempt from the boot silence | tracking hook consumer, OfflineBanner |
| Toasts | NEVER a sound; `haptic('error')` only for error/warning tones when no `feedback.error()` fired in the last 300 ms | ToastHost |

Platform note (CONTRACTS §2.1): **Silent mode: iOS ring/silent switch mutes UI sounds; Android has no media silent switch — sounds follow media volume + the in-app Sounds toggle; haptics follow the OS touch-feedback setting.** Everything no-ops on web and while the app is not active. User prefs live in `nn:prefs:sounds` / `nn:prefs:haptics` (device-scoped, survive logout).

## 5. Overlay model

- `ToastHost` is a plain absolute `View` sibling of `<Stack>` (`pointerEvents="box-none"`) — NOT an RN `Modal`. Modals have no touch pass-through, so a Modal toast would freeze the app for its whole duration. It renders `<ToastLayer/>` unless an overlay layer is registered. Its bottom clears the CartBar when visible, otherwise the dock / tab bar plus Home's active-orders lift (`useCartBarExtraBottom()`), which is published independently of the bar's visibility.
- `OfflineBanner` is rendered IN FLOW above the `<Stack>` (it pays `topInset` itself and reports `onVisibleChange`, and AppShell zeroes the top safe-area inset for the screens below while it shows) — an absolute band hid every header for the whole offline duration. Keep it out of `elevation`: an opaque strip with elevation casts a shadow on Android.
- Sheets (`BottomSheet`, an RN Modal) carry their own `<ToastLayer/>` while visible and hold `registerToastLayer()`; while any layer is registered the root host renders nothing, so a toast is never drawn twice and is visible and tappable over the sheet.
- Every Modal that hosts a gesture wraps its content in `GestureHandlerRootView` (RNGH gestures inside an RN Modal are inert on Android without it). Never `onClose()` a Modal and `router.push()` in the same tick — push in `onDismiss`.
- Floating things compose their bottom offsets: cart bar footprint (`useCartBarFootprint`) + dock height (`useDockHeight`) + safe-area insets + `TAB_BAR_BASE_HEIGHT` on tab screens. Native permission prompts are wrapped in `beginNativePrompt()` / `release()` and never race a navigation.

## 6. Loading, empty, error

Skeleton-first: the loading layout mirrors the real one inside `<SkeletonScreen label="Loading…">` (role `progressbar`); `Skeleton animated` shares one module clock, `shimmer` only for hero blocks ≥ 80 px; skeleton colour matches the screen background. Every skeleton gate goes through `useForceSkeleton(loading)` so `Dev_Onyx_inhibit_SkeletonExit` can hold it. Every screen has an explicit empty AND error state: one `EmptyState`, one CTA, Retry on error; error states pass `tone="error"` (the one error treatment: a C.dangerLight circle with a C.danger glyph). Pull-to-refresh never replaces content with a spinner; `RefreshControl` is tinted `C.primary`. Errors surface through `logError` / `logSilentFailure` (the only Sentry hook points) — never a bare `.catch(() => {})`.

## 7. Dev flags — `lib/devFlags.ts` (codename indigo)

- Shape (D1): `Dev_<Feature>_inhibit_<Target>` — `<Feature>` is the codename (`Dev_Cyan_inhibit_Feature`) or the area (`Dev_Network_inhibit_LatencyMs`). The registry is one `as const` `DEV_FLAGS` object; every entry carries `area`, `type` (`'bool' | 'number' | 'enum' | 'string'`), `default`, `label`, `help` (+ optional `simulates`, `restart`). Every codename also has a master `Dev_<Codename>_inhibit_Feature` (bool, default false = feature ON).
- Read patterns: `getDevFlag('Dev_X_inhibit_Y')` in handlers, effects and module code; `useDevFlag('Dev_X_inhibit_Y')` in render; never `getDevFlag()` inside the render of a memoised list cell. Flags return their DEFAULT while dev mode is locked. Never add a dead read to satisfy a grep — only a card's "Dev flags to wire" list is grep-gated.
- Gate (D2): shake → neutral version toast (3 s) → 5 taps within 3 s → PIN sheet. PIN = `process.env.EXPO_PUBLIC_DEV_PANEL_PIN || getAppExtra().devPanelPin || '7391'`. `EXPO_PUBLIC_DEV_PANEL_PIN` is REQUIRED in the EAS production profile; otherwise the panel's Env tab shows "PIN source: default" in red. Fallback trigger: 3 s long-press on the ProfileMenu footer brand.
- Codenamed main modules start with `// codename: <name>` on line 1 (CONTRACTS §10); codenames never appear in user-facing copy.

## 8. Config, env, scripts

- `.env.example` lists every `EXPO_PUBLIC_*` the app reads (no values). Reads use the static two-layer pattern `process.env.EXPO_PUBLIC_X || getAppExtra().x`; `lib/appExtra.ts` is the ONLY place `extra` is cast. Never give a secret the `EXPO_PUBLIC_` prefix. `app.config.js` is portrait, light-only, `["expo-audio", { recordAudioAndroid: false }]`, `["expo-sensors", { motionPermission: false }]`.
- Scripts: `npm run typecheck` · `npm run lint` / `npm run lint:fix` · `npm run doctor` · `npm run routes:types` · `npm run check` (routes:types + typecheck + lint). Never run `prebuild:android`, `keystore:generate` or the deleted `reset-project`.
- Typed routes: after adding, removing or renaming anything under `app/`, run
  `EXPO_ROUTER_APP_ROOT=$PWD/app node -e "require('expo-router/build/typed-routes').regenerateDeclarations('.expo/types')"` (= `npm run routes:types`) before `tsc`. Absolute hrefs only; no `as any` / `as Href` (use `parseReturnTo`); `router.replace` for flow transitions, `router.push` for drill-ins; omit `onBack` so `BackButton`'s `canGoBack() ? back() : replace(fallbackHref)` applies.

## 9. The owner's design direction (MAP §3 — every primitive migration must match it)

1. Press feedback = `Pressable` + background highlight + scale spring (0.98 rows / 0.97 CTAs / 0.94 tiles & chips); opacity fades are out.
2. Flat, card-less, gradient-less layouts; hairlines and 8 px bands as separators; bare glyphs instead of tinted icon chips; no CTA shadows.
3. Underline inputs with animated focus colour.
4. Typographic heroes (big numbers/names as text).
5. Pills fill solid when selected.
6. Sentence case everywhere.
7. Circular avatars, no shadow.
8. `right={null}` / `iconBg="transparent"` `ListRow` idioms.
9. Quieter footers.
10. No idle/looping animations — motion only as a response to input.

Never revert `ListRow`, `ProfileMenu`, `wallet` or `profile` to `TouchableOpacity`, cards, gradients or looping animations; migrate them forward with identical visual results.

## 10. W3 audit greps (run them before you report)

```bash
# Code only (`--include`), so prose in this file never trips an audit.
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" app components --include=*.ts --include=*.tsx     # empty
grep -rn "const T = {" app components --include=*.ts --include=*.tsx                          # empty
grep -rln "TouchableOpacity" app components --include=*.ts --include=*.tsx                    # empty
grep -rnE "fontWeight\s*:" app components constants --include=*.ts --include=*.tsx            # empty (constants/ui.ts:67-69 comments explain the ban)
grep -rn "LayoutAnimation" app components hooks --include=*.ts --include=*.tsx                # empty
grep -rn "as any" app components hooks lib --include=*.ts --include=*.tsx                     # empty (comments say "any-cast")
grep -rn "haptic=" app components --include=*.tsx | grep -v "haptic={false}"                  # only state-changing controls
grep -rn "feedback.success" app components --include=*.ts --include=*.tsx                     # only app/order/confirmation/[id].tsx (+ dev-only components/dev/) — section 4
grep -n "<Modal" components/ui/Toast.tsx                                                      # empty — ToastHost is a View
grep -n "sound(\|feedback\.\(success\|error\|coin\)" components/ui/Toast.tsx                  # empty — toasts are silent
grep -n "GestureHandlerRootView\|ToastLayer\|registerToastLayer" components/ui/BottomSheet.tsx   # all three present
grep -rn "components/ui/[A-Z]" app components --include=*.ts --include=*.tsx | grep -v "components/ui/index" | grep -v "components/ErrorBoundary.tsx"   # empty
grep -rn "withRepeat\|Animated.loop\|setInterval" app components hooks lib --include=*.ts --include=*.tsx   # each hit justified
grep -rn "Alert.alert" app components --include=*.ts --include=*.tsx | wc -l                  # ≤ 20, confirmations / unrecoverable only
# codename headers — line 1 of each CONTRACTS §10 main module (no output = pass)
for f in components/ui/CartBar.tsx components/ui/Toast.tsx components/ui/Stepper.tsx lib/feedback.ts lib/deliveryEta.ts \
  lib/recentSearches.ts "app/product/[id].tsx" app/orders.tsx "app/order/rate/[id].tsx" "app/order/confirmation/[id].tsx" \
  hooks/useOrderTracking.ts app/wallet.tsx constants/banners.ts components/ui/BottomSheet.tsx context/ProfileMenuContext.tsx \
  constants/colors.ts components/ui/motion/presets.ts "app/(tabs)/_layout.tsx" lib/devFlags.ts lib/network.ts \
  app/location/select-map.tsx lib/notificationService.ts app/support/checkout.tsx lib/couponService.ts lib/queryCache.ts \
  lib/wishlistStore.ts app/_layout.tsx; do head -1 "$f" | grep -q "codename:" || echo "MISSING $f"; done
```
