// codename: indigo
/**
 * The dev-mode context object, its value type and `useDevMode()` — split out of DevModeContext.tsx so the panel
 * components (DevPanelHost, DevPanel, DevActions) can read it without importing the file that renders them. Importing
 * DevModeContext.tsx from those components made a require cycle (DevModeContext → DevPanelHost → … → DevModeContext).
 * DevModeContext.tsx owns the provider and re-exports everything here, so other callers keep importing from it.
 */
import { createContext, useContext } from 'react';

export type DevUnlockSource = 'shake' | 'long-press' | 'pill';

export type DevModeValue = {
  unlocked: boolean;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** Starts the D2 gate: version toast (id 'dev-version') → 5 taps within 3 s → PIN sheet. When already unlocked, opens the panel directly. */
  requestUnlock: (source: DevUnlockSource) => void;
  lock: () => Promise<void>;
  // ── Optional extras (consumed by DevPanelHost / DevPanel only) ──
  /** The PIN sheet is showing. */
  pinOpen: boolean;
  /** User intent to close the PIN sheet (scrim, pan, back, close button). */
  closePin: () => void;
  /** The PIN matched: closes the sheet and arms "open the panel once the sheet has dismissed". */
  onPinUnlocked: () => void;
  /** The PIN sheet's native Modal is gone: opens the panel if armed (never in the same tick as the close — MAP §7.5). */
  onPinDismissed: () => void;
  /** ms epoch of the unlock in this process; null while locked or when the unlock was hydrated from disk ("before launch"). */
  unlockedAt: number | null;
};

export const DevModeContext = createContext<DevModeValue | null>(null);

/** Throws outside the provider (CONTRACTS §3.4). */
export function useDevMode(): DevModeValue {
  const ctx = useContext(DevModeContext);
  if (!ctx) throw new Error('useDevMode must be used inside <DevModeProvider>');
  return ctx;
}
