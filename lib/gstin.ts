/**
 * GSTIN (Indian GST registration number) validation — offline, no API.
 *
 * Shape: 2-digit state code, 10-char PAN, entity number, literal 'Z', and a
 * check character. The 15th character is a checksum over the first 14, so
 * most single-character typos are caught here for free — before any paid
 * registry lookup (the planned Cashfree verification) is spent on them.
 * (GST finding G4, 2026-10-02.) Mirrored word-for-word in
 * frontend/src/utils/gstin.ts, admin/src/utils/gstin.ts,
 * nearandnowcustomerapp/lib/gstin.ts and near-now-store_owner/lib/gstin.ts —
 * keep all five identical (frontend/src/utils/gstin.test.ts checks the
 * website and admin copies).
 *
 * This proves a number is *well-formed*, not that it's registered or active;
 * that needs the registry lookup.
 */

export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Uppercase and strip spaces — people paste "22 AAAAA 0000 A1Z5". */
export function normalizeGstin(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, '').toUpperCase();
}

/** The check character for the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export type GstinProblem = 'incomplete' | 'format' | 'checksum';

/** What's wrong with a GSTIN, or null if it's well-formed. */
export function gstinProblem(raw: string): GstinProblem | null {
  const g = normalizeGstin(raw);
  if (g.length < 15) return 'incomplete';
  if (!GSTIN_FORMAT.test(g)) return 'format';
  if (gstinCheckChar(g) !== g[14]) return 'checksum';
  return null;
}

export function isValidGstin(raw: string): boolean {
  return gstinProblem(raw) === null;
}

/** A well-formed example for hints (the old example, 22AAAAA0000A1Z5, failed the checksum). */
export const GSTIN_EXAMPLE = '22AAAAA0000A1ZC';

/** User-facing explanation of what's wrong, or null if the GSTIN is well-formed. */
export function gstinHint(raw: string): string | null {
  const problem = gstinProblem(raw);
  if (problem === 'incomplete') {
    const missing = 15 - normalizeGstin(raw).length;
    return `${missing} more character${missing === 1 ? '' : 's'} needed`;
  }
  if (problem === 'format') return `Doesn't match the GSTIN format (e.g. ${GSTIN_EXAMPLE})`;
  if (problem === 'checksum') return "This GSTIN looks mistyped — its last character doesn't match the rest. Please check it.";
  return null;
}
