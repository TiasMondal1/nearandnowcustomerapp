// Select delivery location — the sheet-styled modal (zephyr presentation) opened from Home and checkout:
// Places search, "Use current location" (permission-primed), the saved addresses as radio rows with distance
// from the active location (C25) and a "Default" badge (C26), and "Add new address" → the centre-pin map.
// Picking anything sets the active location, plays `toggle(true)` + a toast and unwinds to `returnTo`
// (only through `parseReturnTo`, never a raw param) or pops (quartz, 2026-10-03; MAP P20/U19/U35).
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Linking, StyleSheet, Text, View } from "react-native";

import { AddressRow } from "../components/location/AddressRow";
import {
  EmptyState,
  IconButton,
  Input,
  ListRow,
  Screen,
  SectionLabel,
  Skeleton,
  SkeletonScreen,
  SkeletonText,
  notify,
} from "../components/ui";
import { C } from "../constants/colors";
import { layout, text } from "../constants/ui";
import { useAuth } from "../context/AuthContext";
import { useLocation, type ActiveLocation } from "../context/LocationContext";
import { useDeviceAddress } from "../hooks/useDeviceAddress";
import { useRefetchOnReconnect } from "../hooks/useRefetchOnReconnect";
import { useForceSkeleton } from "../hooks/useSlowLoad";
import { getUserAddresses, parseReturnTo, peekAddresses, type SavedAddress } from "../lib/addressService";
import { calculateDistance } from "../lib/distanceUtils";
import { feedback } from "../lib/feedback";
import { logError } from "../lib/logError";
import { logSilentFailure } from "../lib/logSilentFailure";
import { autocomplete, newPlacesSessionToken, placeDetails, type AutocompletePrediction } from "../lib/placesService";
import { QC_KEYS, useCachedValue } from "../lib/queryCache";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Places Autocomplete debounce: one request per pause in typing, not per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;
/** Three ListRow-lg twins while the first list loads. */
const SKELETON_ROWS = [0, 1, 2] as const;
/** Two saved addresses within ~1 m are the same place (coordinates round-trip through the API as floats). */
const SAME_PLACE_DEG = 1e-5;
const SEARCH_ICON = 20;
const CLEAR_BUTTON = 32;
const CLEAR_ICON = 18;

