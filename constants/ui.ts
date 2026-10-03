// constants/ui.ts
// Non-color design tokens derived from what the codebase already does most often.
// Values intentionally match the modal values in app/** so adopting a token where a
// screen already uses that number changes nothing visually. Colors stay in ./colors —
// this file only *references* the existing `C` palette (for text and shadow colors).
// Keep this file free of native deps (no reanimated import): `motion` is plain numbers.
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import { C } from './colors';

// ─── Spacing ──────────────────────────────────────────────────────────────────
// Raw scale = the numbers that actually appear (keyed by value so `space[14]`
// reads exactly like the literal it replaces). Not a strict 4-pt grid on purpose:
// 6, 10 and 14 are among the most-used values (gap 10 = #1 gap, padding 14 = #2).
export const space = {
  2: 2, 3: 3, 4: 4, 6: 6, 8: 8, 10: 10, 12: 12, 14: 14, 16: 16,
  20: 20, 24: 24, 28: 28, 32: 32, 40: 40,
} as const;

// Semantic aliases for the recurring roles.
export const layout = {
  gutter: 16,            // screen / scroll paddingHorizontal (48 uses) and header paddingHorizontal
  gutterTight: 12,       // list-screen header paddingHorizontal (orders, notifications, invoice)
  cardPadding: 14,       // r14 cards (7 uses)
  cardPaddingLg: 16,     // r16 cards (5 uses)
  cardGap: 12,           // marginBottom between stacked cards (orders) — notifications/AddressCard use 10
  rowPaddingX: 14,       // ListRow horizontal padding (support action, payment-options row)
  rowPaddingY: 13,       // ListRow vertical padding (support); 14 in payment-options/profile
  rowGap: 12,            // icon ↔ text gap inside a row
  sectionGap: 20,        // Section marginBottom (support)
  sectionLabelGap: 8,    // eyebrow marginBottom
  subtitleGap: 2,        // title → subtitle marginTop (37 uses)
  scrollBottom: 40,      // contentContainerStyle paddingBottom on non-tab screens (12 uses)
  scrollBottomTab: 120,  // paddingBottom when content sits above the absolute tab bar / a dock (120–160 in use)
  dockBottom: 28,        // legacy: hardcoded bottom padding of absolute bottom bars — new code uses useDockHeight()
  emptyTop: 80,          // EmptyState marginTop (orders, notifications, payments)
  emptyPadding: 32,
  // Docks / bars / bands
  cartBarHeight: 56,     // floating CartBar pill height
  cartBarGap: 12,        // gap between CartBar and the tab bar / dock below it
  dockPaddingTop: 14,    // BottomDock inner paddingTop
  dockMinInset: 12,      // BottomDock bottom inset floor when insets.bottom is 0
  tabHeaderBand: 84,     // TabHeader gradient band height (above the search band)
  searchBandHeight: 48,  // SearchBand row height
  // Catalog grids / rails
  railCardWidth: 132,    // horizontal ProductCard rail width
  gridGap: 8,            // ProductCard grid gap
} as const;

// ─── Radius ───────────────────────────────────────────────────────────────────
export const radius = {
  xs: 4,     // micro tags, skeleton lines (payment-options)
  sm: 6,     // saving badge, skeleton lines (home)
  md: 8,     // status badges, chips/tabs, small thumbnails, compact T add buttons
  lg: 10,    // compact buttons, inputs (profile/checkout), 30–36 icon wraps
  xl: 12,    // MOST COMMON (54): back button, 38–44 icon wraps, retry/default buttons
  xxl: 14,   // compact cards, primary CTA, search bar, escalate/logout, cart checkoutBtn
  card: 16,  // roomy cards, large CTAs
  xxxl: 20,  // wallet balance card, 40px avatars/circles
  sheet: 24, // bottom-sheet / detailsCard top corners (ProfileMenu uses 28)
  pill: 999,
} as const;
/** Circle radius for a square of `size` (38 → 19, 40 → 20). */
export const circle = (size: number) => size / 2;

// ─── Typography (Plus Jakarta Sans — five faces loaded in app/_layout.tsx) ───
// Weight is selected by FACE, never by `fontWeight`: with a custom family RN/Android
// does not synthesise weights, so `fontWeight` is a no-op at best and a fallback-to-
// Roboto at worst. Always set `fontFamily: fontFamily.<weight>`; never write `fontWeight`.
export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;
export type FontFace = keyof typeof fontFamily;

// `font` keeps `size` only; `font.weight` is DELETED (0 call sites — verified 2026-10-03).
export const font = {
  size: { 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, 15: 15, 16: 16, 17: 17, 18: 18, 20: 20, 22: 22, 24: 24, 28: 28 },
} as const satisfies {
  size: Record<number, number>;
};

