// codename: indigo
// The developer panel (CONTRACTS §5, design §4.4): a `BottomSheet maxHeight 92%` titled "Developer" with an env Badge,
// a version chip, a "×N" chip while Dev_Motion_inhibit_SpeedFactor ≠ 1 and a lock button; a sticky strip of private
// pills — Env · Session · Flags · Actions · Storage (selected pill fills C.text, never brand green); and one scrolling
// body per tab. It is an internal tool: ink on white and sand, mono values in copyable chips, flag names verbatim.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { C } from "../../constants/colors";
import { fontFamily, radius, text } from "../../constants/ui";
import { useAuth } from "../../context/AuthContext";
import { getCartSnapshot, subscribeCart } from "../../context/CartContext";
import { useDevMode } from "../../context/DevModeContext";
import { useLocation } from "../../context/LocationContext";
import { getApiBase, getNetworkLog, type NetworkLogEntry } from "../../lib/apiClient";
import { getAppExtra, getAppVersion, getBuildProfile, type BuildProfile } from "../../lib/appExtra";
import { getBootTimeline } from "../../lib/bootGate";
import {
  DEV_FLAGS,
  DEV_FLAG_AREA_ORDER,
  getChangedFlags,
  getDevPinSource,
  isSimulating,
  resetDevFlag,
  subscribeDevFlags,
  useDevFlag,
  type DevFlagArea,
  type DevFlagName,
} from "../../lib/devFlags";
import { feedback, useFeedbackPrefs } from "../../lib/feedback";
import { logSilentFailure } from "../../lib/logSilentFailure";
import { checkPushPermissionStatus, getLastPushRegistrationError, getLastPushToken } from "../../lib/pushNotificationStatus";
import { SUPABASE_HOST } from "../../lib/supabase";
import { Badge, BottomSheet, ChevronRotate, Collapsible, IconButton, Input, PrimaryButton, type BadgeTone } from "../ui";
import { DevActions, confirmAction, isHermes, isNnKey, maskPhone, readUpdates } from "./DevActions";
import { DevFlagRow } from "./DevFlagRow";
import { DevKeyValue, DevPills, DevSectionTitle, ValueChip, copyText, devText, type DevPillItem } from "./DevKeyValue";

export type DevPanelProps = { visible: boolean; onClose: () => void };

// ─── Module constants ─────────────────────────────────────────────────────────

type DevTab = "env" | "session" | "flags" | "actions" | "storage";

const TABS: readonly DevPillItem<DevTab>[] = [
  { key: "env", label: "Env" },
  { key: "session", label: "Session" },
  { key: "flags", label: "Flags" },
  { key: "actions", label: "Actions" },
  { key: "storage", label: "Storage" },
];

const PROFILE_TONE: Record<BuildProfile, BadgeTone> = { local: "neutral", development: "neutral", preview: "warning", production: "danger" };

/** Panel max height as a fraction of the window (CONTRACTS §5). */
const PANEL_MAX_FRACTION = 0.92;
/** A filter that still matches more rows than this keeps the user's open set instead of force-expanding every area. */
const AUTO_EXPAND_MAX_ROWS = 40;
/** Storage rows above this size are drawn in C.danger (MAP §7.12: Android's 2 MB CursorWindow). */
const STORAGE_DANGER_KB = 1536;
/** Characters of a storage value shown inline. */
const STORAGE_PREVIEW_CHARS = 2048;
/** Auth keys shown in the Storage tab besides `nn_*`/`nn:*`. */
const AUTH_KEYS = ["userId", "userData", "customerData"] as const;
function isAuthKey(key: string): boolean {
  return AUTH_KEYS.some((a) => a === key);
}
/** Network log rows shown (the buffer itself holds 50). */
const NETWORK_LOG_ROWS = 50;

const ALL_FLAG_NAMES = Object.keys(DEV_FLAGS) as DevFlagName[];
const FLAGS_BY_AREA: ReadonlyMap<DevFlagArea, readonly DevFlagName[]> = (() => {
  const map = new Map<DevFlagArea, DevFlagName[]>();
  for (const name of ALL_FLAG_NAMES) {
    const area = DEV_FLAGS[name].area;
    const list = map.get(area);
    if (list) list.push(name);
    else map.set(area, [name]);
  }
  return map;
})();
/** `DEV_FLAG_AREA_ORDER` first, then any area the order forgot (registry order), only areas that have flags. */
const AREAS: readonly DevFlagArea[] = (() => {
  const ordered = DEV_FLAG_AREA_ORDER.filter((a) => FLAGS_BY_AREA.has(a));
  const seen = new Set(ordered);
  for (const area of FLAGS_BY_AREA.keys()) if (!seen.has(area)) ordered.push(area);
  return ordered;
})();

