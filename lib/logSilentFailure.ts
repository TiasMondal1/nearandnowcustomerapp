import * as Sentry from '@sentry/react-native';

/**
 * Logs a fire-and-forget best-effort operation's failure instead of
 * silently swallowing it. These operations are intentionally non-blocking —
 * a cache write or a "mark as read" ping failing shouldn't interrupt the
 * user-facing flow — but a bare `.catch(() => {})` made a real, recurring
 * failure (AsyncStorage full, a cache endpoint silently broken, a stale
 * write racing a logout) completely invisible in production. This doesn't
 * change behavior — callers still fire-and-forget — it just makes the
 * failure show up in logs instead of vanishing.
 *
 * Sentry hook (DECISIONS D7, 2026-10-03): recorded as a `silent-failure`
 * breadcrumb (level `warning`, `message` = the context, `data.message` = the
 * error text) rather than an event, so it attaches to the NEXT captured
 * error as a trail without creating noise of its own. `Sentry.init` lives in
 * app/_layout.tsx; before init the SDK call is a no-op and the try/catch
 * guarantees this helper never throws.
 */
export function logSilentFailure(context: string, err: unknown): void {
  console.warn(`[non-fatal] ${context} failed:`, err);
  try {
    Sentry.addBreadcrumb({
      category: 'silent-failure',
      message: context,
      level: 'warning',
      data: { message: err instanceof Error ? err.message : String(err) },
    });
  } catch {
    // Sentry not initialised / native module unavailable — the console line above is the record.
  }
}
