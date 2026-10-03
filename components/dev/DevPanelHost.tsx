// codename: indigo
// Host rendered by `DevModeProvider` after its children (CONTRACTS §5, §3.4). It owns the four indigo surfaces: the
// amber simulation stripe, the floating DEV pill, the PIN sheet and the panel. The pill is the only thing a locked
// `__DEV__` build shows; a store build shows nothing at all until the D2 gate has been passed.
import React, { useSyncExternalStore } from "react";

import { useDevMode } from "../../context/DevModeContext";
import { getChangedFlags, subscribeDevFlags, useDevFlag } from "../../lib/devFlags";
import { DevPanel } from "./DevPanel";
import { DevPill } from "./DevPill";
import { DevSimulationStripe } from "./DevSimulationStripe";
import { DevUnlockSheet } from "./DevUnlockSheet";

function getChangedCount(): number {
  return getChangedFlags().length;
}

/**
 * Pill visibility: `(unlocked || __DEV__) && !Dev_Indigo_inhibit_FloatingPill && !Dev_Indigo_inhibit_Feature &&
 * !panelOpen && !pinOpen` (and the pill hides itself while a payment is in flight). Pill tap → `requestUnlock('pill')`:
 * the provider opens the panel when unlocked, otherwise the PIN sheet directly (the pill is already a deliberate target,
 * so the version-toast step is skipped). The panel opens only from the PIN sheet's `onDismiss` (MAP §7.5).
 */
export function DevPanelHost(): React.JSX.Element | null {
  const dev = useDevMode();
  const featureInhibited = useDevFlag("Dev_Indigo_inhibit_Feature");
  const pillInhibited = useDevFlag("Dev_Indigo_inhibit_FloatingPill");
  const changedCount = useSyncExternalStore(subscribeDevFlags, getChangedCount, getChangedCount);

  const showPill = (dev.unlocked || __DEV__) && !pillInhibited && !featureInhibited && !dev.panelOpen && !dev.pinOpen;

  return (
    <>
      <DevSimulationStripe />
      {showPill ? <DevPill onPress={() => dev.requestUnlock("pill")} changedCount={changedCount} locked={!dev.unlocked} /> : null}
      <DevUnlockSheet visible={dev.pinOpen} onClose={dev.closePin} onUnlocked={dev.onPinUnlocked} onDismiss={dev.onPinDismissed} />
      <DevPanel visible={dev.panelOpen} onClose={dev.closePanel} />
    </>
  );
}
