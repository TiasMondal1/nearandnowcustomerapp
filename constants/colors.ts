// codename: boreal — one brand (forest green on cream). No other palette object may exist anywhere;
// the ONE sanctioned data exception is `constants/categoryTints.ts` (8 pastel washes behind category
// art — tints, not chrome; CONTRACTS §1.3 — kept out of `C` so every value here stays a plain colour).
// Every colour in the app comes from `C`. Screens that still hold a local `T` palette delete it
// and map onto these tokens (CONTRACTS §1.1 has the T → C table).
export const C = {
  // Surfaces
  bg: '#FAFAF7',            // cream — browse tabs, category, search, tracking page ground
  bgSoft: '#F3F1EB',        // sand — pressed rows, chips idle, soft fills
  surfaceBand: '#F7F6F2',   // 8 px separator bands between flat sections (owner's wallet pattern)
  card: '#FFFFFF',
  white: '#FFFFFF',
  onPrimary: '#FFFFFF',     // text/glyphs on C.primary
  border: '#E5E7EB',
  borderSoft: '#F0F0F0',
  hairline: 'rgba(60,47,30,0.08)', // card borders on cream

  // Brand
  primary: '#2D7A4F',
  primaryDark: '#245F3E',   // pressed CTA face, links
  primaryLight: '#D6EDE0',  // selected wash, toast action label on dark
  primaryXLight: '#EAF6EE', // tab-header band top stop, badge primary bg
  link: '#245F3E',          // = primaryDark; blue links are gone

  // Text
  text: '#1F2937',
  textSub: '#6B7280',
  textLight: '#8A8F98',     // AA on white only at >= 14 px; never body copy
  onDarkSub: 'rgba(255,255,255,0.8)', // secondary text on C.text (toasts)

  // Semantic
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  dangerBorder: '#FCA5A5',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  warningBorder: '#FCD34D',
  warningText: '#92400E',
  success: '#10B981',
  successLight: '#D1FAE5',
  successBorder: '#86EFAC',
  successText: '#065F46',
  info: '#3B82F6',
  infoLight: '#DBEAFE',

  // Deal/discount accent (terracotta) — the ONLY hue besides the greens that
  // carries brand meaning. Use SPARINGLY and only for commercial-benefit
  // signals: % -off badges, "You save ₹X" lines, coupon tags. Never for
  // errors (danger), warnings (warning), success states or CTAs.
  deal: '#EA580C',      // badge/chip backgrounds with white text
  dealDark: '#C2410C',  // deal-colored TEXT on white/light backgrounds (AA contrast)
  dealLight: '#FFEDD5', // tinted background behind dealDark text

  // Overlays / loading
  scrim: 'rgba(0,0,0,0.55)',
  skeletonLo: '#EFEDE7',
  skeletonHi: '#F7F5EF',
  shadow: '#000',
} as const;
export type ColorToken = keyof typeof C;