// Text presets. (Named `text`, not `type`, because `type` reads like a TS keyword at call sites.)
// Usage: `<Text style={text.screenTitle}>` or `StyleSheet.create({ title: { ...text.rowTitle, flex: 1 } })`.
// D10: no preset under 11 px; no `extrabold` face under 14 px.
export const text = {
  // Display / headings
  display: { fontFamily: fontFamily.extrabold, fontSize: 44, lineHeight: 48, letterSpacing: -1.2, color: C.text },   // wallet balance, big numbers
  h1: { fontFamily: fontFamily.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, color: C.text },
  h2: { fontFamily: fontFamily.extrabold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: C.text },        // == tabTitle
  h3: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3, color: C.text },
  // Headers
  screenTitle: { fontFamily: fontFamily.extrabold, fontSize: 18, color: C.text },                                     // support/profile/terms/payments/order/cart/coupons (8)
  screenTitleLg: { fontFamily: fontFamily.extrabold, fontSize: 20, color: C.text },                                   // orders/notifications/invoice/location
  screenSubtitle: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.textSub, marginTop: 2 },                  // "3 orders", "2 unread"
  tabTitle: { fontFamily: fontFamily.extrabold, fontSize: 22, color: C.text, letterSpacing: -0.4 },                   // categories / order-again / ProfileMenu
  // Section labels
  eyebrow: { fontFamily: fontFamily.bold, fontSize: 11, color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.7 }, // support sectionTitle, profile label
  sectionTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: C.text },                                    // order/[id], track, cart billTitle
  sectionTitleLg: { fontFamily: fontFamily.extrabold, fontSize: 17, color: C.text },                                  // confirmation, emptyTitle in cart/home
  // Rows / cards
  rowTitle: { fontFamily: fontFamily.bold, fontSize: 14, color: C.text },                                             // 13 uses — most common bold body
  rowSubtitle: { fontFamily: fontFamily.regular, fontSize: 12, color: C.textSub },                                    // 27 uses — most common text style overall
  rowValue: { fontFamily: fontFamily.regular, fontSize: 13, color: C.textSub },                                       // support infoValue
  cardTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: C.text },                                       // orders orderNum
  // Product cards (ProductCard grid/rail)
  cardName: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 16, color: C.text },
  cardUnit: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.textSub },
  cardPrice: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 16, letterSpacing: -0.3, color: C.text },      // 700, NOT 800: D10 forbids extrabold under 14 px
  mrp: { fontFamily: fontFamily.regular, fontSize: 11, lineHeight: 14, color: C.textSub, textDecorationLine: 'line-through' },
  // Body
  bodyLg: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24, color: C.text },                            // sheet copy, long-form
  body: { fontFamily: fontFamily.regular, fontSize: 14, color: C.textSub, lineHeight: 20 },                           // errorText/emptyText/desc (17)
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 14, color: C.text },                                       // item names (7)
  bodySm: { fontFamily: fontFamily.regular, fontSize: 13, color: C.textSub, lineHeight: 19 },                         // 20 uses; lineHeight 19 is the modal lineHeight
  label: { fontFamily: fontFamily.semibold, fontSize: 12, color: C.textSub },                                         // qtyLabel, projectedLabel (9)
  caption: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14, color: C.textSub },                         // timestamps, helper text (was the Light face on textLight — AA fail)
  // Monospaced-feel values (tabular digits): order ids, codes, dev panel values
  code: { fontFamily: fontFamily.medium, fontSize: 12, color: C.text, fontVariant: ['tabular-nums'] as ['tabular-nums'], letterSpacing: 0.2 },
  codeSm: { fontFamily: fontFamily.medium, fontSize: 11, color: C.textSub, fontVariant: ['tabular-nums'] as ['tabular-nums'] },
  // Amounts
  amount: { fontFamily: fontFamily.extrabold, fontSize: 18, color: C.text },                                          // orders total, checkout totalValue
  amountLg: { fontFamily: fontFamily.extrabold, fontSize: 22, color: C.text },                                        // cart projectedAmount, product name
  price: { fontFamily: fontFamily.extrabold, fontSize: 28, color: C.text },                                           // product price — ink, not green
  priceLg: { fontFamily: fontFamily.extrabold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: C.text },   // product sheet / CartBar total
  // Buttons (label colour is C.onPrimary — the literal "#fff" is gone)
  buttonLg: { fontFamily: fontFamily.extrabold, fontSize: 16, color: C.onPrimary, letterSpacing: 0.3 },               // product addBtn, location CTAs
  button: { fontFamily: fontFamily.extrabold, fontSize: 15, color: C.onPrimary },                                     // profile save, wallet add (full-width CTA)
  buttonSm: { fontFamily: fontFamily.bold, fontSize: 14, color: C.onPrimary },                                        // retry / shop buttons
  buttonXs: { fontFamily: fontFamily.bold, fontSize: 13, color: C.onPrimary },                                        // trackBtn / inline
  link: { fontFamily: fontFamily.bold, fontSize: 13, color: C.link },                                                 // "Mark all read", "Add more"
  // Badges / empty
  badge: { fontFamily: fontFamily.bold, fontSize: 12 },
  badgeSm: { fontFamily: fontFamily.bold, fontSize: 11 },                                                             // was 10/800 (D10: min 11 px, no extrabold < 14)
  emptyTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: C.text },
  emptyText: { fontFamily: fontFamily.regular, fontSize: 14, color: C.textSub, textAlign: 'center', lineHeight: 20 },
} as const satisfies Record<string, TextStyle>;
export type TextPreset = keyof typeof text;

