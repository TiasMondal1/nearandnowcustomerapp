import * as Sentry from "@sentry/react-native";
import { router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { text } from "../constants/ui";
import { useFontsReady } from "../lib/bootGate";
import { logError } from "../lib/logError";
// Barrel-import exception (CONTRACTS §4.17 rev. 2, allowlisted by W3): these three primitives are imported from their
// FILES, not from "./ui". The barrel pulls CartBar → CartContext → feedback → devFlags, and an import-time crash inside
// one of those must not take the error boundary down with it.
import { EmptyState } from "./ui/EmptyState";
import { PrimaryButton } from "./ui/PrimaryButton";
import { Screen } from "./ui/Screen";

// An unhandled render exception anywhere in the tree previously crashed the
// whole app with no fallback UI — the customer was left staring at a blank/
// native crash screen with no way back in except force-quitting and
// relaunching. This catches it and offers a retry (and a way home) instead.
// Mirrors the rider app's identical fix (components/ErrorBoundary.tsx there).
type BoundaryState = { hasError: boolean; message: string };

type BoundaryProps = { children: React.ReactNode };

export class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message: message || "Unknown error" };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // A boot-time crash unmounts AppShell, whose effect is the only other splash hide — without this the native
    // splash stays up forever and the recovery UI below is never seen (W3 R6-03). Sanctioned bare catch (MAP §2.7).
    SplashScreen.hideAsync().catch(() => {});
    // Both sinks are best-effort: a logger that throws inside a crash handler would mask the original error.
    try {
      logError("ErrorBoundary", error);
    } catch {
      // ignore — nothing left to report to
    }
    try {
      Sentry.captureException(error, { extra: { componentStack: info?.componentStack } });
    } catch {
      // ignore — Sentry may not be initialised (no DSN) or may itself be the crashing module
    }
  }

  reset = (): void => {
    this.setState({ hasError: false, message: "" });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <BoundaryFallback message={this.state.message} reset={this.reset} />;
    }
    return this.props.children;
  }
}

type BoundaryFallbackProps = {
  /** The caught error's message; shown selectable, 6 lines max. */
  message: string;
  /** Clears the boundary so the children render again. */
  reset: () => void;
};

/** Full-screen fallback: Screen + EmptyState (fill, iconWrap, alert-circle-outline) with "Try again" and "Go to Home". */
function BoundaryFallback({ message, reset }: BoundaryFallbackProps): React.JSX.Element {
  // A crash before useFonts settles must not render a Jakarta family (MAP §7.13): drop the family while unset.
  const fontsReady = useFontsReady();
  const goHome = () => {
    reset();
    // Navigate on the next frame so the boundary has re-rendered its children before the route changes.
    // dismissTo pops to the live tabs route (or replaces when absent) instead of stacking a second one (W3 R6-04).
    requestAnimationFrame(() => router.dismissTo("/(tabs)/home"));
  };

  return (
    <Screen>
      <View style={styles.wrap} accessibilityRole="alert" accessibilityLiveRegion="assertive">
        <EmptyState
          fill
          iconWrap
          icon="alert-circle-outline"
          title="Something went wrong"
          titleStyle={fontsReady ? undefined : styles.systemFont}
          textStyle={fontsReady ? undefined : styles.systemFont}
        >
          <Text style={[styles.message, !fontsReady && styles.systemFont]} selectable numberOfLines={6}>
            {message}
          </Text>
          <View style={styles.actions}>
            <PrimaryButton label="Try again" size="sm" onPress={reset} />
            <PrimaryButton label="Go to Home" size="sm" variant="outline" onPress={goHome} />
          </View>
        </EmptyState>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  message: { ...text.emptyText },
  systemFont: { fontFamily: undefined },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 8 },
});
