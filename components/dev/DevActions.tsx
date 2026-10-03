// codename: indigo
// Momentary dev-panel actions (CONTRACTS §5, design §4.4 "Actions tab", speed-and-ease §2): Feedback previews, visual
// previews, diagnostics, data resets, flag import/export and the lock. Every button is a `PrimaryButton size="xs"
// variant="secondary"` (ink on sand — never brand green), destructive ones confirm first through `confirmAction()` (the
// sanctioned use of Alert; the browser `confirm()` on web, where RN-web's Alert is a no-op), and results arrive as toasts.
// `buildDiagnostics()` is the JSON the "Copy diagnostics" action copies and the Sentry test event attaches as a breadcrumb
// (phone masked, userId and per-user storage keys cut to `<uid>`, token never included).
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Dimensions, PixelRatio, Platform, StyleSheet, Text, View } from "react-native";

import { C } from "../../constants/colors";
import { radius } from "../../constants/ui";
import { getCartSnapshot } from "../../context/CartContext";
import { useDevMode } from "../../context/DevModeContext";
import { getActiveLocationSync } from "../../context/LocationContext";
import { simulateSessionExpiry } from "../../lib/apiClient";
import { getAppVersion, getBuildProfile } from "../../lib/appExtra";
import { exportDevFlags, getChangedFlags, importDevFlags, resetDevFlags, setDevFlag } from "../../lib/devFlags";
import { feedback, getFeedbackPrefs, previewHaptic, previewSound, type HapticKind, type UiSound } from "../../lib/feedback";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { simulateReconnect } from "../../lib/network";
import { getMemoryOrders } from "../../lib/orderService";
import { checkPushPermissionStatus, getLastPushRegistrationError } from "../../lib/pushNotificationStatus";
import { invalidate } from "../../lib/queryCache";
import { resetStoreServiceCaches } from "../../lib/storeService";
import { Chip, Confetti, Input, PrimaryButton, notify, type ToastTone } from "../ui";
import { DevSectionTitle, copyText, devText } from "./DevKeyValue";

// ─── Catalogues ───────────────────────────────────────────────────────────────

/** The eight UI sounds with their lengths (design §2.4) — the chip labels say which file plays. */
const SOUNDS: readonly { name: UiSound; ms: number }[] = [
  { name: "tap", ms: 35 },
  { name: "toggle", ms: 75 },
  { name: "add", ms: 110 },
  { name: "remove", ms: 100 },
  { name: "swoosh", ms: 140 },
  { name: "error", ms: 240 },
  { name: "coin", ms: 330 },
  { name: "success", ms: 420 },
];
const HAPTICS: readonly HapticKind[] = ["tap", "select", "toggle", "add", "remove", "success", "error", "heavy", "coin"];
const TONES: readonly ToastTone[] = ["neutral", "success", "error", "warning", "info", "deal"];

/** Gap between sounds in "Play all" (design §4.4). */
const PLAY_ALL_GAP_MS = 600;
/** Gap between toasts in "Toast tones". */
const TONE_GAP_MS = 700;
/** How long "Skeleton 3 s" holds `Dev_Onyx_inhibit_SkeletonExit`. */
const SKELETON_HOLD_MS = 3000;
/**
 * The pending "Skeleton 3 s" release. Module-level on purpose: the action closes the panel so the developer can look at
 * the skeletons, which unmounts `DevActions` — a timer in `timersRef` would be cleared and the flag would stay on.
 */
let skeletonHold: ReturnType<typeof setTimeout> | null = null;
/** Delay before the synthetic push fires. */
const PUSH_DELAY_S = 2;
/** Preview box height for the confetti burst (px). */
const PREVIEW_BOX_HEIGHT = 120;
/** Storage keys that survive "Clear nn:* caches" (device-scoped — CONTRACTS §9). */
const PROTECTED_PREFIXES = ["nn:dev:", "nn:prefs:"] as const;
const CACHE_PREFIXES = ["nn_", "nn:"] as const;

// ─── Helpers shared with DevPanel (optional extras) ───────────────────────────

