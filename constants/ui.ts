// constants/ui.ts
// Non-color design tokens derived from what the codebase already does most often.
// Values intentionally match the modal values in app/** so adopting a token where a
// screen already uses that number changes nothing visually. Colors stay in ./colors —
// this file only *references* the existing `C` palette (for shadow colors).
import { Platform, type TextStyle, type ViewStyle } from "react-native";

import { C } from "./colors";

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
  dockBottom: 28,        // hardcoded bottom padding of absolute bottom bars (cart, product, order, checkout)
  emptyTop: 80,          // EmptyState marginTop (orders, notifications, payments)
  emptyPadding: 32,
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

// ─── Typography (system font — no custom fonts are loaded) ────────────────────
// Weights are strings as everywhere in the codebase. Android/Roboto renders 800/900 as 700.
export const font = {
  size: { 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, 15: 15, 16: 16, 17: 17, 18: 18, 20: 20, 22: 22, 24: 24, 28: 28 },
  weight: { medium: "500", semibold: "600", bold: "700", heavy: "800", black: "900" },
} as const satisfies {
  size: Record<number, number>;
  weight: Record<string, NonNullable<TextStyle["fontWeight"]>>;
};

// Text presets. (Named `text`, not `type`, because `type` reads like a TS keyword at call sites.)
// Usage: `<Text style={text.screenTitle}>` or `StyleSheet.create({ title: { ...text.rowTitle, flex: 1 } })`.
export const text = {
  // Headers
  screenTitle: { fontSize: 18, fontFamily: "PlusJakartaSans_800ExtraBold", color: C.text },                                     // support/profile/terms/payments/order/cart/coupons (8)
  screenTitleLg: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 20, color: C.text },                                     // orders/notifications/invoice/location
  screenSubtitle: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12, color: C.textSub, marginTop: 2 },                    // "3 orders", "2 unread"
  tabTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, color: C.text, letterSpacing: -0.4 },                // categories / order-again / ProfileMenu
  // Section labels
  eyebrow: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 11, color: C.textSub, textTransform: "uppercase", letterSpacing: 0.7 }, // support sectionTitle, profile label
  sectionTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15, color: C.text },                                     // order/[id], track, cart billTitle
  sectionTitleLg: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 17, color: C.text },                                     // confirmation, emptyTitle in cart/home
  // Rows / cards
  rowTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, color: C.text },                                     // 13 uses — most common bold body
  rowSubtitle: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, color: C.textSub },                                                     // 27 uses — most common text style overall
  rowValue: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 13, color: C.textSub },                                                     // support infoValue
  cardTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15, color: C.text },                                     // orders orderNum
  // Body
  body: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 14, color: C.textSub, lineHeight: 20 },                                     // errorText/emptyText/desc (17)
  bodyStrong: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 14, color: C.text },                                     // item names (7)
  bodySm: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 13, color: C.textSub, lineHeight: 19 },                                     // 20 uses; lineHeight 19 is the modal lineHeight
  label: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12, color: C.textSub },                                  // qtyLabel, projectedLabel (9)
  caption: { fontFamily: "PlusJakartaSans_300Light", fontSize: 11, color: C.textLight },                                                   // timestamps, helper text
  // Amounts
  amount: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 18, color: C.text },                                     // orders total, checkout totalValue
  amountLg: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, color: C.text },                                     // cart projectedAmount, product name
  price: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 28, color: C.primary },                                  // product price
  // Buttons (white text is the literal "#fff", as in the 61 existing uses)
  buttonLg: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 16, color: "#fff", letterSpacing: 0.3 },                 // product addBtn, location CTAs
  button: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 15, color: "#fff" },                                     // profile save, wallet add (full-width CTA)
  buttonSm: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, color: "#fff" },                                     // retry / shop buttons
  buttonXs: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 13, color: "#fff" },                                     // trackBtn / inline
  link: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 13, color: C.primary },                                  // "Mark all read", "Add more"
  // Badges / empty
  badge: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 12 },
  badgeSm: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 10 },
  emptyTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 16, color: C.text },
  emptyText: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 14, color: C.textSub, textAlign: "center", lineHeight: 20 },
} as const satisfies Record<string, TextStyle>;
export type TextPreset = keyof typeof text;

// ─── Shadows (iOS shadow* + Android elevation always paired, as in every screen) ─
export type Shadow = Pick<ViewStyle, "shadowColor" | "shadowOffset" | "shadowOpacity" | "shadowRadius" | "elevation">;
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
  backIcon: "arrow-left",
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

// ─── Misc ─────────────────────────────────────────────────────────────────────
export const HIT_SLOP = 8;                     // ties with 6; 8 is what the header/back buttons already use
export const TAB_BAR_BASE_HEIGHT = 60;         // app/(tabs)/_layout.tsx: height = 60 + insets.bottom, position absolute
export const iconSize = { xs: 14, sm: 16, md: 18, lg: 20, xl: 22, xxl: 28, hero: 48, heroLg: 56 } as const;
export const iconWrap = { sm: 34, md: 38, lg: 44 } as const; // radius: lg→12, md→12, sm→10
export const opacity = { pressIcon: 0.7, pressCard: 0.85, pressCta: 0.8, disabled: 0.45 } as const;
export const border = { thin: 1, input: 1.5, emphasis: 2 } as const;
/** Android drops elevation when a parent has overflow:hidden — track/[id] already guards this way. */
export const clipOverflow: ViewStyle["overflow"] = Platform.OS === "android" ? "hidden" : "visible";
