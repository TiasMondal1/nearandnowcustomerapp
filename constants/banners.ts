// codename: deneb
// Home promo banners — local config (DECISIONS D3/D6: no banner table work; D11 Q9: text
// cards until the owner supplies art). Rendered by components/home/BannerCarousel.tsx as a
// `banners` item under the sticky search (design/blinkit-parity §2.2).
import type { Href } from 'expo-router';

// TYPE-ONLY import: a value import from constants/ into the barrel would evaluate every
// primitive at constants load (see constants/categoryTints.ts).
import type { PhotoSlot } from '../components/brand/photos';
import type { IconName } from '../components/ui/types';

type BannerBase = {
  id: string;
  /** Typed route the card opens, e.g. '/(tabs)/categories', '/product/coupons', '/wallet'. Absolute only. */
  href: Href;
  /** Ascending display order. */
  sort: number;
  /** ISO timestamp; the banner is hidden before it. Omit for "always". */
  activeFrom?: string;
  /** ISO timestamp; the banner is hidden from it onwards. Omit for "always". */
  activeTo?: string;
};

/** Owner-supplied art, `width = screen − 32`, aspect 2.25, rendered with cdnImage(url, 800). None exists in the repo today, so no ImageBanner ships in rev. 2. */
export type ImageBanner = BannerBase & {
  kind: 'image';
  /** require() number or https URL. */
  image: number | string;
  /** accessibilityLabel of the card. */
  alt: string;
};

/** Typographic card — tint background, a bundled photo panel on the right (or a 28 px icon when there is none), title text.h3, subtitle 12/500, cta pill 12/700 C.primaryDark. */
export type CardBanner = BannerBase & {
  kind: 'card';
  title: string;
  subtitle?: string;
  cta?: string;
  /** Background token name resolved by the carousel (C.primaryXLight | C.dealLight | C.warningLight). */
  tint: 'primaryXLight' | 'dealLight' | 'warningLight';
  icon: IconName;
  /** Bundled photo filling the panel at the card's right edge, in place of the icon circle. The icon stays the fallback when the slot is unfilled. */
  photo?: PhotoSlot;
};

export type Banner = ImageBanner | CardBanner;

/** Carousel caps at this many after the active-window filter. */
const MAX_ACTIVE_BANNERS = 6;

/** Four CardBanners, each with a bundled photo: first-order coupon, categories, order again, wallet. Add ImageBanners here when the owner supplies art. */
export const BANNERS: readonly Banner[] = [
  {
    kind: 'card',
    id: 'first-order',
    title: 'Free delivery on your first order',
    subtitle: 'Use your welcome coupon',
    cta: 'See coupons',
    tint: 'dealLight',
    icon: 'ticket-percent-outline',
    photo: 'bannerWelcome',
    href: '/product/coupons',
    sort: 1,
  },
  {
    kind: 'card',
    id: 'categories',
    title: 'Fresh from shops near you',
    subtitle: 'From stores within 4 km',
    cta: 'Browse categories',
    tint: 'primaryXLight',
    icon: 'view-grid-outline',
    photo: 'bannerFresh',
    href: '/(tabs)/categories',
    sort: 2,
  },
  {
    kind: 'card',
    id: 'reorder',
    title: 'Order your usuals again',
    subtitle: 'Your past items in one place',
    cta: 'Order again',
    tint: 'warningLight',
    icon: 'history',
    photo: 'bannerReorder',
    href: '/(tabs)/order-again',
    sort: 3,
  },
  {
    kind: 'card',
    id: 'wallet',
    title: 'Add money, pay in one tap',
    subtitle: 'Near & Now wallet checkout is instant',
    cta: 'Open wallet',
    tint: 'primaryXLight',
    icon: 'wallet-outline',
    photo: 'bannerWallet',
    href: '/wallet',
    sort: 4,
  },
];

/** ms epoch for an ISO bound, or null when absent / unparseable (an unparseable bound never hides a banner). */
function parseBound(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function isActiveAt(b: Banner, now: number): boolean {
  const from = parseBound(b.activeFrom);
  if (from != null && now < from) return false;
  const to = parseBound(b.activeTo);
  if (to != null && now >= to) return false;
  return true;
}

/**
 * The banners to show at `now` (default `Date.now()`): inside their `activeFrom`/`activeTo`
 * window, sorted by `sort` ascending (ties by id), capped at 6. Returns a new array each call;
 * empty when nothing is active (the carousel then renders nothing). `source` defaults to
 * BANNERS; lib/bannerService.ts can pass `[...BANNERS, ...remote]` to apply the same rules.
 */
export function getActiveBanners(now: number = Date.now(), source: readonly Banner[] = BANNERS): Banner[] {
  return source
    .filter((b) => isActiveAt(b, now))
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .slice(0, MAX_ACTIVE_BANNERS);
}

/** accessibilityLabel for the card: `alt` for images, `"${title}. ${subtitle}"` (title alone when there is no subtitle) for cards. */
export function bannerLabel(b: Banner): string {
  if (b.kind === 'image') return b.alt;
  return b.subtitle ? `${b.title}. ${b.subtitle}` : b.title;
}

/** width / height of the banner card (≈146 px tall at a 328 px width). */
export const BANNER_ASPECT_RATIO = 2.25;