function getChangedCount(): number {
  return getChangedFlags().length;
}
/** Stable string snapshot of the changed set (useSyncExternalStore needs a primitive to compare). */
function getChangedKey(): string {
  return getChangedFlags()
    .map((f) => f.name)
    .join("|");
}
/** `https://api.example.com/x` → `api.example.com` (RN's URL polyfill does not implement `host`). */
function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").split("/")[0] || "—";
}
/** `Platform.constants.reactNativeVersion` as "0.81.5"; react-native-web has no `constants`, so it falls back to "—". */
function rnVersion(): string {
  try {
    const rn = Platform.constants.reactNativeVersion;
    return `${rn.major}.${rn.minor}.${rn.patch}${rn.prerelease ? `-${rn.prerelease}` : ""}`;
  } catch {
    return "—";
  }
}
function timeOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function formatLogLine(e: NetworkLogEntry): string {
  return `${timeOf(e.at)} ${e.method.padEnd(6)} ${String(e.status).padEnd(7)} ${String(Math.round(e.ms)).padStart(5)} ms  ${e.path}${e.cacheHit ? "  (hit)" : ""}`;
}
/** `someone@example.com` → `s•••@example.com`. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? "•••" : `${email.slice(0, 1)}•••${email.slice(at)}`;
}
/**
 * Preview text of the auth rows: `userId` cut to 8, phone/mobile and email fields masked — the same hygiene the Session
 * tab and the diagnostics JSON apply. Anything that is not a JSON object is shown as is.
 */
function maskAuthPreview(key: string, raw: string): string {
  if (key === "userId") return `${raw.slice(0, 8)}…`;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return raw;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && /phone|mobile/i.test(k)) out[k] = maskPhone(v);
      else if (typeof v === "string" && /email/i.test(k)) out[k] = maskEmail(v);
      else out[k] = v;
    }
    return JSON.stringify(out, null, 2);
  } catch {
    return raw;
  }
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/**
 * Header extras: env `Badge` (local/development neutral · preview warning · production danger), version chip
 * (`getAppVersion()`), "×N" warning Badge while the speed factor ≠ 1, lock `IconButton` (`confirmAction` → `dev.lock()`).
 * `__DEV__` builds add the caption "Shake: unavailable in debug builds". Tab switch = `feedback.select()` only (Q2).
 * The body ScrollView carries no explicit height: it flex-shrinks inside the sheet's 92 % cap, so whenever a tab is
 * taller than the window the panel sits exactly at `maxHeight` and BottomSheet disables its body pan over the list.
 */
export function DevPanel({ visible, onClose }: DevPanelProps): React.JSX.Element {
  const dev = useDevMode();
  const [tab, setTab] = useState<DevTab>("env");
  const speed = useDevFlag("Dev_Motion_inhibit_SpeedFactor");
  const profile = getBuildProfile();
  const { version, build } = getAppVersion();

  const confirmLock = () =>
    confirmAction("Lock dev mode?", "Clears the unlock on this device and resets every flag.", "Lock", () => {
      dev.lock().catch((err) => logSilentFailure("DevPanel.lock", err));
    });

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Developer"
      showClose
      maxHeight={`${PANEL_MAX_FRACTION * 100}%`}
      keyboardAvoiding={Platform.OS === "ios"}
      contentStyle={styles.sheetContent}
      testID="dev-panel"
    >
      <View style={styles.headerExtras}>
        <Badge label={profile} tone={PROFILE_TONE[profile]} size="sm" pill />
        <ValueChip value={`v${version} (${build})`} accessibilityLabel={`Version ${version}, build ${build}`} />
        {speed !== 1 ? <Badge label={`×${speed}`} tone="warning" size="sm" pill testID="dev-speed-chip" /> : null}
        <View style={styles.spacer} />
        <IconButton icon="lock-outline" size={34} iconSize={18} accessibilityLabel="Lock dev mode" onPress={confirmLock} testID="dev-lock" />
      </View>
      {__DEV__ ? (
        <Text style={[devText.caption, styles.devNote]} maxFontSizeMultiplier={1.3}>
          Shake: unavailable in debug builds (RN&apos;s dev menu owns it) — use the pill or long-press the Profile footer.
        </Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabStrip} contentContainerStyle={styles.tabStripContent} keyboardShouldPersistTaps="handled">
        <DevPills items={TABS} value={tab} onChange={setTab} role="tablist" size="sm" accessibilityLabel="Developer panel sections" />
      </ScrollView>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        testID={`dev-tab-${tab}`}
      >
        {tab === "env" ? <EnvTab profile={profile} version={version} build={build} /> : null}
        {tab === "session" ? <SessionTab /> : null}
        {tab === "flags" ? <FlagsTab /> : null}
        {tab === "actions" ? <DevActions /> : null}
        {tab === "storage" ? <StorageTab /> : null}
      </ScrollView>
    </BottomSheet>
  );
}

