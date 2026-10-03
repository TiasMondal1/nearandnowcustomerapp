// codename: mira
// LivePill — the "Live" chip in the tracking header. Rev. 2 of the design: NO idle loop. The dot pulses ONCE each
// time `lastUpdatedAt` changes (a poll returned) and sits still between polls; "Paused" while offline / backgrounded /
// terminal. It also owns the screen's 60 s minute clock: the hero subscribes to it through `useTrackingNow()`, so a
// tick re-renders the hero only — never the MapView subtree (design/delight-motion-sound M13, MAP §4.2 P7).
import React, { useEffect, useSyncExternalStore } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "../../constants/colors";
import { fontFamily, radius } from "../../constants/ui";
import { Pulse } from "../ui";

// ─── Minute clock (module store; subscribed in leaf components only) ────────────

/** Tick cadence: the hero shows whole minutes, so once a minute is enough (no animation loop). */
const TICK_MS = 60_000;

let nowMs = Date.now();
const clockSubscribers = new Set<() => void>();

function subscribeClock(cb: () => void): () => void {
  clockSubscribers.add(cb);
  return () => {
    clockSubscribers.delete(cb);
  };
}

function readNow(): number {
  return nowMs;
}

function tick(): void {
  nowMs = Date.now();
  for (const cb of Array.from(clockSubscribers)) cb();
}

/**
 * `Date.now()` as of the last minute tick of a mounted `LivePill` (refreshed on its mount, then every 60 s).
 * Subscribe in the component that shows the countdown so only it re-renders per minute.
 */
export function useTrackingNow(): number {
  return useSyncExternalStore(subscribeClock, readNow, readNow);
}

// ─── Pill ───────────────────────────────────────────────────────────────────────

export type LivePillProps = {
  /** `useOrderTracking().lastUpdatedAt` — each change runs one pulse around the dot. */
  lastUpdatedAt: number | null;
  /** False while paused (offline / background) or on a terminal order: copy "Paused", grey dot, no pulse. */
  live: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Dot diameter (and the Pulse ring's scale-1 size). */
const DOT = 8;

/** "7:42 pm" for an epoch-ms or ISO timestamp; "" when unparseable. Shared by the pill and the hero. */
export function formatClock(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

/**
 * "Live" 11/700 `C.success` + 8 px `C.success` dot on a `C.successLight` pill; `Pulse once` is keyed on
 * `lastUpdatedAt`, so it mounts (and runs its single cycle) exactly once per received update and is otherwise absent —
 * there is no looping ring here. `!live` → "Paused" 11/700 `C.textSub` on `C.bgSoft`, dot `C.textLight`.
 * a11y: one text element labelled "Live, updated HH:MM" / "Paused". Fires no feedback.
 */
export function LivePill({ lastUpdatedAt, live, style, testID }: LivePillProps): React.JSX.Element {
  // The minute clock lives for as long as a pill is mounted (one per tracking screen).
  useEffect(() => {
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const label = live ? "Live" : "Paused";
  const a11yLabel = live
    ? lastUpdatedAt
      ? `Live, updated ${formatClock(lastUpdatedAt)}`
      : "Live"
    : "Paused";

  return (
    <View
      style={[styles.pill, live ? styles.pillLive : styles.pillPaused, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      testID={testID}
    >
      <View style={styles.dotWrap}>
        {live && lastUpdatedAt !== null ? (
          // A fresh key per update → one mount → one cycle (Pulse `once`), then it rests hidden.
          <Pulse key={lastUpdatedAt} size={DOT} color={C.success} once style={styles.ring} />
        ) : null}
        <View style={[styles.dot, live ? styles.dotLive : styles.dotPaused]} />
      </View>
      <Text style={[styles.label, live ? styles.labelLive : styles.labelPaused]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  pillLive: { backgroundColor: C.successLight },
  pillPaused: { backgroundColor: C.bgSoft },
  dotWrap: { width: DOT, height: DOT, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute" },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dotLive: { backgroundColor: C.success },
  dotPaused: { backgroundColor: C.textLight },
  label: { fontFamily: fontFamily.bold, fontSize: 11, letterSpacing: 0.3 },
  labelLive: { color: C.success },
  labelPaused: { color: C.textSub },
});