/** `+919876541234` → `+91••••••1234`: keeps a leading `+CC`, masks the middle, shows the last 4 digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const head = phone.startsWith("+") ? phone.slice(0, 3) : "";
  const tail = phone.slice(-4);
  const hidden = Math.max(0, phone.length - head.length - tail.length);
  return `${head}${"•".repeat(hidden)}${tail}`;
}

export type UpdatesInfo = { channel: string | null; runtimeVersion: string | null; updateId: string | null; isEmbeddedLaunch: boolean | null };

/** `expo-updates` fields, null-tolerant (MAP §7.10: all null/false in local Gradle builds; the module can throw on web). `updateId` is cut to 8 chars. */
export function readUpdates(): UpdatesInfo {
  try {
    return {
      channel: Updates.channel ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: Updates.updateId ? Updates.updateId.slice(0, 8) : null,
      isEmbeddedLaunch: typeof Updates.isEmbeddedLaunch === "boolean" ? Updates.isEmbeddedLaunch : null,
    };
  } catch {
    return { channel: null, runtimeVersion: null, updateId: null, isEmbeddedLaunch: null };
  }
}

/** True on the Hermes engine (`HermesInternal` is defined). */
export function isHermes(): boolean {
  return "HermesInternal" in globalThis;
}

/** Keys the Data actions and Storage tab consider "ours": `nn_*`, `nn:*`. */
export function isNnKey(key: string): boolean {
  return CACHE_PREFIXES.some((p) => key.startsWith(p));
}

function isProtectedKey(key: string): boolean {
  return PROTECTED_PREFIXES.some((p) => key.startsWith(p));
}

/** `nn_user_orders_v1:<uuid>` → `nn_user_orders_v1:<uid>`: per-user keys must not leak the full user id the JSON cuts to 8. */
function maskStorageKey(key: string): string {
  return key.replace(/:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ":<uid>");
}

/** `{ key: KB }` (one decimal) for every `nn_*`/`nn:*` row, user-scoped key names masked. */
async function readStorageSizes(): Promise<Record<string, number>> {
  const keys = (await AsyncStorage.getAllKeys()).filter(isNnKey);
  const rows = await AsyncStorage.multiGet(keys);
  const out: Record<string, number> = {};
  for (const [key, value] of rows) {
    const masked = maskStorageKey(key);
    out[masked] = Math.round(((out[masked] ?? 0) + (value?.length ?? 0) / 1024) * 10) / 10;
  }
  return out;
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logSilentFailure(`DevActions.${label}`, err);
    return fallback;
  }
}

function phoneFromUserData(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "phone" in parsed && typeof parsed.phone === "string") return parsed.phone;
  } catch {
    // Corrupt userData — AuthContext handles it; the diagnostics just omit the phone.
  }
  return null;
}

/**
 * Removes every `nn_*`/`nn:*` row except `nn:dev:*` and `nn:prefs:*` and drops the query / store-service memory caches so
 * the next read goes to the network; resolves with the number of rows removed. The other CONTRACTS §9 memory mirrors
 * (cart items, active location, nearby set, recent searches) stay until the next cold start — the confirm copy says so.
 */
async function clearNnCaches(): Promise<number> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => isNnKey(k) && !isProtectedKey(k));
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  invalidate("");
  resetStoreServiceCaches();
  return keys.length;
}

/**
 * The diagnostics JSON (design §4.6): app, device, session (userId cut to 8, phone masked, NO token), prefs, non-default
 * flags, `nn:*` storage sizes in KB, and an ISO timestamp. Never throws — every async read falls back.
 */
export async function buildDiagnostics(): Promise<Record<string, unknown>> {
  const { version, build } = getAppVersion();
  const updates = readUpdates();
  const win = Dimensions.get("window");
  const [reduceMotion, push, storedUserId, storedUserData, storage] = await Promise.all([
    safe("reduceMotion", () => AccessibilityInfo.isReduceMotionEnabled(), false),
    safe("pushPermission", () => checkPushPermissionStatus(), "unavailable" as const),
    safe("userId", () => AsyncStorage.getItem("userId"), null),
    safe("userData", () => AsyncStorage.getItem("userData"), null),
    safe("storageSizes", () => readStorageSizes(), {} as Record<string, number>),
  ]);
  const location = getActiveLocationSync();
  const cart = getCartSnapshot();
  const prefs = getFeedbackPrefs();
  const flags: Record<string, boolean | number | string> = {};
  for (const f of getChangedFlags()) flags[f.name] = f.value;

  return {
    app: {
      version,
      versionCode: Constants.expoConfig?.android?.versionCode ?? build,
      profile: getBuildProfile(),
      channel: updates.channel,
      updateId: updates.updateId,
      dev: __DEV__,
      hermes: isHermes(),
    },
    device: {
      os: `${Platform.OS} ${String(Platform.Version)}`,
      model: Constants.deviceName ?? null,
      fontScale: PixelRatio.getFontScale(),
      reduceMotion,
      screen: `${Math.round(win.width)}x${Math.round(win.height)}@${win.scale}`,
    },
    session: {
      userId: storedUserId ? storedUserId.slice(0, 8) : null,
      phone: maskPhone(phoneFromUserData(storedUserData)),
      push,
      pushError: getLastPushRegistrationError(),
      location: location ? { lat: location.latitude, lng: location.longitude, source: location.source } : null,
      cart: { items: cart.totalQty, subtotal: cart.subtotal },
    },
    prefs: { sounds: prefs.sounds, haptics: prefs.haptics },
    flags,
    storage,
    at: new Date().toISOString(),
  };
}

