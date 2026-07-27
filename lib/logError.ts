/**
 * Single entry point for logging an error that's already surfaced to the
 * user (an error state, a retry banner, etc.) — as opposed to a
 * fire-and-forget failure, which should use logSilentFailure instead.
 * Consolidates ~25 previously-scattered raw console.error/console.warn call
 * sites, each the only record of its failure and invisible on a real
 * device with no structured error tracking. This one call site is where a
 * future crash-reporting integration (Sentry/Bugsnag/etc.) would hook in,
 * instead of needing to touch every call site individually.
 */
export function logError(context: string, err: unknown): void {
  console.error(`[error] ${context}:`, err);
}