// ─── Env tab ──────────────────────────────────────────────────────────────────

function EnvTab({ profile, version, build }: { profile: BuildProfile; version: string; build: string }): React.JSX.Element {
  const { width, height, scale, fontScale } = useWindowDimensions();
  const reduced = useReducedMotion();
  const updates = readUpdates();
  const pinSource = getDevPinSource();
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || getAppExtra().sentryDsn || "";
  let locale = "—";
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    // Older Hermes without Intl — leave the dash.
  }

  return (
    <View>
      <DevSectionTitle>App</DevSectionTitle>
      <DevKeyValue label="App version" value={version} />
      <DevKeyValue label="versionCode" value={Constants.expoConfig?.android?.versionCode ?? build} />
      <DevKeyValue label="Native version" value={Application.nativeApplicationVersion} />
      <DevKeyValue label="Native build" value={Application.nativeBuildVersion} />
      <DevKeyValue label="Build profile" value={profile} />
      <DevKeyValue label="Updates.channel" value={updates.channel} />
      <DevKeyValue label="Updates.runtimeVersion" value={updates.runtimeVersion} />
      <DevKeyValue label="Updates.updateId" value={updates.updateId} />
      <DevKeyValue label="Updates.isEmbeddedLaunch" value={updates.isEmbeddedLaunch} />
      <DevKeyValue label="Execution environment" value={Constants.executionEnvironment} />
      <DevKeyValue label="__DEV__" value={__DEV__} />
      <DevKeyValue label="Hermes" value={isHermes()} />
      <DevKeyValue label="React Native" value={rnVersion()} />

      <DevSectionTitle>Backends</DevSectionTitle>
      <DevKeyValue label="API host" value={hostOf(getApiBase())} />
      <DevKeyValue label="Supabase host" value={SUPABASE_HOST || null} />
      <DevKeyValue label="Sentry" value={`${dsn && !__DEV__ ? "enabled" : "disabled"} · DSN ${dsn ? "present" : "missing"}`} />
      <DevKeyValue
        label="PIN source"
        value={pinSource}
        danger={pinSource === "default"}
        hint={pinSource === "default" ? "Set EXPO_PUBLIC_DEV_PANEL_PIN in the EAS profile" : undefined}
      />

      <DevSectionTitle>Device</DevSectionTitle>
      <DevKeyValue label="Device" value={`${Platform.OS} ${String(Platform.Version)}${Constants.deviceName ? ` · ${Constants.deviceName}` : ""}`} />
      <DevKeyValue label="Screen" value={`${Math.round(width)}×${Math.round(height)} @${scale}`} />
      <DevKeyValue label="Font scale" value={fontScale} />
      <DevKeyValue label="Reduce motion (OS)" value={reduced} />
      <DevKeyValue label="Locale" value={locale} />
    </View>
  );
}

// ─── Session tab ──────────────────────────────────────────────────────────────