/**
 * Confirm-gated dev action (optional extra, shared with DevPanel's lock and storage-delete): `Alert.alert` natively; on
 * web react-native-web's `Alert.alert` is an empty static method, so the browser's `confirm()` dialog gates it instead.
 */
export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = true): void {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Groups: Feedback (8 sound chips + Play all, 9 haptic chips) · Preview (Toast tones, Skeleton 3 s, Confetti) ·
 * Diagnostics (Copy diagnostics JSON, Send Sentry test event, Throw test error) · Data (Clear nn:* caches, Clear image
 * cache, Invalidate query cache, Simulate session expiry, Simulate reconnect, Simulate push received) · Flags (Reset all,
 * Export, Import) · Mode (Lock dev mode). Timers started here are cleared on unmount, except the "Skeleton 3 s" release,
 * which must outlive the panel (it closes the panel so the skeletons are visible).
 */
export function DevActions(): React.JSX.Element {
  const dev = useDevMode();
  const [confettiRun, setConfettiRun] = useState(0);
  const [armedError, setArmedError] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importDraft, setImportDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
  }, []);

  // "Throw test error": state set on the next frame after the confirm; the throw happens in render so the root
  // ErrorBoundary (not a promise rejection handler) receives it.
  if (armedError) throw new Error("Dev panel test error (intentional)");

  const schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
  };

  const run = (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    fn()
      .catch((err) => {
        logSilentFailure(`DevActions.${key}`, err);
        notify({ title: "Action failed", message: err instanceof Error ? err.message : undefined, tone: "error" });
      })
      .finally(() => setBusy(null));
  };

  // ── Feedback ──
  const playAll = () => SOUNDS.forEach((s, i) => schedule(() => previewSound(s.name), i * PLAY_ALL_GAP_MS));

  // ── Preview ──
  const toastTones = () =>
    TONES.forEach((tone, i) =>
      schedule(() => notify({ id: `dev-tone-${tone}`, title: `${tone} toast`, message: "Preview from the dev panel", tone, haptic: false }), i * TONE_GAP_MS),
    );
  const skeleton3s = () => {
    if (skeletonHold) clearTimeout(skeletonHold);
    setDevFlag("Dev_Onyx_inhibit_SkeletonExit", true)
      .then(() => feedback.toggle(true))
      .catch((err) => logSilentFailure("DevActions.skeletonOn", err));
    skeletonHold = setTimeout(() => {
      skeletonHold = null;
      setDevFlag("Dev_Onyx_inhibit_SkeletonExit", false)
        .then(() => feedback.toggle(false))
        .catch((err) => logSilentFailure("DevActions.skeletonOff", err));
    }, SKELETON_HOLD_MS);
    // Close the panel so the developer actually sees the skeletons behind it (the release timer survives the unmount).
    dev.closePanel();
  };

  // ── Diagnostics ──
  const copyDiagnostics = () =>
    run("copyDiagnostics", async () => {
      const d = await buildDiagnostics();
      copyText(JSON.stringify(d, null, 2), "Diagnostics copied");
    });
  const sendSentry = () =>
    run("sentry", async () => {
      const d = await buildDiagnostics();
      Sentry.addBreadcrumb({ category: "dev-panel", message: "diagnostics", level: "info", data: d });
      Sentry.captureMessage("dev-panel test");
      notify({ title: "Sent (if Sentry is enabled)" });
    });
  const throwError = () =>
    confirmAction("Throw a test error?", "The app shows the error screen until you tap Try again.", "Throw", () => {
      requestAnimationFrame(() => setArmedError(true));
    });

  // ── Data ──
  const clearCaches = () =>
    confirmAction(
      "Clear nn:* caches?",
      "Removes every nn_* / nn:* row except nn:dev:* and nn:prefs:* and drops the query cache. In-memory copies (cart, location, nearby set, recent searches) stay until the next cold start.",
      "Clear",
      () =>
        run("clearCaches", async () => {
          const n = await clearNnCaches();
          notify({ title: `${n} disk ${n === 1 ? "row" : "rows"} removed`, message: "Query cache dropped · memory mirrors stay until restart", tone: "success" });
        }),
    );
  const clearImages = () =>
    run("clearImages", async () => {
      await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
      notify({ title: "Image cache cleared", tone: "success" });
    });
  const invalidateQueries = () => {
    invalidate("");
    resetStoreServiceCaches();
    notify({ title: "Query cache invalidated" });
  };
  const sessionExpiry = () =>
    confirmAction("Simulate session expiry?", "Runs the same handler as a real 401 — you will be signed out.", "Expire", () => simulateSessionExpiry());
  const reconnect = () => {
    simulateReconnect();
    notify({ title: "Reconnect simulated" });
  };
  const simulatePush = () =>
    run("push", async () => {
      if (Platform.OS === "web") {
        notify({ title: "Not available on web", tone: "warning" });
        return;
      }
      if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
        notify({ title: "Not available in Expo Go", tone: "warning" });
        return;
      }
      const permission = await checkPushPermissionStatus();
      if (permission !== "granted") {
        notify({ title: "Notifications not permitted", message: `Permission is ${permission} — nothing would arrive`, tone: "warning" });
        return;
      }
      // Deep-link to the newest real order when one is in memory; a made-up id would only open the error state.
      const orderId = getMemoryOrders()?.[0]?.id;
      await Notifications.scheduleNotificationAsync({
        content: { title: "Order update", body: "Your order is on the way", data: orderId ? { orderId } : undefined },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: PUSH_DELAY_S },
      });
      notify({ title: `Push arrives in ${PUSH_DELAY_S} s`, message: orderId ? `Tap opens order ${orderId.slice(0, 8)}` : "No recent order in memory — the tap opens nothing" });
    });

  // ── Flags ──
  const resetAll = () =>
    confirmAction("Reset all flags?", "Every flag goes back to its default. Dev mode stays unlocked.", "Reset", () =>
      run("resetFlags", async () => {
        await resetDevFlags();
        feedback.toggle(false);
        notify({ title: "Flags reset" });
      }),
    );
  const exportFlags = () => {
    if (getChangedFlags().length === 0) {
      notify({ title: "No flags changed" });
      return;
    }
    copyText(exportDevFlags(), "Flags copied");
  };
  const applyImport = (json: string) =>
    run("importFlags", async () => {
      const { applied, rejected } = await importDevFlags(json);
      if (applied > 0) feedback.toggle(true);
      else feedback.error();
      notify({
        title: `${applied} applied · ${rejected.length} rejected`,
        message: rejected.length > 0 ? rejected.slice(0, 3).join(", ") : undefined,
        tone: applied > 0 ? "success" : "error",
      });
      if (applied > 0) {
        setImportOpen(false);
        setImportDraft("");
      }
    });
  const importFlags = () => {
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Import flags",
        "Paste the JSON copied by Export.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Import", onPress: (json?: string) => applyImport(json ?? "") },
        ],
        "plain-text",
      );
      return;
    }
    setImportOpen((o) => !o);
  };

  // ── Mode ──
  const lock = () =>
    confirmAction("Lock dev mode?", "Clears the unlock on this device and resets every flag.", "Lock", () => {
      dev.lock().catch((err) => logSilentFailure("DevActions.lock", err));
    });

  return (
    <View testID="dev-actions">
      <DevSectionTitle>Feedback</DevSectionTitle>
      <Text style={devText.caption} maxFontSizeMultiplier={1.3}>
        Previews bypass prefs, throttles and the master flag (still silent on web).
      </Text>
      <View style={styles.wrap}>
        {SOUNDS.map((s) => (
          <Chip key={s.name} size="sm" haptic={false} label={`${s.name} ${s.ms} ms`} onPress={() => previewSound(s.name)} accessibilityLabel={`Play ${s.name} sound`} />
        ))}
      </View>
      <View style={styles.wrap}>
        <PrimaryButton label="Play all" size="xs" variant="secondary" onPress={playAll} />
      </View>
      <Text style={[devText.caption, styles.subhead]} maxFontSizeMultiplier={1.3}>
        Fire each haptic
      </Text>
      <View style={styles.wrap}>
        {HAPTICS.map((h) => (
          <Chip key={h} size="sm" haptic={false} label={h} onPress={() => previewHaptic(h)} accessibilityLabel={`Fire ${h} haptic`} />
        ))}
      </View>

      <DevSectionTitle>Preview</DevSectionTitle>
      <View style={styles.wrap}>
        <PrimaryButton label="Toast tones" size="xs" variant="secondary" onPress={toastTones} />
        <PrimaryButton label="Skeleton 3 s" size="xs" variant="secondary" onPress={skeleton3s} />
        <PrimaryButton label="Confetti" size="xs" variant="secondary" onPress={() => setConfettiRun((n) => n + 1)} />
      </View>
      <View style={styles.previewBox} accessibilityLabel="Confetti preview" accessibilityRole="image">
        {confettiRun > 0 ? <Confetti key={confettiRun} onDone={() => setConfettiRun(0)} style={StyleSheet.absoluteFill} /> : null}
        <Text style={devText.caption} maxFontSizeMultiplier={1.3}>
          {confettiRun > 0 ? "Confetti" : "Preview area"}
        </Text>
      </View>

      <DevSectionTitle>Diagnostics</DevSectionTitle>
      <View style={styles.wrap}>
        <PrimaryButton label="Copy diagnostics JSON" size="xs" variant="secondary" onPress={copyDiagnostics} loading={busy === "copyDiagnostics"} />
        <PrimaryButton label="Send Sentry test event" size="xs" variant="secondary" onPress={sendSentry} loading={busy === "sentry"} />
        <PrimaryButton label="Throw test error" size="xs" variant="secondary" onPress={throwError} />
      </View>

      <DevSectionTitle>Data</DevSectionTitle>
      <View style={styles.wrap}>
        <PrimaryButton label="Clear nn:* caches" size="xs" variant="secondary" onPress={clearCaches} loading={busy === "clearCaches"} />
        <PrimaryButton label="Clear image cache" size="xs" variant="secondary" onPress={clearImages} loading={busy === "clearImages"} />
        <PrimaryButton label="Invalidate query cache" size="xs" variant="secondary" onPress={invalidateQueries} />
        <PrimaryButton label="Simulate session expiry" size="xs" variant="secondary" onPress={sessionExpiry} />
        <PrimaryButton label="Simulate reconnect" size="xs" variant="secondary" onPress={reconnect} />
        <PrimaryButton label="Simulate push received" size="xs" variant="secondary" onPress={simulatePush} loading={busy === "push"} />
      </View>

      <DevSectionTitle>Flags</DevSectionTitle>
      <View style={styles.wrap}>
        <PrimaryButton label="Reset all" size="xs" variant="secondary" onPress={resetAll} />
        <PrimaryButton label="Export" size="xs" variant="secondary" onPress={exportFlags} />
        <PrimaryButton label="Import" size="xs" variant="secondary" onPress={importFlags} />
      </View>
      {importOpen ? (
        <View style={styles.importBox}>
          <Input
            variant="outlined"
            label="Flags JSON"
            value={importDraft}
            onChangeText={setImportDraft}
            placeholder='{"Dev_Network_inhibit_LatencyMs": 1500}'
            multiline
            numberOfLines={4}
            autoCapitalize="none"
            autoCorrect={false}
            inputStyle={[devText.code, styles.importInput]}
            focusColor={C.text}
            accessibilityLabel="Flags JSON to import"
          />
          <View style={styles.wrap}>
            <PrimaryButton label="Apply import" size="xs" variant="secondary" disabled={importDraft.trim() === ""} onPress={() => applyImport(importDraft)} loading={busy === "importFlags"} />
            <PrimaryButton label="Cancel" size="xs" variant="secondary" onPress={() => setImportOpen(false)} />
          </View>
        </View>
      ) : null}

      <DevSectionTitle>Mode</DevSectionTitle>
      <View style={styles.wrap}>
        <PrimaryButton label="Lock dev mode" size="xs" variant="danger" onPress={lock} accessibilityLabel="Lock dev mode" />
      </View>
      <Text style={[devText.caption, styles.footnote]} maxFontSizeMultiplier={1.3}>
        Locking clears nn:dev:unlocked and every flag; the pill and stripe disappear.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  subhead: { marginTop: 12 },
  previewBox: {
    marginTop: 10,
    height: PREVIEW_BOX_HEIGHT,
    borderRadius: radius.xl,
    backgroundColor: C.bgSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  importBox: { marginTop: 10, gap: 4 },
  importInput: { minHeight: 96, textAlignVertical: "top" },
  footnote: { marginTop: 8, marginBottom: 8 },
});
