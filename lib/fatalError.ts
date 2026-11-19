/**
 * The last uncaught (fatal) JS error of this session — a tiny module store.
 *
 * Written by the global error handler in app/_layout.tsx, read by components/ErrorBoundary.tsx, which puts
 * the full-screen "Something went wrong" state over the app while it is set. In a release build React Native
 * answers a fatal JS error by destroying the React host; with nothing rethrowing natively the Activity stays
 * alive showing only the window background until the task is cleared from recents. The handler stops that
 * teardown, and this store is what makes the failure visible and recoverable instead of silent.
 *
 * No imports beyond React on purpose: it is loaded by the error boundary, which must survive an import-time
 * crash anywhere else (CONTRACTS §4.17 rev. 2).
 */
import { useSyncExternalStore } from 'react';

export type FatalError = {
  /** The error's message, for the fallback's detail line. */
  message: string;
  /** ms epoch of the report. */
  at: number;
};

let current: FatalError | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of Array.from(subscribers)) {
    try {
      cb();
    } catch {
      // A subscriber throwing inside the crash path must never mask the original error.
    }
  }
}

/** Records an uncaught error and raises the fallback. A later error replaces the earlier one. Never throws. */
export function reportFatalError(error: unknown): void {
  let message = 'Unknown error';
  try {
    message = (error instanceof Error ? error.message : String(error)) || message;
  } catch {
    // An exotic thrown value whose conversion throws — keep the neutral message.
  }
  current = { message, at: Date.now() };
  notify();
}

/** Dismisses the fallback (the user chose to carry on, or a restart could not be performed). */
export function clearFatalError(): void {
  if (!current) return;
  current = null;
  notify();
}

/** Sync read. */
export function getFatalError(): FatalError | null {
  return current;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** `useSyncExternalStore` over the store: the current fatal error, or `null`. */
export function useFatalError(): FatalError | null {
  return useSyncExternalStore(subscribe, getFatalError, getFatalError);
}
