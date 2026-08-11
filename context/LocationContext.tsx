import AsyncStorage from "@react-native-async-storage/async-storage";
import { logSilentFailure } from "../lib/logSilentFailure";
import React, {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { useAuth } from "./AuthContext";

const LOCATION_STORAGE_KEY = "nn_active_location";

export type LocationSource = "profile" | "saved" | "manual";

export type ActiveLocation = {
  latitude: number;
  longitude: number;
  label: string;
  address?: string;
  source: LocationSource;
};

type LocationContextType = {
  location: ActiveLocation | null;
  isHydrated: boolean;
  setLocation: (loc: ActiveLocation) => void;
  clearLocation: () => void;
};

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocationState] = useState<ActiveLocation | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LOCATION_STORAGE_KEY);
        if (saved) setLocationState(JSON.parse(saved));
      } catch {}
      setIsHydrated(true);
    })();
  }, []);

  const setLocation = useCallback((loc: ActiveLocation) => {
    setLocationState(loc);
    AsyncStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(loc)).catch((err) =>
      logSilentFailure("Persist active location", err),
    );
  }, []);

  const clearLocation = useCallback(() => {
    setLocationState(null);
    AsyncStorage.removeItem(LOCATION_STORAGE_KEY).catch((err) =>
      logSilentFailure("Clear persisted location", err),
    );
  }, []);

  // Clears the selected location on a genuine logout (true -> false
  // transition only, not on initial mount while auth is still restoring) —
  // otherwise a shared/reused device keeps showing the previous customer's
  // last-picked delivery location to whoever logs in next, same class of
  // bug already fixed for the cart. LocationProvider is rendered inside
  // AuthProvider (see app/_layout.tsx), so this is safe with no
  // circular-dependency issue.
  const { isAuthenticated } = useAuth();
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
    } else if (wasAuthenticatedRef.current) {
      wasAuthenticatedRef.current = false;
      clearLocation();
    }
  }, [isAuthenticated, clearLocation]);

  return (
    <LocationContext.Provider value={{ location, isHydrated, setLocation, clearLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used inside LocationProvider");
  return ctx;
}
