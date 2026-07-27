/**
 * Logs a fire-and-forget best-effort operation's failure instead of
 * silently swallowing it. These operations are intentionally non-blocking —
 * a cache write or a "mark as read" ping failing shouldn't interrupt the
 * user-facing flow — but a bare `.catch(() => {})` made a real, recurring
 * failure (AsyncStorage full, a cache endpoint silently broken, a stale
 * write racing a logout) completely invisible in production. This doesn't
 * change behavior — callers still fire-and-forget — it just makes the
 * failure show up in logs instead of vanishing.
 */
export function logSilentFailure(context: string, err: unknown): void {
  console.warn(`[non-fatal] ${context} failed:`, err);
}
