// Brand data: the name, the tagline and the logo files. No component imports, so anything
// (including the crash path) can read it for free.

export const BRAND_NAME = "Near & Now";
/** The logo's spelling. Live text only, under the welcome logo and in the sign-off. */
export const BRAND_TAGLINE = "Digital Dukan, Local Dil Se";

/** width / height of each logo file, measured from the files. */
export const LOGO = {
  mark: { source: require("../../assets/brand/mark-color-512.png"), aspect: 418 / 512 }, // 0.816
  horizontal: { source: require("../../assets/brand/logo-horizontal-512.png"), aspect: 512 / 135 }, // 3.793
  stacked: { source: require("../../assets/brand/logo-stacked.png"), aspect: 1024 / 749 }, // 1.367
} as const;
export type LogoVariant = keyof typeof LOGO;

/** The logo's green leaves on their own (204 x 120). */
export const SPROUT = { source: require("../../assets/brand/sprout.png"), aspect: 204 / 120 } as const; // 1.7