type Coords = { latitude: number; longitude: number };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** (0,0) and non-finite coordinates are never a customer address (MAP §2.11 #39). */
function isValidCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function addressCoords(a: SavedAddress): Coords | null {
  const lat = typeof a.latitude === "number" ? a.latitude : Number(a.latitude);
  const lng = typeof a.longitude === "number" ? a.longitude : Number(a.longitude);
  return isValidCoords(lat, lng) ? { latitude: lat, longitude: lng } : null;
}

/** The row is "selected" when it IS the active location: same spot, or the same label + address line. */
function isActiveAddress(active: ActiveLocation | null, a: SavedAddress, coords: Coords | null): boolean {
  if (!active) return false;
  if (
    coords &&
    Math.abs(coords.latitude - active.latitude) < SAME_PLACE_DEG &&
    Math.abs(coords.longitude - active.longitude) < SAME_PLACE_DEG
  ) {
    return true;
  }
  return active.label === a.label && !!active.address && active.address === a.address;
}

function predictionTitle(p: AutocompletePrediction): string {
  return p.structured_formatting?.main_text || p.description;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SelectLocationScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = parseReturnTo(params.returnTo);
  // The add flow (map → details → save) unwinds with dismissTo: to the caller's returnTo, or to Home when the
  // sheet was opened without one (Home's own address pill) — never back onto the map.
  const addReturnTo = returnTo ?? "/(tabs)/home";

  const { userId } = useAuth();
  const uid = userId ?? "";
  const { location: activeLocation, setLocation } = useLocation();
  const { request: requestDeviceAddress, busy: gpsBusy, denied: gpsDenied } = useDeviceAddress();

  // ── Saved addresses: memory first (optimistic mutations + background refetches repaint), one fetch per focus ──
  const cachedList = useCachedValue<SavedAddress[]>(QC_KEYS.addresses(uid));
  // Fallback for a bypassed query cache (Dev_Kepler_inhibit_QueryCache): the resolved list still paints.
  const [fetchedList, setFetchedList] = useState<SavedAddress[] | undefined>(() => peekAddresses(uid));
  const addresses = cachedList ?? fetchedList;
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const focusedOnceRef = useRef(false);

  const revalidate = useCallback(
    async (force: boolean) => {
      if (!uid) return;
      const seq = ++loadSeqRef.current;
      try {
        const list = await getUserAddresses(uid, { force });
        if (seq !== loadSeqRef.current) return;
        setFetchedList(list);
        setLoadError(null);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        logError("Load addresses", err);
        setLoadError(err instanceof Error ? err.message : "Couldn't load your addresses");
      }
    },
    [uid],
  );

  // One revalidate per focus (P20: the old mount + focus pair fetched twice). The first focus takes the
  // disk-seeded path; every later focus forces the network so an add/edit elsewhere shows up.
  useFocusEffect(
    useCallback(() => {
      const force = focusedOnceRef.current;
      focusedOnceRef.current = true;
      void revalidate(force);
    }, [revalidate]),
  );
  useRefetchOnReconnect(() => {
    void revalidate(true);
  });

  // ── Leaving ──
  const leavingRef = useRef(false);

  const finishWith = useCallback(
    (label: string) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      feedback.toggle(true);
      notify({ id: "delivering-to", title: `Delivering to ${label}`, icon: "map-marker" });
      if (returnTo) router.dismissTo(returnTo);
      else if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/home");
    },
    [returnTo],
  );

  const applyLocation = useCallback(
    (loc: ActiveLocation) => {
      if (!isValidCoords(loc.latitude, loc.longitude)) {
        feedback.error();
        notify({ id: "location-invalid", title: "That place has no map location", tone: "warning" });
        return;
      }
      setLocation(loc);
      finishWith(loc.label);
    },
    [setLocation, finishWith],
  );

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  };

  // ── Saved address pick ──
  const handlePickAddress = (a: SavedAddress) => {
    const coords = addressCoords(a);
    if (!coords) {
      feedback.error();
      notify({
        id: "location-invalid",
        title: "This address has no map location",
        message: "Edit it to pin the spot on the map",
        tone: "warning",
        action: { label: "Edit", onPress: () => router.push({ pathname: "/location/edit", params: { id: a.id } }) },
      });
      return;
    }
    applyLocation({ ...coords, label: a.label, address: a.address, source: "saved" });
  };

  // ── GPS row (the subtitle primes the OS prompt; the hook owns beginNativePrompt and never navigates) ──
  const [gpsAttempt, setGpsAttempt] = useState(0);
  const gpsHandledRef = useRef(0);

  const handleUseCurrentLocation = async () => {
    if (gpsBusy) return;
    // Always re-ask: a permission granted in Settings since the last denial resolves without a dialog; a
    // second denial in a row (the OS shows no dialog once denied) is the cue to open Settings.
    const wasDenied = gpsDenied;
    const result = await requestDeviceAddress();
    if (result) {
      applyLocation({ latitude: result.lat, longitude: result.lng, label: "Current location", address: result.address, source: "manual" });
      return;
    }
    if (wasDenied) {
      Linking.openSettings().catch((err) => logSilentFailure("Open settings", err));
      return;
    }
    setGpsAttempt((n) => n + 1);
  };

  // A null GPS result is either "denied" (inline row state, no toast) or a failed fix (one error + toast).
  // `denied` lands in the same commit as the attempt bump, so the effect reads the settled value.
  useEffect(() => {
    if (gpsAttempt === 0 || gpsHandledRef.current === gpsAttempt) return;
    gpsHandledRef.current = gpsAttempt;
    if (gpsDenied) return;
    feedback.error();
    notify({ id: "gps-error", title: "Couldn't get your location", message: "Try again or pick a saved address", tone: "error" });
  }, [gpsAttempt, gpsDenied]);

  // ── Places search (session token shared by the predictions and the details call that ends them) ──
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<AutocompletePrediction[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState(false);
  const tokenRef = useRef(newPlacesSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const pickingRef = useRef(false);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchSeqRef.current += 1;
    },
    [],
  );

  const runSearch = async (q: string) => {
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const results = await autocomplete(q, tokenRef.current); // never throws ([] on ZERO_RESULTS / failure)
    if (seq !== searchSeqRef.current) return;
    setPredictions(results);
    setSearching(false);
  };

  const handleQueryChange = (t: string) => {
    setQuery(t);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = t.trim();
    if (!q) {
      searchSeqRef.current += 1;
      setPredictions(null);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(q);
    }, SEARCH_DEBOUNCE_MS);
  };

  const clearSearch = () => handleQueryChange("");

  const handlePickPrediction = async (p: AutocompletePrediction) => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    Keyboard.dismiss();
    setPicking(true);
    const label = predictionTitle(p);
    try {
      const details = await placeDetails(p.place_id, tokenRef.current);
      // Per Google's guidance the session ends with a Details call: rotate the token for the next search.
      tokenRef.current = newPlacesSessionToken();
      if (!details) {
        feedback.error();
        notify({ id: "place-error", title: "Couldn't load that place", message: "Pick another result", tone: "error" });
        return;
      }
      applyLocation({
        latitude: details.geometry.location.lat,
        longitude: details.geometry.location.lng,
        label,
        address: details.formatted_address || p.description,
        source: "manual",
      });
    } catch (err) {
      logError("Place details", err);
      feedback.error();
      notify({
        id: "place-error",
        title: "Couldn't load that place",
        message: err instanceof Error ? err.message : undefined,
        tone: "error",
      });
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };

  // ── Derived ──
  const loading = useForceSkeleton(!!uid && addresses === undefined && !loadError);
  const addressCount = addresses ? addresses.length : 0;
  const predictionCount = predictions ? predictions.length : 0;
  const searchMode = query.trim().length > 0;
  const gpsSubtitle = gpsDenied ? "Location permission needed · Open settings" : "Using GPS";

  // ─── Renderers ──────────────────────────────────────────────────────────────

  const renderAddress = ({ item, index }: { item: SavedAddress; index: number }) => {
    const coords = addressCoords(item);
    const selected = isActiveAddress(activeLocation, item, coords);
    const distanceKm =
      !selected && coords && activeLocation
        ? calculateDistance(activeLocation.latitude, activeLocation.longitude, coords.latitude, coords.longitude)
        : null;
    return (
      <AddressRow
        address={item}
        selectable
        selected={selected}
        distanceKm={distanceKm}
        onPress={() => handlePickAddress(item)}
        divider={index < addressCount - 1}
        testID={`address-row-${item.id}`}
      />
    );
  };

  const renderPrediction = ({ item, index }: { item: AutocompletePrediction; index: number }) => (
    <ListRow
      size="lg"
      icon="map-marker-outline"
      iconColor={C.textSub}
      iconBg="transparent"
      title={predictionTitle(item)}
      subtitle={item.structured_formatting?.secondary_text || undefined}
      titleLines={1}
      onPress={() => void handlePickPrediction(item)}
      divider={index < predictionCount - 1}
      disabled={picking}
    />
  );

  const listHeader = (
    <View>
      <View accessibilityLiveRegion="polite">
        <ListRow
          size="lg"
          icon="crosshairs-gps"
          iconColor={C.primary}
          iconBg="transparent"
          title="Use current location"
          subtitle={gpsSubtitle}
          onPress={() => void handleUseCurrentLocation()}
          right={gpsBusy ? <ActivityIndicator size="small" color={C.primary} /> : undefined}
          accessibilityLabel={`Use current location, ${gpsSubtitle}`}
          divider
        />
      </View>
      <ListRow
        size="lg"
        icon="plus"
        iconColor={C.primary}
        iconBg="transparent"
        title="Add new address"
        onPress={() => router.push({ pathname: "/location/select-map", params: { returnTo: addReturnTo } })}
        divider
      />
      <View style={styles.sectionLabelWrap}>
        <SectionLabel>Saved addresses</SectionLabel>
      </View>
    </View>
  );

  const listEmpty = loading ? (
    <SkeletonScreen label="Loading addresses…">
      {SKELETON_ROWS.map((i) => (
        <View key={i} style={[styles.skeletonRow, i < SKELETON_ROWS.length - 1 && styles.skeletonDivider]}>
          <Skeleton width={44} height={44} radius={12} />
          <View style={styles.skeletonCol}>
            <Skeleton width="40%" height={14} style={styles.skeletonTitle} />
            <SkeletonText lines={2} lineHeight={12} gap={6} width="90%" lastLineWidth="60%" />
          </View>
        </View>
      ))}
    </SkeletonScreen>
  ) : loadError && !addresses ? (
    <EmptyState
      icon="cloud-off-outline"
      title="Couldn't load addresses"
      text={loadError}
      action={{ label: "Retry", onPress: () => void revalidate(true) }}
    />
  ) : (
    <EmptyState
      icon="map-marker-plus-outline"
      title="No saved addresses"
      text="Save an address to get your orders delivered faster"
      action={{
        label: "Add address",
        icon: "plus",
        onPress: () => router.push({ pathname: "/location/select-map", params: { returnTo: addReturnTo } }),
      }}
    />
  );

  const searchEmpty = searching ? null : (
    <EmptyState icon="map-search-outline" title="No matching places" text="Try the area, street or a landmark name" />
  );

  return (
    <Screen bg={C.card} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          Select delivery location
        </Text>
        <IconButton icon="close" accessibilityLabel="Close" onPress={close} />
      </View>

      <View style={styles.searchWrap}>
        <Input
          variant="outlined"
          placeholder="Search for area, street…"
          value={query}
          onChangeText={handleQueryChange}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search for an area or street"
          left={<MaterialCommunityIcons name="magnify" size={SEARCH_ICON} color={C.textSub} style={styles.searchIcon} />}
          right={
            searching || picking ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : query.length > 0 ? (
              <IconButton
                icon="close-circle"
                size={CLEAR_BUTTON}
                iconSize={CLEAR_ICON}
                bg="transparent"
                color={C.textLight}
                accessibilityLabel="Clear search"
                onPress={clearSearch}
              />
            ) : null
          }
        />
      </View>

      {searchMode ? (
        <FlatList
          data={predictions ?? []}
          keyExtractor={(p) => p.place_id}
          renderItem={renderPrediction}
          ListEmptyComponent={predictions ? searchEmpty : null}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={addresses ?? []}
          keyExtractor={(a) => a.id}
          renderItem={renderAddress}
          extraData={activeLocation}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
        />
      )}
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: layout.gutter,
    paddingRight: 12,
    paddingVertical: 12,
    gap: 12,
  },
  title: { ...text.screenTitle, flex: 1 },
  searchWrap: { paddingHorizontal: layout.gutter, paddingBottom: 8 },
  searchIcon: { marginRight: 8 },
  sectionLabelWrap: { paddingHorizontal: layout.gutter, paddingTop: 20, paddingBottom: 4 },
  listContent: { paddingBottom: layout.scrollBottom },
  // ListRow-lg twin: ph16 pv16 gap14, 44 px glyph.
  skeletonRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  skeletonDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  skeletonCol: { flex: 1 },
  skeletonTitle: { marginBottom: 8 },
});
