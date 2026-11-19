// Brand primitives. Screens import from this barrel; files inside components/ui import by file
// (`../brand/BrandLogo`) so the crash path (ErrorBoundary → EmptyState) stays light.
export { BRAND_NAME, BRAND_TAGLINE, LOGO, SPROUT, type LogoVariant } from "./brand";
export { PHOTOS, hasPhoto, type PhotoEntry, type PhotoSlot } from "./photos";
export { doorwayRadii, sproutOnFrame } from "./shape";
export { BrandLogo, type BrandLogoProps } from "./BrandLogo";
export { Sprout, type SproutProps } from "./Sprout";
export { BrandFrame, type BrandFrameProps } from "./BrandFrame";
export { BrandPhoto, type BrandPhotoProps } from "./BrandPhoto";
export { PhotoScrim, type PhotoScrimProps } from "./PhotoScrim";
export { BrandSignOff, type BrandSignOffProps } from "./BrandSignOff";
export { BrandStoryCard, type BrandStoryCardProps } from "./BrandStoryCard";
