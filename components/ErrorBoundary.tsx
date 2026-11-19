import * as Sentry from "@sentry/react-native";
import { reloadAppAsync } from "expo";
import { router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { C } from "../constants/colors";
import { text } from "../constants/ui";
import { useFontsReady } from "../lib/bootGate";
import { clearFatalError, useFatalError } from "../lib/fatalError";
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
//
// A boundary only sees RENDER errors. An uncaught error in a timer, an event handler or a native callback goes to
// the global handler instead, and in a release build React Native answers a fatal one by tearing the host down —
// a blank Activity until the app is cleared from recents. app/_layout.tsx now intercepts those and writes them to
// lib/fatalError; `FatalErrorOverlay` below shows the same "Something went wrong" state over the (still mounted)
// app, with a real restart.
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
    return (
      <>
        {this.props.children}
        <FatalErrorOverlay />
      </>
    );
  }
}

type FallbackScreenProps = {
  /** The error's message; shown selectable, 6 lines max. */
  message: string;
  /** Optional body line above the message. */
  text?: string;
  /** The action buttons (a wrapping row). */
  children: React.ReactNode;
};

/** The one full-screen error layout: Screen + EmptyState (fill, tone="error", alert-circle-outline), message, actions. */
function FallbackScreen({ message, text: body, children }: FallbackScreenProps): React.JSX.Element {
  // A crash before useFonts settles must not render a Jakarta family (MAP §7.13): drop the family while unset.
  const fontsReady = useFontsReady();

  return (
    <Screen>
      <View style={styles.wrap} accessibilityRole="alert" accessibilityLiveRegion="assertive">
        <EmptyState
          fill
          tone="error"
          icon="alert-circle-outline"
          title="Something went wrong"
          text={body}
          titleStyle={fontsReady ? undefined : styles.systemFont}
          textStyle={fontsReady ? undefined : styles.systemFont}
        >
          <Text style={[styles.message, !fontsReady && styles.systemFont]} selectable numberOfLines={6}>
            {message}
          </Text>
          <View style={styles.actions}>{children}</View>
        </EmptyState>
      </View>
    </Screen>
  );
}

type BoundaryFallbackProps = {
  /** The caught error's message. */
  message: string;
  /** Clears the boundary so the children render again. */
  reset: () => void;
};

/** Render-error fallback: "Try again" and "Go to Home". */
function BoundaryFallback({ message, reset }: BoundaryFallbackProps): React.JSX.Element {
  const goHome = () => {
    reset();
    // Navigate on the next frame so the boundary has re-rendered its children before the route changes.
    // dismissTo pops to the live tabs route (or replaces when absent) instead of stacking a second one (W3 R6-04).
    requestAnimationFrame(() => router.dismissTo("/(tabs)/home"));
  };

  return (
    <FallbackScreen message={message}>
      <PrimaryButton label="Try again" size="sm" onPress={reset} />
      <PrimaryButton label="Go to Home" size="sm" variant="outline" onPress={goHome} />
    </FallbackScreen>
  );
}

/** If the app is still running this long after a restart was requested, no reload happened: dismiss instead (ms). */
const RESTART_FALLBACK_MS = 1500;

type LastResortState = { failed: boolean };

/**
 * The outermost boundary, mounted AROUND `ErrorBoundary` in app/_layout.tsx. It catches what that one cannot: a
 * throw inside its own fallback (Screen / EmptyState / PrimaryButton pull in icons, fonts and the motion context)
 * or inside `FatalErrorOverlay`. A render error that NO boundary catches does not go through the global handler:
 * React reports it straight to the native exceptions manager as fatal, the host is torn down, and the Activity
 * stays blank until the task is cleared from recents. So this fallback is built to be unable to throw — core
 * `View` / `Text` / `Pressable` only, static styles, the system font, no context, no app imports beyond the colour
 * constants — and its one action is a real JS reload.
 */
