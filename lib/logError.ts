import * as Sentry from '@sentry/react-native';

import { isTransportError } from './apiClient';

/**
 * Single entry point for logging an error that's already surfaced to the
 * user (an error state, a retry banner, etc.) — as opposed to a
 * fire-and-forget failure, which should use logSilentFailure instead.
 * Consolidates ~25 previously-scattered raw console.error/console.warn call
 * sites, each the only record of its failure and invisible on a real
 * device with no structured error tracking. This one call site is where the
 * crash-reporting integration hooks in, instead of needing to touch every
 * call site individually.
 *
 * Sentry hook (DECISIONS D7, 2026-10-03): every call is also
 * `Sentry.captureException`'d with a `context` tag so the dashboard groups
 * by call site. `Sentry.init` lives in app/_layout.tsx (never here); before
 * init, and on web / Expo Go, the SDK methods are no-ops — the try/catch is
 * belt-and-braces so a logging call can never throw into the caller's own
 * error path.
 */
export function logError(context: string, err: unknown): void {
  console.error(`[error] ${context}:`, err);
  // apiFetch already reported a failed response (lib/reportHandled.ts), and
  // offline / timeout / session-expired are expected; don't send them twice.
  if (isTransportError(err)) return;
  try {
    // "warning" → Sentry priority Medium: recorded and grouped by context, no
    // alert email. The user already saw an error state; crashes still email.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      level: 'warning',
      tags: { context },
    });
  } catch {
    // Sentry not initialised / native module unavailable — the console line above is the record.
  }
}
