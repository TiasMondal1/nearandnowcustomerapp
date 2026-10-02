import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./apiClient";

/**
 * Live GSTIN check against the GST registry (POST /api/gstin/verify), run once
 * the typed GSTIN passes the offline check. Mirrors the website's
 * frontend/src/hooks/useGstinVerification.ts. 2026-10-02.
 *
 *  - verified     Active on the GST portal; `legalName` is the registered name.
 *  - rejected     cancelled / suspended / not registered — `message` says why.
 *  - unavailable  couldn't check right now. Never blocks the customer: the
 *                 backend re-checks when the order is placed.
 */
export type GstinCheck =
  | { state: "idle" | "checking" | "unavailable" }
  | { state: "verified"; legalName: string; tradeName: string }
  | { state: "rejected"; message: string };

type VerifyResponse = {
  success: boolean;
  result: "active" | "inactive" | "not_found" | "invalid" | "unavailable";
  legal_name: string | null;
  trade_name: string | null;
  message: string | null;
};

const DEBOUNCE_MS = 500;

export function useGstinVerification(gstin: string, enabled: boolean): GstinCheck {
  const [check, setCheck] = useState<GstinCheck>({ state: "idle" });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setCheck({ state: "idle" });
      return;
    }
    setCheck({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<VerifyResponse>("/api/gstin/verify", {
          method: "POST",
          body: JSON.stringify({ gstin }),
        });
        if (requestId !== requestIdRef.current) return;
        if (data?.result === "active") {
          setCheck({ state: "verified", legalName: data.legal_name || "", tradeName: data.trade_name || "" });
        } else if (data?.message) {
          setCheck({ state: "rejected", message: data.message });
        } else {
          setCheck({ state: "unavailable" });
        }
      } catch {
        if (requestId === requestIdRef.current) setCheck({ state: "unavailable" });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [gstin, enabled]);

  return check;
}
