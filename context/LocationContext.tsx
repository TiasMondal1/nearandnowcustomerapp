import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";

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
    AsyncStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(loc)).catch(() => {});
  }, []);

  const clearLocation = useCallback(() => {
    setLocationState(null);
    AsyncStorage.removeItem(LOCATION_STORAGE_KEY).catch(() => {});
  }, []);

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