// ─── Shadows (iOS shadow* + Android elevation always paired, as in every screen) ─
export type Shadow = Pick<ViewStyle, 'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'>;
export const shadow = {
  none: { shadowOpacity: 0, elevation: 0 },
  card: { shadowColor: C.shadow,  shadowOffset: { width: 0, height: 1 },  shadowOpacity: 0.05, shadowRadius: 3,  elevation: 2 },  // cart itemCard, payments, AddressCard
  cardMd: { shadowColor: C.shadow,  shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.06, shadowRadius: 4,  elevation: 3 },  // ProfileMenu section, invoiceCard
  cardLg: { shadowColor: C.shadow,  shadowOffset: { width: 0, height: 3 },  shadowOpacity: 0.08, shadowRadius: 6,  elevation: 4 },  // orders card
  primarySm: { shadowColor: C.primary, shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.3,  shadowRadius: 4,  elevation: 3 },  // compact primary buttons (6)
  primaryLg: { shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },  shadowOpacity: 0.3,  shadowRadius: 8,  elevation: 6 },  // full-width CTAs (5)
  dock: { shadowColor: C.shadow,  shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 6,  elevation: 10 }, // bottom bars
  sheet: { shadowColor: C.shadow,  shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 20 }, // ProfileMenu
} as const satisfies Record<string, Shadow>;
export type ShadowName = keyof typeof shadow;

// ─── Header ───────────────────────────────────────────────────────────────────
export const header = {
  paddingX: 16,
  paddingY: 14,
  iconButton: 38,           // back button / right-slot square (25 uses of 38x38)
  iconButtonRadius: 12,     // 11 screens; list screens use circle(38)=19
  backIcon: 'arrow-left',
  backIconSize: 22,
  titleSize: 18,
  contentHeight: 38 + 14 * 2, // 66 — add 1 for borderBottom
  borderWidth: 1,
  // List-screen variant (orders, notifications, invoice): ScreenHeader size="lg"
  lg: {
    paddingX: 12,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 10,
    titleSize: 20,
    contentHeight: 38 + 16 + 14, // 68 — add 1 for borderBottom
  },
} as const;
export const HEADER_HEIGHT = header.contentHeight + header.borderWidth; // 67

// ─── Motion (codename: onyx) ──────────────────────────────────────────────────
// Durations for system-driven motion; springs for finger-driven motion. Plain numbers
// only — components wrap them in reanimated `withTiming` / `withSpring` themselves.
export const motion = {
  duration: { instant: 80, fast: 120, base: 220, slow: 340, slower: 520, countUp: 900 },
  spring: {
    press:  { damping: 18, stiffness: 280 },            // press in/out (home ProductCard today)
    pop:    { damping: 14, stiffness: 220 },            // one-shot emphasis (icon pop, CartBar bounce)
    gentle: { damping: 20, stiffness: 160 },            // sheets, pill snap
    bouncy: { damping: 12, stiffness: 180 },            // heart / star pop
    snappy: { damping: 22, stiffness: 320, mass: 0.8 }, // stepper width morph, digit roll
  },
  scale: { row: 0.98, cta: 0.97, card: 0.97, tile: 0.94, chip: 0.94, icon: 0.9, pop: 1.08, popLg: 1.15 },
  imageFade: 120,
  stagger: 60,
  skeletonPeriod: 1100,
  pulsePeriod: 1400,
  swipeDismiss: { distance: 80, velocity: 800 },
  sheetDismiss: { fraction: 0.3, velocity: 1000 },
} as const;

// ─── Misc ─────────────────────────────────────────────────────────────────────
export const HIT_SLOP = 8;                     // ties with 6; 8 is what the header/back buttons already use
export const TAB_BAR_BASE_HEIGHT = 60;         // app/(tabs)/_layout.tsx: height = 60 + insets.bottom, position absolute
export const iconSize = { xs: 14, sm: 16, md: 18, lg: 20, xl: 22, xxl: 28, hero: 48, heroLg: 56 } as const;
export const iconWrap = { sm: 34, md: 38, lg: 44 } as const; // radius: lg→12, md→12, sm→10
// Legacy TouchableOpacity fades. New code uses PressableScale + motion.scale.* and never opacity fades.
export const opacity = { pressIcon: 0.7, pressCard: 0.85, pressCta: 0.8, disabled: 0.45 } as const;
export const border = { thin: 1, input: 1.5, emphasis: 2 } as const;
/** Android drops elevation when a parent has overflow:hidden — track/[id] already guards this way. */
export const clipOverflow: ViewStyle['overflow'] = Platform.OS === 'android' ? 'hidden' : 'visible';
