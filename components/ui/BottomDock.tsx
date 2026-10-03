import React, { useEffect, useId, useSyncExternalStore } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { C } from "../../constants/colors";
import { layout, shadow } from "../../constants/ui";

// ─── Dock height store ────────────────────────────────────────────────────────
// Module store (MAP §2.6 #28): screens pad their scroll content by `useDockHeight() + 16`, ToastHost composes it.
// Several docks can be mounted at once (a pushed stack keeps the previous screen mounted), so each instance
// registers under its own id and the LAST mounted dock is the active one; popping it falls back to the one
// underneath instead of snapping to 0 (the naive "unmount → 0" would hide the dock offset from the screen below).

/** The dock's top padding (above its children). Screens that mimic a dock by hand use the same number. */
export const DOCK_PADDING_TOP = 14;

let activeDockHeight = 0;
const listeners = new Set<() => void>();
const mountedDocks = new Map<string, number>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sync read of the active dock's measured height in px (0 when no dock is mounted). */
export function getActiveDockHeight(): number {
  return activeDockHeight;
}

/** Publishes a new active dock height; no-op when unchanged. `BottomDock` calls this from onLayout/unmount. */
export function setActiveDockHeight(px: number): void {
  const next = Math.max(0, Math.round(px));
  if (next === activeDockHeight) return;
  activeDockHeight = next;
  listeners.forEach((listener) => listener());
}

function publishLatestDock(): void {
  let latest = 0;
  // Map preserves insertion order; the last entry is the most recently mounted dock.
  mountedDocks.forEach((height) => {
    latest = height;
  });
  setActiveDockHeight(latest);
}

/** Measured height of the mounted dock (0 when none). Re-renders the caller when it changes. */
export function useDockHeight(): number {
  return useSyncExternalStore(subscribe, getActiveDockHeight, getActiveDockHeight);
}

// ─── BottomDock ───────────────────────────────────────────────────────────────

export type BottomDockProps = {
  children: React.ReactNode;
  /** Background. Default C.card. */
  bg?: string;
  /**
   * Default true: `paddingBottom = max(insets.bottom, 12) + 12` (`layout.dockMinInset`), so the children sit 12 px
   * above the home indicator on notched phones and 24 px above the edge on others. `false` = paddingBottom 12
   * (caller composes its own offset, e.g. a dock above the absolute tab bar). Override either with `style`.
   */
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Absolute bottom bar: C.card, ph16 pt14, inset-aware paddingBottom, 1px C.border top, `shadow.dock` (elevation 10).
 * Reports its height through `setActiveDockHeight` on every layout and releases it on unmount, so screens can
 * `paddingBottom: useDockHeight() + 16` instead of guessing `layout.scrollBottomTab`.
 */
export function BottomDock({ children, bg, inset = true, style, testID }: BottomDockProps) {
  const insets = useSafeAreaInsets();
  const id = useId();
  const paddingBottom = inset ? Math.max(insets.bottom, layout.dockMinInset) + layout.dockMinInset : layout.dockMinInset;

  useEffect(
    () => () => {
      mountedDocks.delete(id);
      publishLatestDock();
    },
    [id],
  );

  const handleLayout = (e: LayoutChangeEvent) => {
    mountedDocks.set(id, e.nativeEvent.layout.height);
    publishLatestDock();
  };

  return (
    <View
      onLayout={handleLayout}
      style={[styles.dock, { paddingBottom }, bg !== undefined && { backgroundColor: bg }, style]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.card,
    paddingHorizontal: layout.gutter,
    paddingTop: DOCK_PADDING_TOP,
    borderTopWidth: 1,
    borderTopColor: C.border,
    ...shadow.dock,
  },
});
