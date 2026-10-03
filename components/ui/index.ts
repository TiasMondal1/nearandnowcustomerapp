// Shared UI primitives. Import from "../components/ui" (relative), never from a file inside, e.g.
//   import { Screen, ScreenHeader, Section, ListRow, PrimaryButton } from "../../components/ui";
// Non-color tokens live in "../constants/ui" (space, layout, radius, text, shadow, …).
// Barrel owner: W0-scaffold wrote it; only W15-integrate may edit it afterwards (DECISIONS D9, PLAN §5.2).
export type { IconName } from "./types";

export { Screen, type ScreenProps } from "./Screen";
export { IconButton, BackButton, type IconButtonProps, type BackButtonProps } from "./IconButton";
export { ScreenHeader, type ScreenHeaderProps } from "./ScreenHeader";
export { SectionLabel, type SectionLabelProps } from "./SectionLabel";
export { Card, type CardProps } from "./Card";
export { Section, type SectionProps } from "./Section";
export { ListRow, type ListRowProps } from "./ListRow";
export {
  PrimaryButton,
  type PrimaryButtonProps,
  type PrimaryButtonSize,
  type PrimaryButtonVariant,
} from "./PrimaryButton";
export { Badge, BADGE_TONES, type BadgeProps, type BadgeTone } from "./Badge";
export { EmptyState, type EmptyStateProps, type EmptyStateAction } from "./EmptyState";
export {
  Skeleton,
  SkeletonText,
  SkeletonCircle,
  SkeletonScreen,
  type SkeletonProps,
  type SkeletonTextProps,
  type SkeletonCircleProps,
  type SkeletonScreenProps,
} from "./Skeleton";
export { Divider, type DividerProps } from "./Divider";
export { IconWrap, defaultIconWrapRadius, defaultIconWrapIconSize, type IconWrapProps } from "./IconWrap";
export {
  BottomDock,
  useDockHeight,
  getActiveDockHeight,
  setActiveDockHeight,
  DOCK_PADDING_TOP,
  type BottomDockProps,
} from "./BottomDock";
export { DoodleBackdrop, TAB_HEADER_DOODLES, type DoodleSpec } from "./DoodleBackdrop";

// ── Motion (onyx) ──
export {
  ease,
  dur,
  spr,
  enter,
  exit,
  layoutSpring,
  layoutTiming,
  useMotionReduced,
  useLayoutTransitionsEnabled,
  MotionConfig,
} from "./motion/presets";
export { PressableScale, usePressScale, type PressableScaleProps } from "./motion/PressableScale";
export { Pulse, type PulseProps } from "./motion/Pulse";
export { Shake, type ShakeProps } from "./motion/Shake";
export { Collapsible, ChevronRotate, type CollapsibleProps, type ChevronRotateProps } from "./motion/Collapsible";
export { AnimatedNumber, type AnimatedNumberProps } from "./motion/AnimatedNumber";
export { Confetti, type ConfettiProps } from "./motion/Confetti";

// ── Overlays ──
export {
  ToastHost,
  ToastLayer,
  registerToastLayer,
  notify,
  dismissToast,
  updateToast,
  useToast,
  TOAST_DURATION,
  type ToastOptions,
  type ToastTone,
  type ToastAction,
} from "./Toast";
export { BottomSheet, useBottomSheetState, type BottomSheetProps } from "./BottomSheet";
export { OfflineBanner, OFFLINE_BANNER_HEIGHT, type OfflineBannerProps } from "./OfflineBanner";

// ── Commerce ──
export {
  Stepper,
  STEPPER_SIZE,
  QTY_HIT_SLOP,
  type StepperProps,
  type StepperSize,
  type StepperVariant,
  type StepperProduct,
} from "./Stepper";
export { Price, discountPercent, type PriceProps } from "./Price";
export { ProductCard, SkeletonProductCard, PRODUCT_CARD, type ProductCardProps, type ProductCardVariant } from "./ProductCard";
export {
  CartBar,
  CART_BAR_HEIGHT,
  CART_BAR_GAP,
  CART_BAR_FOOTPRINT,
  CART_BAR_ROUTES,
  TAB_PATHNAMES,
  isTabPathname,
  getCartBarLayout,
  subscribeCartBarLayout,
  useCartBarLayout,
  setCartBarExtraBottom,
  useCartBarFootprint,
  type CartBarProps,
  type CartBarLayout,
} from "./CartBar";
export { TabHeader, TAB_HEADER_MIN_HEIGHT, type TabHeaderProps } from "./TabHeader";
export { SearchBand, SEARCH_BAND_HEIGHT, type SearchBandProps } from "./SearchBand";
export { EtaLine, type EtaLineProps } from "./EtaLine";

// ── Controls ──
export { Chip, type ChipProps } from "./Chip";
export { SegmentedControl, type SegmentedControlProps, type Segment } from "./SegmentedControl";
export { ProgressBar, type ProgressBarProps } from "./ProgressBar";
export { Toggle, type ToggleProps } from "./Toggle";
export { Input, type InputProps } from "./Input";
