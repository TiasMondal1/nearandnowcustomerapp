import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

export type LocationSource = "profile" | "saved" | "manual";

export type ActiveLocation = {
  latitude: number;
  longitude: number;
  label: string; ///gpt5 code -> const fix ( couldnt fix it on prod )
  address?: string;
  source: LocationSource;
};

type LocationContextType = {
  location: ActiveLocation | null;
  setLocation: (loc: ActiveLocation) => void;
  clearLocation: () => void;
};

const LocationContext = createContext<LocationContextType | undefined>(
  undefined,
);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocationState] = useState<ActiveLocation | null>(null);

  const setLocation = useCallback((loc: ActiveLocation) => {
    setLocationState(loc);
  }, []);

  const clearLocation = useCallback(() => {
    setLocationState(null);
  }, []);

  return (
    <LocationContext.Provider
      value={{
        location,
        setLocation,
        clearLocation,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error("useLocation must be used inside LocationProvider");
  }
  return ctx;
}
