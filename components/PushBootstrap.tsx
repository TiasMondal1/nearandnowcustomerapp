import { usePushNotifications } from "../hooks/usePushNotifications";

/**
 * Leaf that owns `usePushNotifications(userId)` (CONTRACTS §6.5): registration, listeners and the cold-start
 * deep link. Keeping the hook out of AppShell means the shell no longer re-renders on every navigation-state
 * change (P29) — the hook's nav-ready wait lives in lib/bootGate, not in `useRootNavigationState`.
 */
export function PushBootstrap({ userId }: { userId: string | null }): null {
  usePushNotifications(userId);
  return null;
}
