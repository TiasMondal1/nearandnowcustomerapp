/**
 * Lightweight "has this user ever placed an order?" flag.
 *
 * This exists so the payment-options screen can decide whether to even
 * attempt the `getSavedPaymentMethods` network call:
 *
 *   • Brand-new user (no orders yet) → skip the fetch entirely, render an
 *     empty "Preferred Payment" card instantly. No hang, no skeleton that
 *     never resolves. Matches the UX the user asked for: "before that it
 *     will be blank".
 *
 *   • Returning user (has placed ≥1 order) → fire the fetch (still timeout-
 *     guarded in `razorpayService`) and show a skeleton while we wait.
 *
 * Persisted in AsyncStorage under `nn:hasPlacedOrder` and mirrored in a
 * module-level cache so synchronous reads (on mount) don't flicker.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'nn:hasPlacedOrder';

/**
 * null  = we haven't checked AsyncStorage yet this session
 * true  = user has at least one successful order (or we explicitly marked it)
 * false = we've checked and there are no orders
 */
let cached: boolean | null = null;

/** Synchronous read. Returns null on first call before any async load. */
export function getCachedOrderHistoryFlag(): boolean | null {
  return cached;
}

/** Hydrates the cache from AsyncStorage. Idempotent — safe to call repeatedly. */
export async function loadOrderHistoryFlag(): Promise<boolean> {
  if (cached != null) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cached = raw === 'true';
  } catch {
    // AsyncStorage very rarely fails; treat any error as "no history yet"
    // so we fall through to the safe empty state instead of hanging.
    cached = false;
  }
  return cached;
}

/**
 * Marks the flag as set. Call this from any path where we're confident the
 * user has completed an order end-to-end (COD placed, or online payment
 * verified/reconciled to paid).
 *
 * It's fine to call this more than once — AsyncStorage write is cheap and
 * the cache guards against redundant round-trips.
 */
export async function markOrderPlaced(): Promise<void> {
  if (cached === true) return;
  cached = true;
  try {
    await AsyncStorage.setItem(KEY, 'true');
  } catch {
    // Non-fatal — cache is still updated for this session. Worst case the
    // flag resets on next cold start and the user sees the empty state
    // once more, which is the correct fallback.
  }
}

/** Testing / sign-out helper. Not wired to the auth flow yet. */
export async function clearOrderHistoryFlag(): Promise<void> {
  cached = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
