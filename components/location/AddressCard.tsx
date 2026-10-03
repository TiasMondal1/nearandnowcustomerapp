// Swipeable address row for the address book (/location). Moved out of app/location/AddressCard.tsx — a
// component that had become the route `/location/AddressCard` by accident (MAP C13) — and rebuilt on
// ReanimatedSwipeable (RNGH 2.28): swipe left reveals Edit (C.successLight / C.success) and Delete
// (C.dangerLight / C.danger); the body is AddressRow. One card open at a time (module ref), one `select`
// haptic when the swipe crosses the open threshold, and both actions exposed to screen readers through
// `accessibilityActions` (W15-location-foundations, 2026-10-03).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { PressableScale, type IconName } from "../ui";
import { C } from "../../constants/colors";
import { fontFamily, motion } from "../../constants/ui";
import type { SavedAddress } from "../../lib/addressService";
import { feedback } from "../../lib/feedback";
import { AddressRow } from "./AddressRow";

export type AddressCardProps = {
  address: SavedAddress;
  onEdit: () => void;
  onDelete: () => void;
  /** Tap on the body (e.g. open the editor). Without it the body is a plain row. */
  onPress?: () => void;
  /** Optional extra: hairline under the row (`divider={!isLast}`), forwarded to AddressRow. */
  divider?: boolean;
  testID?: string;
};

/** One action panel = 72 px per action; the open threshold is half the panel (RNGH default), i.e. progress 0.5. */
const ACTION_WIDTH = 72;
const ACTIONS_WIDTH = ACTION_WIDTH * 2;
const OPEN_THRESHOLD = ACTIONS_WIDTH / 2;
/** Fraction of the panel at which the finger has "committed" — RNGH's progress is translation / panel width. */
const THRESHOLD_PROGRESS = OPEN_THRESHOLD / ACTIONS_WIDTH;
const ACTION_ICON = 22;

const A11Y_ACTIONS: readonly AccessibilityActionInfo[] = [
  { name: "edit", label: "Edit" },
  { name: "delete", label: "Delete" },
];

/** The card whose actions are showing; opening another one closes it first (one open swipe per list). */
type OpenHandle = { close: () => void };
let openCard: OpenHandle | null = null;

function fireSelect(): void {
  feedback.select();
}

type SwipeActionProps = {
  icon: IconName;
  label: string;
  bg: string;
  pressedBg: string;
  color: string;
  accessibilityLabel: string;
  onPress: () => void;
};

function SwipeAction({ icon, label, bg, pressedBg, color, accessibilityLabel, onPress }: SwipeActionProps): React.JSX.Element {
  return (
    <PressableScale
      scale={motion.scale.tile}
      style={styles.actionOuter}
      innerStyle={[styles.action, { backgroundColor: bg }]}
      pressedStyle={{ backgroundColor: pressedBg }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <MaterialCommunityIcons name={icon} size={ACTION_ICON} color={color} />
      <Text style={[styles.actionLabel, { color }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </PressableScale>
  );
}

type RightActionsProps = {
  progress: SharedValue<number>;
  label: string;
  onEdit: () => void;
  onDelete: () => void;
};

/** The two actions plus the threshold reaction (lives here because the progress value only exists inside the render callback). */
function RightActions({ progress, label, onEdit, onDelete }: RightActionsProps): React.JSX.Element {
  // Exactly one `select` per swipe: fires when the finger crosses the open threshold, re-arms when the
  // panel closes (progress back under it). Programmatic closes never fire (they only move downwards).
  useAnimatedReaction(
    () => progress.get() >= THRESHOLD_PROGRESS,
    (past, previous) => {
      if (past && previous === false) scheduleOnRN(fireSelect);
    },
  );

  return (
    <View style={styles.actions}>
      <SwipeAction
        icon="pencil-outline"
        label="Edit"
        bg={C.successLight}
        pressedBg={C.successBorder}
        color={C.success}
        accessibilityLabel={`Edit ${label} address`}
        onPress={onEdit}
      />
      <SwipeAction
        icon="trash-can-outline"
        label="Delete"
        bg={C.dangerLight}
        pressedBg={C.dangerBorder}
        color={C.danger}
        accessibilityLabel={`Delete ${label} address`}
        onPress={onDelete}
      />
    </View>
  );
}

/**
 * ReanimatedSwipeable with right actions Edit · Delete, body = AddressRow. Opening a card closes the one
 * that was open; an action press closes the card first and then runs the handler (so the row is reset
 * before a confirm dialog or a navigation). Screen readers get the same two actions on the row itself.
 */
export function AddressCard({ address, onEdit, onDelete, onPress, divider, testID }: AddressCardProps): React.JSX.Element {
  const swipeRef = useRef<SwipeableMethods | null>(null);
  // A stable per-instance handle so the module ref never points at a stale methods object.
  const [handle] = useState<OpenHandle>(() => ({ close: () => swipeRef.current?.close() }));

  useEffect(
    () => () => {
      if (openCard === handle) openCard = null;
    },
    [handle],
  );

  const label = address.label?.trim() || "Address";

  const closeThen = (fn: () => void) => () => {
    handle.close();
    if (openCard === handle) openCard = null;
    fn();
  };
  const handleEdit = closeThen(onEdit);
  const handleDelete = closeThen(onDelete);

  const handleWillOpen = () => {
    if (openCard && openCard !== handle) openCard.close();
    openCard = handle;
  };
  const handleClose = () => {
    if (openCard === handle) openCard = null;
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === "edit") onEdit();
    else if (name === "delete") onDelete();
  };

  const renderRightActions = (progress: SharedValue<number>) => (
    <RightActions progress={progress} label={label} onEdit={handleEdit} onDelete={handleDelete} />
  );

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      rightThreshold={OPEN_THRESHOLD}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={handleWillOpen}
      onSwipeableClose={handleClose}
      containerStyle={styles.container}
      testID={testID}
    >
      <AddressRow
        address={address}
        onPress={onPress}
        style={styles.body}
        divider={divider}
        accessibilityActions={A11Y_ACTIONS}
        onAccessibilityAction={handleAccessibilityAction}
      />
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: C.card },
  // Opaque body so the action panel never shows through while the row slides.
  body: { backgroundColor: C.card },
  actions: { flexDirection: "row", width: ACTIONS_WIDTH },
  actionOuter: { width: ACTION_WIDTH },
  action: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 12 },
  actionLabel: { fontFamily: fontFamily.semibold, fontSize: 12 },
});
