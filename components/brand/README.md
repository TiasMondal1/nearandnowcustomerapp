# components/brand

The brand's primitives: the logo, the sprout, the doorway shape and the bundled photos. Screens import from the barrel (`"../../components/brand"`). Files inside `components/ui` import by file (`../brand/BrandLogo`), because `components/ErrorBoundary.tsx` reaches `EmptyState` by file and the crash path must stay light. Nothing here imports from `components/ui`.

## What is here

| File | What it is |
|---|---|
| `brand.ts` | `BRAND_NAME`, `BRAND_TAGLINE`, the `LOGO` files with their aspects, `SPROUT` |
| `photos.ts` | `PhotoSlot`, `PHOTOS`, `hasPhoto(slot)` |
| `shape.ts` | `doorwayRadii(width)`, `sproutOnFrame(width)` |
| `BrandLogo` | The only way a logo is drawn. `variant`, `height` (default 24), `decorative` (default true) |
| `Sprout` | The logo's green leaves. `width` (default 34), always decorative |
| `BrandFrame` | The doorway tile behind a glyph. `size` (default 80), `ratio`, `sprout` |
| `BrandPhoto` | The only way a bundled photo is drawn. `slot`, `shape` ("doorway", "card" or "fill"), `width` (default 112), `sprout`, `priority`. Fades in over 220 ms (`motion.photoFade`) on its sand ground |
| `PhotoScrim` | The only way text sits on a photo: `BrandPhoto shape="fill"`, a cocoa scrim, then children. `slot`, `side` ("left": solid over the left 55 %; "bottom": solid over the bottom 45 %), `priority`. Built-in surface: radius 16, hairline, clipped. Returns `null` for an unfilled slot |
| `BrandSignOff` | Closing signature: optional line, horizontal logo, tagline, children |
| `BrandStoryCard` | A card photo with a title and a body line under it |

## Brand rules (binding)

1. The name "Near & Now" as a signature is always a logo image, never retyped in Plus Jakarta Sans. Running sentences ("Near & Now wallet") stay as text. No Outfit font is loaded.
2. One full-colour logo per viewport. Lockups by job: stacked for boot, auth, welcome and the update gate; horizontal for letterheads and sign-offs; the mark alone for the tab header and the wallet header.
3. The tagline is exactly `Digital Dukan, Local Dil Se` (the logo's spelling). It is live text (`BRAND_TAGLINE`), and it appears only under the welcome logo and in the sign-off. It is not added to headers, banners, toasts, share text or push copy.
4. The doorway shape frames every non-error empty-state tile and every portrait photo. Error states keep the red circle.
5. The sprout marks resting and positive moments only: chosen empty states, the order-placed tick, the delivered tick and end-of-list lines. Never on errors, "not found", "sign in" or permission states, and never on buttons.
6. Saffron is brand and action; leaf green is positive meaning. Unchanged from `constants/colors.ts`.
7. Photos are bundled and optional. Every slot has a non-photo fallback. No photo on task screens. Text may sit on a photo only inside `PhotoScrim` (and the two cards built on it, `PhotoCard` and `PhotoTile` in `components/cards`); nothing else may draw text over a photo. Text on a photo is always `C.onPrimary` (white), with no secondary tint, and stays inside the solid part of the scrim: the left 55 % of a wide card, the bottom 45 % of a tile.
8. Tokens only. No hex literal in `app/` or `components/`. The one palette exception is `constants/categoryTints.ts`, the sanctioned data file.
9. No new idle loops, shadows, sounds, haptics or dev flags. No network request for any brand asset. The only gradient added since the first pass is the `PhotoScrim` scrim (`C.photoScrim` to `C.photoScrimClear`); no other new gradient.
10. `components/brand/*` never imports from `components/ui`.

Nothing is added between a shopper and Add or Pay: product cards, the product page, cart lines, the bill, docks, steppers, search and error states stay unbranded.

## Logo sizes in use

Width is `round(height x aspect)`.

| Variant | Height | Width | Where |
|---|---|---|---|
| `mark` | 34 | 28 | Tab header, Home skeleton |
| `mark` | 24 | 20 | Wallet header |
| `horizontal` | 24 | 91 | Sign-off |
| `horizontal` | 32 | 121 | Invoice letterhead |
| `horizontal` | 20 | 76 | Payment overlay, order-placed band |
| `stacked` | 96 | 131 | Update gate |

There is no tint or mono variant. The stacked source is `assets/brand/logo-stacked.png`, the same file as the boot frame, so it keeps matching the native splash.

## Shape geometry

- `doorwayRadii(width)`: top-left and both bottoms are 12 (8 under 64 dp wide); top-right is `width / 2`.
- `BrandPhoto shape="fill"` has no geometry of its own: it fills its parent absolutely with no radius, border or ground, and the parent clips. It is for `PhotoScrim` and the banner photo panel.
- `sproutOnFrame(width)`: the sprout is 44 % of the frame width, sits above the top-left corner and lifts 5 % of the width. At 80: 35 x 21, overhang 25. At 112: 49 x 29, overhang 35. `BrandFrame` and `BrandPhoto` add the overhang as top padding, so the sprout is never clipped and layout accounts for it.

## Photo rules

- Every photo is bundled from `assets/photos/` and listed in `assets/photos/CREDITS.md`. Add the credit row before the file; a photo without a row does not ship.
- Licence: CC0 or public domain only. No people, not even hands. No readable third-party text or signage, no brand packaging.
- Sizes: portrait frames 360 x 432 (5:6), tiles 480 x 600 (4:5), wide cards 1080 x 480 (2.25:1), WebP quality 78. Keep all of `assets/photos/` under 1.5 MB (23 photos, about 780 KB today).
- A slot may be declared and unfilled (`doorstep`, `kirana` today). `BrandPhoto`, `PhotoScrim` and `BrandStoryCard` return `null` for an unfilled slot; call sites that need a fallback check `hasPhoto(slot)` and keep their glyph.
- Photos are decorative (hidden from assistive tech) and have no shadow. A photo is under text or pressable only through `PhotoScrim` and the cards built on it. White text over the scrim measures 5.5:1 even on a pure-white pixel; that is why the scrim has its own token and `C.scrim` is not used.
- To fill a slot: add the file, add its row to `CREDITS.md`, add its entry to `PHOTOS` in `photos.ts`.