export class LastResortBoundary extends React.Component<BoundaryProps, LastResortState> {
  state: LastResortState = { failed: false };

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): LastResortState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Same three best-effort steps as ErrorBoundary: the splash must not cover the fallback, and no sink may throw.
    SplashScreen.hideAsync().catch(() => {});
    try {
      logError("LastResortBoundary", error);
    } catch {
      // ignore — nothing left to report to
    }
    try {
      Sentry.captureException(error, { extra: { componentStack: info?.componentStack } });
    } catch {
      // ignore — Sentry may not be initialised (no DSN) or may itself be the crashing module
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  restart = (): void => {
    if (this.retryTimer) return;
    // A successful reload destroys this JS context, so `retry` only ever completes when nothing was reloaded
    // (web, or the reload failed): render the children again rather than leave a dead button.
    const retry = () => {
      if (this.retryTimer) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.setState({ failed: false });
      }, RESTART_FALLBACK_MS);
    };
    try {
      reloadAppAsync("Restart after a render error").then(retry, retry);
    } catch {
      retry();
    }
  };

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.lastResort} accessibilityRole="alert">
        <Text style={styles.lastResortTitle}>Something went wrong</Text>
        <Text style={styles.lastResortText}>Restarting the app usually fixes this.</Text>
        <Pressable style={styles.lastResortButton} onPress={this.restart} accessibilityRole="button">
          <Text style={styles.lastResortButtonLabel}>Restart</Text>
        </Pressable>
      </View>
    );
  }
}

/**
 * Uncaught-error fallback, driven by lib/fatalError. An absolute overlay ABOVE the app, not a replacement for it:
 * the tree underneath is intact (the error came from a callback, not from render), so "Keep going" simply drops
 * the overlay and the user is where they were — mid-checkout included. "Restart" is a real JS reload
 * (`reloadAppAsync` from expo: ReactHost.reload in a release build); where no reload exists (web) or it fails,
 * it falls back to dismissing. Android's back button belongs to the overlay while it shows (it dismisses, like
 * "Keep going") — never to the screen hidden underneath. Known limit: an RN Modal (BottomSheet, the payment
 * overlay) is a separate window ABOVE this view, so an error raised while one is open shows once it closes.
 */
function FatalErrorOverlay(): React.JSX.Element | null {
  const fatal = useFatalError();
  const [restarting, setRestarting] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fatal error during boot can leave the splash-hide conditions unmet for good; the overlay must be seen.
  useEffect(() => {
    if (fatal) SplashScreen.hideAsync().catch(() => {});
  }, [fatal]);

  useEffect(
    () => () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    },
    [],
  );

  // Registered when the overlay comes up, so it is the newest back handler and runs first: without it Back would
  // pop the route under the overlay or arm Home's double-back exit.
  useEffect(() => {
    if (!fatal || Platform.OS !== "android") return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!restarting) clearFatalError();
      return true;
    });
    return () => sub.remove();
  }, [fatal, restarting]);

  if (!fatal) return null;

  const restart = () => {
    if (restarting) return;
    setRestarting(true);
    const giveUp = () => {
      fallbackTimerRef.current = setTimeout(() => {
        fallbackTimerRef.current = null;
        setRestarting(false);
        clearFatalError();
      }, RESTART_FALLBACK_MS);
    };
    // A successful reload destroys this JS context, so `giveUp` only ever completes when nothing was reloaded.
    reloadAppAsync("Restart after an uncaught error").then(giveUp, giveUp);
  };

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <FallbackScreen message={fatal.message} text="Restarting the app usually fixes this.">
        <PrimaryButton label="Restart" size="sm" loading={restarting} onPress={restart} />
        <PrimaryButton label="Keep going" size="sm" variant="outline" disabled={restarting} onPress={clearFatalError} />
      </FallbackScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  message: { ...text.emptyText },
  systemFont: { fontFamily: undefined },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 8 },
  // LastResortBoundary: no font family on purpose (the system font cannot fail to load).
  lastResort: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, backgroundColor: C.bg },
  lastResortTitle: { fontSize: 20, fontWeight: "700", color: C.text, textAlign: "center" },
  lastResortText: { fontSize: 15, lineHeight: 22, color: C.textSub, textAlign: "center", marginTop: 8 },
  lastResortButton: { marginTop: 24, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary },
  lastResortButtonLabel: { fontSize: 15, fontWeight: "700", color: C.onPrimary },
});
