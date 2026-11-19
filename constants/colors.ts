// codename: boreal — one brand (saffron on cream, cocoa ink, a leaf-green accent — the "doorway n" logo:
// a saffron n with a green sprout). No other palette object may exist anywhere;
// the ONE sanctioned data exception is `constants/categoryTints.ts` (8 pastel washes behind category
// art — tints, not chrome; CONTRACTS §1.3 — kept out of `C` so every value here stays a plain colour).
// Every colour in the app comes from `C`. Screens that still hold a local `T` palette delete it
// and map onto these tokens (CONTRACTS §1.1 has the T → C table).
//
// Two rules keep the two brand hues apart:
//   · SAFFRON (`primary*`) = brand, CTAs, selection, navigation, links.
//   · LEAF GREEN (`success*`, `deal*`) = positive meaning only: done / delivered / verified / paid / FREE /
//     savings. A tick, a "Delivered" pill or a "You save" line is never saffron; a button is never green.
// Contrast (WCAG, measured — not guessed): `primary` carries white at 3.5:1, so it is for button FACES with
// bold labels, glyphs and bold labels on white/cream. Brand-coloured text that is not bold uses `primaryDark`.
export const C = {
  // Surfaces
  bg: '#FBF6EE',            // cream — browse tabs, category, search, tracking page ground
  bgSoft: '#F1E7D8',        // sand — pressed rows, chips idle, soft fills
  surfaceBand: '#F6EFE3',   // 8 px separator bands between flat sections (owner's wallet pattern)
  card: '#FFFFFF',
  white: '#FFFFFF',
  onPrimary: '#FFFFFF',     // text/glyphs on C.primary (pure white, not the logo's icon cream: 3.5:1 vs 3.3:1)
  border: '#E3D8C8',        // warm sand-grey
  borderSoft: '#EEE6DA',
  hairline: 'rgba(58,36,24,0.08)', // card borders on cream (cocoa at 8 %)

  // Brand
  primary: '#E85D0F',       // saffron — CTA faces, selection, glyphs, BOLD labels (3.5:1 on white)
  primaryDark: '#B0410A',   // pressed CTA face, links, non-bold brand text (5.8:1 on white, 5.4:1 on cream)
  primaryLight: '#FCE1CE',  // selected wash, toast action label on dark
  primaryXLight: '#FDEFE4', // tab-header band top stop, badge primary bg
  link: '#B0410A',          // = primaryDark; blue links are gone

  // Text
  text: '#3A2418',          // cocoa
  textSub: '#6B4A38',       // soft cocoa
  textLight: '#876755',     // 5.1:1 on white, 4.8:1 on cream; only 4.2:1 on sand — never body copy on bgSoft
  onDarkSub: 'rgba(255,248,238,0.88)', // secondary text on C.text (toasts) and on primaryDark chips

  // Semantic
  danger: '#D32121',
  dangerLight: '#FEE9E9',
  dangerBorder: '#FCA5A5',
  // Warning is a yellow-gold (hue 44°), deliberately NOT amber: amber sat one step from saffron (22°) and a
  // warning chip read as a brand element. `warning` is dark enough to carry a bold label on white (3.3:1).
  warning: '#B58400',
  star: '#F5B301',           // filled rating stars only — a glyph fill, never text
  warningLight: '#FFF6C7',
  warningBorder: '#F2D36B',
  warningText: '#7A5A00',
  // Success is the logo's leaf green.
  success: '#2F8F4A',       // glyphs, dots, bold labels (4.1:1 on white)
  successLight: '#E3F3E6',
  successBorder: '#A5D6B1',
  successText: '#1E6B37',   // success COPY (6.5:1 on white, 5.7:1 on successLight)
  info: '#3B82F6',
  infoLight: '#DBEAFE',
  infoText: '#1D4ED8',       // labels on infoLight (5.5:1); `info` itself is fill-grade

  // Deal/discount accent (leaf green — savings read as green). It was terracotta orange until the saffron
  // rebrand, where it collided with the brand colour. Use SPARINGLY and only for commercial-benefit
  // signals: % -off badges, "You save ₹X" lines, coupon tags. Never for errors (danger), warnings
  // (warning) or CTAs (primary). It shares the success family on purpose: a saving IS a positive.
  deal: '#2A8243',      // badge/chip backgrounds with white text (4.8:1 — a shade under `success` for small white type)
  dealDark: '#1E6B37',  // deal-colored TEXT on white/light backgrounds (AA contrast)
  dealLight: '#E3F3E6', // tinted background behind dealDark text

  // Overlays / loading
  scrim: 'rgba(42,24,16,0.55)', // dark cocoa
  photoScrim: 'rgba(42,24,16,0.66)',   // under text on a photo: white text is 5.5:1 even over a pure-white pixel
  photoScrimClear: 'rgba(42,24,16,0)', // the scrim's clear end (same RGB, so the fade has no grey fringe)
  skeletonLo: '#EFE6D8',
  skeletonHi: '#F8F1E6',
  shadow: '#000',
} as const;
export type ColorToken = keyof typeof C;
