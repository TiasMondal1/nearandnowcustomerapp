import { usePathname } from "expo-router";
import { useEffect } from "react";

import { setHomeFocused } from "../lib/firstRunPrompts";
import { noteNavigation } from "../lib/pendingNativePrompts";

/** `usePathname()` strips route groups, so the Home tab reads `/home`; the grouped spelling is accepted too (as CartBar does). */
const HOME_PATHNAMES: readonly string[] = ["/home", "/(tabs)/home"];

/**
 * Leaf that tells the native-prompt gate what navigation is doing: every route change is stamped (a permission
 * dialog never starts inside a transition — lib/pendingNativePrompts) and "Home is the focused route" is published
 * for the first-run prompts that wait for it (lib/firstRunPrompts). A route pushed over the tabs changes the
 * pathname, so Home counts as focused only while it is really on top. Mounted next to PushBootstrap /
 * NavReadyProbe so AppShell itself never re-renders on navigation (P29).
 */
export function NavActivityProbe(): null {
  const pathname = usePathname();

  useEffect(() => {
    noteNavigation();
    setHomeFocused(HOME_PATHNAMES.includes(pathname));
  }, [pathname]);

  // Unmount: nothing is focused any more.
  useEffect(() => () => setHomeFocused(false), []);

  return null;
}
