import { router } from "expo-router";

import { EmptyState, Screen } from "../components/ui";

/**
 * Catch-all for unknown `nearandnow://` links and stale pushes (C37) — previously fell through to expo-router's
 * unstyled page. CONTRACTS §6.3: `Screen` + `EmptyState` with a single "Go to Home" action (dismissTo: pops to the
 * live tabs route when the app is already open, replaces this route on a cold deep link — W3 R6-04).
 */
export default function NotFoundScreen() {
  return (
    <Screen>
      <EmptyState
        fill
        iconWrap
        icon="map-marker-question-outline"
        title="Page not found"
        text="That link doesn't go anywhere in the app"
        action={{ label: "Go to Home", onPress: () => router.dismissTo("/(tabs)/home") }}
      />
    </Screen>
  );
}
