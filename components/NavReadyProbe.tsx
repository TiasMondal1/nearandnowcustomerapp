import { useRootNavigationState } from "expo-router";
import { useEffect } from "react";

import { markNavReady } from "../lib/bootGate";

/**
 * Leaf that flips the boot gate's nav-ready flag from the root navigation state (W3 R6-09). On a URL cold start
 * (share link, `nearandnow://order/track/<id>`, a bad link → +not-found) expo-router builds the initial state from
 * the URL and `app/index.tsx` never mounts, so its `markNavReady()` never ran: the splash waited out the full 2 s
 * cap and the cold-start push handler (which subscribes to nav-ready) never fired that session. Mounted next to
 * PushBootstrap so AppShell itself never re-renders on navigation state (P29). `markNavReady()` is idempotent, so
 * the normal path (index → replace → its own rAF call) is unaffected.
 */
export function NavReadyProbe(): null {
  const state = useRootNavigationState();
  const focused = state?.key ? state.routes[state.index ?? 0]?.name : undefined;

  useEffect(() => {
    if (!focused || focused === "index") return;
    markNavReady();
  }, [focused]);

  return null;
}