function SessionTab(): React.JSX.Element {
  const { userId, user, userToken } = useAuth();
  const { location, locationKey } = useLocation();
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getCartSnapshot);
  const [prefs] = useFeedbackPrefs();
  const reduced = useReducedMotion();
  const dev = useDevMode();
  const changedCount = useSyncExternalStore(subscribeDevFlags, getChangedCount, getChangedCount);
  const simulating = useSyncExternalStore(subscribeDevFlags, isSimulating, isSimulating);
  const [pushPermission, setPushPermission] = useState<string>("…");
  const [pushTokenTail, setPushTokenTail] = useState<string | null>(null);
  const [log, setLog] = useState<NetworkLogEntry[]>([]);
  const [timeline, setTimeline] = useState<{ mark: string; ms: number }[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    checkPushPermissionStatus()
      .then((s) => {
        if (!cancelled) setPushPermission(s);
      })
      .catch((err) => {
        logSilentFailure("DevPanel.pushPermission", err);
        if (!cancelled) setPushPermission("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // The log, timeline and push token are module-level mirrors — snapshot them on mount and on every Refresh.
  useEffect(() => {
    setLog(getNetworkLog().slice(-NETWORK_LOG_ROWS).reverse());
    setTimeline(getBootTimeline());
    setPushTokenTail(getLastPushToken()?.slice(-6) ?? null);
  }, [tick]);

  const unlockedSince = dev.unlockedAt ? new Date(dev.unlockedAt).toLocaleTimeString("en-IN") : dev.unlocked ? "before launch" : "locked";

  return (
    <View>
      <DevSectionTitle>Account</DevSectionTitle>
      <DevKeyValue label="User id" value={userId ? userId.slice(0, 8) : null} />
      <DevKeyValue label="Phone" value={maskPhone(user?.phone)} />
      <DevKeyValue label="Token present" value={!!userToken} />
      <DevKeyValue label="Push permission" value={pushPermission} />
      <DevKeyValue label="Push token tail" value={pushTokenTail} hint={pushTokenTail ? "last 6 chars" : "No token in this process (not registered, failed or Expo Go)"} />
      <DevKeyValue label="Last push error" value={getLastPushRegistrationError()} />

      <DevSectionTitle>Location &amp; cart</DevSectionTitle>
      <DevKeyValue label="Active location" value={location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : null} />
      <DevKeyValue label="Location source" value={location ? `${location.source} · ${location.label}` : null} mono={false} />
      <DevKeyValue label="Nearby key" value={locationKey} />
      <DevKeyValue
        label="Cart"
        value={`${cart.totalQty} items · ₹${Math.round(cart.subtotal)}${cart.appliedCoupon ? ` · ${cart.appliedCoupon.code}` : ""}${cart.isHydrated ? "" : " · not hydrated"}`}
      />

      <DevSectionTitle>Preferences &amp; dev mode</DevSectionTitle>
      <DevKeyValue label="Sounds" value={prefs.sounds} hint="user pref" />
      <DevKeyValue label="Haptics" value={prefs.haptics} hint="user pref" />
      <DevKeyValue label="Reduce motion (OS)" value={reduced} />
      <DevKeyValue label="Unlocked since" value={unlockedSince} />
      <DevKeyValue label="Flags changed" value={changedCount} />
      <DevKeyValue label="Simulation stripe" value={simulating ? "on" : "off"} />

      <View style={styles.sectionRow}>
        <DevSectionTitle style={styles.sectionRowTitle}>Network log</DevSectionTitle>
        <PrimaryButton label="Refresh" size="xs" variant="secondary" onPress={() => setTick((t) => t + 1)} />
        <PrimaryButton
          label="Copy network log"
          size="xs"
          variant="secondary"
          disabled={log.length === 0}
          onPress={() => copyText(JSON.stringify(log, null, 2), "Network log copied")}
        />
      </View>
      {log.length === 0 ? (
        <Text style={devText.caption} maxFontSizeMultiplier={1.3}>
          Nothing recorded — turn on Dev_Perf_inhibit_NetworkLog in Flags.
        </Text>
      ) : (
        <View style={styles.codeBlock}>
          {log.map((e, i) => (
            <Text key={`${e.at}-${i}`} style={devText.codeSm} selectable numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {formatLogLine(e)}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.sectionRow}>
        <DevSectionTitle style={styles.sectionRowTitle}>Boot timeline</DevSectionTitle>
        <PrimaryButton label="Copy boot timeline" size="xs" variant="secondary" onPress={() => copyText(JSON.stringify(timeline, null, 2), "Boot timeline copied")} />
      </View>
      {timeline.map((m) => (
        <DevKeyValue key={m.mark} label={m.mark} value={`${m.ms} ms`} />
      ))}
      {timeline.length <= 1 ? (
        <Text style={[devText.caption, styles.captionGap]} maxFontSizeMultiplier={1.3}>
          Turn on Dev_Perf_inhibit_BootTimeline and restart to record every mark.
        </Text>
      ) : null}
    </View>
  );
}

// ─── Flags tab ────────────────────────────────────────────────────────────────

function flagMatches(name: DevFlagName, q: string): boolean {
  const def = DEV_FLAGS[name];
  return name.toLowerCase().includes(q) || def.label.toLowerCase().includes(q) || def.area.toLowerCase().includes(q) || def.help.toLowerCase().includes(q);
}

function FlagsTab(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<DevFlagArea>>(() => new Set());
  const changedKey = useSyncExternalStore(subscribeDevFlags, getChangedKey, getChangedKey);
  const changedSet = useMemo(() => new Set(changedKey ? changedKey.split("|") : []), [changedKey]);
  const q = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      AREAS.map((area) => {
        const all = FLAGS_BY_AREA.get(area) ?? [];
        return { area, names: q ? all.filter((n) => flagMatches(n, q)) : all };
      }).filter((g) => g.names.length > 0),
    [q],
  );
  const shown = groups.reduce((n, g) => n + g.names.length, 0);
  // A broad query ("d", "inhibit") would mount every row and its native Switch in one frame — only narrow results auto-expand.
  const autoExpand = q !== "" && shown <= AUTO_EXPAND_MAX_ROWS;

  const toggleArea = (area: DevFlagArea) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });

  const resetArea = (names: readonly DevFlagName[]) => {
    const targets = names.filter((n) => changedSet.has(n));
    if (targets.length === 0) return;
    Promise.all(targets.map((n) => resetDevFlag(n)))
      .then(() => feedback.toggle(false))
      .catch((err) => logSilentFailure("DevPanel.resetArea", err));
  };

  return (
    <View>
      <Input
        variant="outlined"
        value={query}
        onChangeText={setQuery}
        placeholder="Filter flags…"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Filter flags"
        focusColor={C.text}
        containerStyle={styles.filter}
        right={query ? <IconButton icon="close" size={28} iconSize={16} bg="transparent" accessibilityLabel="Clear filter" onPress={() => setQuery("")} /> : undefined}
      />
      <Text style={[devText.caption, styles.captionGap]} maxFontSizeMultiplier={1.3}>
        {shown} of {ALL_FLAG_NAMES.length} flags · {changedSet.size} changed · long-press a row to reset it
        {q !== "" && !autoExpand ? " · narrow the filter or tap an area to expand" : ""}
      </Text>
      {groups.map(({ area, names }) => {
        const changedHere = names.reduce((n, name) => n + (changedSet.has(name) ? 1 : 0), 0);
        const expanded = autoExpand || open.has(area);
        return (
          <View key={area} style={styles.group}>
            <Pressable
              onPress={() => toggleArea(area)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${area}, ${names.length} flags${changedHere ? `, ${changedHere} changed` : ""}`}
              style={({ pressed }) => [styles.groupHeader, pressed && styles.groupHeaderPressed]}
            >
              <ChevronRotate open={expanded} size={18} />
              <Text style={styles.groupTitle} maxFontSizeMultiplier={1.3}>
                {area} · {names.length}
              </Text>
              {changedHere > 0 ? <Badge label={`${changedHere} changed`} tone="warning" size="sm" pill /> : null}
              {changedHere > 0 ? (
                <Pressable onPress={() => resetArea(names)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Reset ${area} flags`}>
                  <Text style={styles.resetLink} maxFontSizeMultiplier={1.3}>
                    Reset
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
            <Collapsible open={expanded}>
              {names.map((name) => (
                <DevFlagRow key={name} name={name} />
              ))}
            </Collapsible>
          </View>
        );
      })}
      {groups.length === 0 ? (
        <Text style={[devText.caption, styles.captionGap]} maxFontSizeMultiplier={1.3}>
          No flag matches &quot;{query}&quot;.
        </Text>
      ) : null}
    </View>
  );
}

// ─── Storage tab ──────────────────────────────────────────────────────────────

type StorageRow = { key: string; kb: number; value: string | null };

function StorageTab(): React.JSX.Element {
  const [rows, setRows] = useState<StorageRow[] | null>(null);
  const [tokenPresent, setTokenPresent] = useState<string>("…");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = (await AsyncStorage.getAllKeys()).filter((k) => isNnKey(k) || isAuthKey(k));
        const pairs = await AsyncStorage.multiGet(keys);
        const next = pairs
          .map(([key, value]) => ({ key, kb: Math.round(((value?.length ?? 0) / 1024) * 10) / 10, value }))
          .sort((a, b) => a.key.localeCompare(b.key));
        if (!cancelled) setRows(next);
      } catch (err) {
        logSilentFailure("DevPanel.storage", err);
        if (!cancelled) setRows([]);
      }
      if (Platform.OS === "web") {
        if (!cancelled) setTokenPresent("n/a on web");
        return;
      }
      try {
        const token = await SecureStore.getItemAsync("userToken");
        if (!cancelled) setTokenPresent(token ? "yes" : "no");
      } catch (err) {
        logSilentFailure("DevPanel.secureStore", err);
        if (!cancelled) setTokenPresent("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const totalKb = rows ? Math.round(rows.reduce((n, r) => n + r.kb, 0) * 10) / 10 : 0;

  const confirmDelete = (key: string) =>
    confirmAction("Delete this row?", key, "Delete", () => {
      AsyncStorage.removeItem(key)
        .then(() => {
          feedback.toggle(false);
          setPreviewKey((k) => (k === key ? null : k));
          setTick((t) => t + 1);
        })
        .catch((err) => logSilentFailure("DevPanel.storageDelete", err));
    });

  /** The 2 KB preview; auth rows are masked (phone/email) and `userId` cut to 8 instead of printed in clear. */
  const previewOf = (row: StorageRow): string => {
    if (row.value === null) return "(null)";
    if (isAuthKey(row.key)) return maskAuthPreview(row.key, row.value).slice(0, STORAGE_PREVIEW_CHARS);
    const more = row.value.length - STORAGE_PREVIEW_CHARS;
    return `${row.value.slice(0, STORAGE_PREVIEW_CHARS)}${more > 0 ? `\n… ${more} more chars` : ""}`;
  };

  return (
    <View>
      <View style={styles.sectionRow}>
        <DevSectionTitle style={styles.sectionRowTitle}>AsyncStorage</DevSectionTitle>
        <PrimaryButton label="Refresh" size="xs" variant="secondary" onPress={() => setTick((t) => t + 1)} />
      </View>
      <DevKeyValue label="SecureStore userToken" value={tokenPresent} />
      <DevKeyValue label="Rows" value={rows ? `${rows.length} · ${totalKb} KB` : "…"} />
      <Text style={[devText.caption, styles.captionGap]} maxFontSizeMultiplier={1.3}>
        Tap a row to preview the first 2 KB · long-press to delete · rows over 1.5 MB are red (Android CursorWindow).
      </Text>
      {rows?.map((row) => {
        const previewing = previewKey === row.key;
        return (
          <View key={row.key}>
            <Pressable
              onPress={() => setPreviewKey(previewing ? null : row.key)}
              onLongPress={() => confirmDelete(row.key)}
              delayLongPress={500}
              accessibilityRole="button"
              accessibilityLabel={`${row.key}, ${row.kb} kilobytes`}
              accessibilityHint="Tap to preview, long press to delete"
              accessibilityState={{ expanded: previewing }}
              style={({ pressed }) => [styles.storageRow, pressed && styles.groupHeaderPressed]}
            >
              <Text style={[devText.code, styles.storageKey]} numberOfLines={1} selectable maxFontSizeMultiplier={1.2}>
                {row.key}
              </Text>
              <ValueChip value={`${row.kb.toFixed(1)} KB`} danger={row.kb > STORAGE_DANGER_KB} accessibilityLabel={`${row.kb} kilobytes`} />
            </Pressable>
            {previewing ? (
              <View style={styles.codeBlock}>
                <Text style={devText.codeSm} selectable maxFontSizeMultiplier={1.2}>
                  {previewOf(row)}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetContent: { paddingHorizontal: 20, flexShrink: 1 },
  headerExtras: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8 },
  spacer: { flex: 1 },
  devNote: { paddingBottom: 8 },
  tabStrip: { flexGrow: 0, marginHorizontal: -20 },
  tabStripContent: { paddingHorizontal: 20, paddingVertical: 6 },
  body: { flexShrink: 1, flexGrow: 0, marginHorizontal: -20 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 24 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 },
  sectionRowTitle: { flex: 1, marginTop: 8 },
  codeBlock: { backgroundColor: C.bgSoft, borderRadius: radius.md, padding: 10, marginTop: 6, gap: 2 },
  captionGap: { marginTop: 6, marginBottom: 4 },
  filter: { marginTop: 4 },
  group: { marginTop: 8 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingVertical: 6 },
  groupHeaderPressed: { backgroundColor: C.bgSoft },
  groupTitle: { ...text.rowTitle, flex: 1 },
  resetLink: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, color: C.text, textDecorationLine: "underline", paddingHorizontal: 4 },
  storageRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  storageKey: { flex: 1 },
});
