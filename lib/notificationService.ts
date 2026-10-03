// codename: tango
// Notification inbox service (CONTRACTS §2.23, rev. 2 — makes the unread dot right on cold
// start). Lists live in queryCache under QC_KEYS.notifications(userId) (60 s, userScope);
// this module adds the unread counter, local dismissals (PLAN Q6: there is no delete
// endpoint, so dismiss = hide + mark read) and optimistic mark-read with rollback (C40).
import { useSyncExternalStore } from 'react';

import { apiFetch } from './apiClient';
import { logSilentFailure } from './logSilentFailure';
import { cached, invalidate, peek, QC_KEYS, setCached, subscribe } from './queryCache';

/** Shape of GET /api/notifications/users/:id rows. The backend sends the text as `message`; it is normalised into `body` here. */
export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type?: string | null;
  data?: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
};

export type NotificationPreferences = { orderUpdates: boolean };

const NOTIFICATIONS_TTL_MS = 60_000;
/** Only orderUpdates is server-gated today (app/notification-preferences.tsx:17-20); missing = enabled. */
const DEFAULT_PREFERENCES: NotificationPreferences = { orderUpdates: true };

const dismissed = new Set<string>();
let dismissedVersion = 0;
let unread = 0;
let activeUserId: string | null = null;
let unsubscribeActiveList: (() => void) | null = null;
const unreadSubscribers = new Set<() => void>();
const listSubscribers = new Set<() => void>();
let visibleMemo: { source: AppNotification[]; version: number; result: AppNotification[] } | null = null;

// ─── Internals ──────────────────────────────────────────────────────────────

const keyFor = (userId: string) => QC_KEYS.notifications(userId);
const userPath = (userId: string) => `/api/notifications/users/${encodeURIComponent(userId)}`;

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

function normaliseRow(row: unknown): AppNotification | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = asString(r.id);
  if (!id) return null;
  return {
    id,
    title: asString(r.title),
    body: asString(r.body ?? r.message),
    type: typeof r.type === 'string' ? r.type : null,
    data: r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null,
    is_read: r.is_read === true,
    created_at: asString(r.created_at),
  };
}

function normaliseList(raw: unknown): AppNotification[] {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as { notifications?: unknown; data?: unknown; items?: unknown };
    const candidate = obj.notifications ?? obj.data ?? obj.items;
    if (Array.isArray(candidate)) rows = candidate;
  }
  const out: AppNotification[] = [];
  for (const row of rows) {
    const n = normaliseRow(row);
    if (n) out.push(n);
  }
  return out;
}

function emit(subs: Set<() => void>, context: string): void {
  for (const cb of Array.from(subs)) {
    try {
      cb();
    } catch (err) {
      logSilentFailure(context, err);
    }
  }
}

/** Unread = rows with !is_read in the active user's cached list, minus local dismissals. Notifies only on change. */
function recomputeUnread(): void {
  const list = activeUserId ? peek<AppNotification[]>(keyFor(activeUserId)) : undefined;
  let next = 0;
  if (list) {
    for (const n of list) if (!n.is_read && !dismissed.has(n.id)) next += 1;
  }
  if (next !== unread) {
    unread = next;
    emit(unreadSubscribers, 'notifications unread subscriber');
  }
}

function onActiveListChanged(): void {
  recomputeUnread();
  emit(listSubscribers, 'notifications list subscriber');
}

/** Points the counter at `userId`'s list; a different user drops the previous dismissals. */
function setActiveUser(userId: string): void {
  if (activeUserId === userId) return;
  unsubscribeActiveList?.();
  activeUserId = userId;
  dismissed.clear();
  dismissedVersion += 1;
  visibleMemo = null;
  unsubscribeActiveList = subscribe(keyFor(userId), onActiveListChanged);
  recomputeUnread();
}

/** The cached list minus dismissed ids — memoised per (list reference, dismissal version) so it is a stable snapshot. */
function visible(list: AppNotification[]): AppNotification[] {
  if (visibleMemo && visibleMemo.source === list && visibleMemo.version === dismissedVersion) return visibleMemo.result;
  const result = dismissed.size === 0 ? list : list.filter((n) => !dismissed.has(n.id));
  visibleMemo = { source: list, version: dismissedVersion, result };
  return result;
}

function setReadFlags(userId: string, ids: ReadonlySet<string>, isRead: boolean): void {
  const key = keyFor(userId);
  const current = peek<AppNotification[]>(key);
  if (!current) return;
  let changed = false;
  const next = current.map((n) => {
    if (!ids.has(n.id) || n.is_read === isRead) return n;
    changed = true;
    return { ...n, is_read: isRead };
  });
  if (changed) setCached(key, next, { userScope: true });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * `cached(QC_KEYS.notifications(userId), GET /api/notifications/users/:id, 60 s, userScope)`.
 * Two calls within 60 s = one request; `force` skips memory (pull-to-refresh). After the
 * resolve the unread count is recomputed and its subscribers notified. Resolves the list
 * minus locally dismissed ids; rejects with apiFetch's message (memory keeps the last list).
 */
export async function getNotifications(userId: string, opts?: { force?: boolean }): Promise<AppNotification[]> {
  setActiveUser(userId);
  const list = await cached<AppNotification[]>(
    keyFor(userId),
    async () => normaliseList(await apiFetch<unknown>(userPath(userId))),
    { ttlMs: NOTIFICATIONS_TTL_MS, userScope: true, force: opts?.force },
  );
  recomputeUnread();
  return visible(list);
}

/** Sync memory: the last loaded list minus local dismissals (stable reference until either changes); `undefined` before the first load. */
export function peekNotifications(userId: string): AppNotification[] | undefined {
  const list = peek<AppNotification[]>(keyFor(userId));
  return list ? visible(list) : undefined;
}

/** Sync; 0 before the first load and after clearNotificationsMemory(). Unread rows of the active user's last loaded list minus local dismissals. */
export function peekUnreadCount(): number {
  return unread;
}

/** Fires whenever peekUnreadCount() changes. Returns the unsubscribe function. */
export function subscribeUnreadCount(cb: () => void): () => void {
  unreadSubscribers.add(cb);
  return () => {
    unreadSubscribers.delete(cb);
  };
}

/** Fires on every visible-list change (load, mark read, dismiss/restore, logout). Returns the unsubscribe function. */
export function subscribeNotifications(cb: () => void): () => void {
  listSubscribers.add(cb);
  return () => {
    listSubscribers.delete(cb);
  };
}

function getServerUnread(): number {
  return 0;
}

/** useSyncExternalStore over peekUnreadCount() — ProfileMenuProvider / TabHeader read THIS, never screen state, so the dot is right on cold start. */
export function useUnreadCount(): number {
  return useSyncExternalStore(subscribeUnreadCount, peekUnreadCount, getServerUnread);
}

/** Optimistic `is_read: true` in the cached list + PUT /api/notifications/:id/read. On failure the row's flag is restored (only that row) and the error rethrown. */
export async function markRead(userId: string, id: string): Promise<void> {
  setActiveUser(userId);
  const before = peek<AppNotification[]>(keyFor(userId));
  const wasUnread = before?.some((n) => n.id === id && !n.is_read) === true;
  const ids = new Set([id]);
  if (wasUnread) setReadFlags(userId, ids, true);
  try {
    await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PUT' });
  } catch (err) {
    if (wasUnread) setReadFlags(userId, ids, false);
    throw err;
  }
}

/** Optimistic read-all + PUT /api/notifications/users/:id/read-all. On failure every row that was unread before the call is restored and the error rethrown (C40). */
export async function markAllRead(userId: string): Promise<void> {
  setActiveUser(userId);
  const before = peek<AppNotification[]>(keyFor(userId)) ?? [];
  const unreadIds = new Set(before.filter((n) => !n.is_read).map((n) => n.id));
  if (unreadIds.size > 0) setReadFlags(userId, unreadIds, true);
  try {
    await apiFetch(`${userPath(userId)}/read-all`, { method: 'PUT' });
  } catch (err) {
    if (unreadIds.size > 0) setReadFlags(userId, unreadIds, false);
    throw err;
  }
}

/** Hides `id` from every read of this session and drops it from the unread count; also marks it read server-side fire-and-forget (logSilentFailure on failure). Idempotent. */
export function dismissLocally(userId: string, id: string): void {
  setActiveUser(userId);
  if (dismissed.has(id)) return;
  dismissed.add(id);
  dismissedVersion += 1;
  onActiveListChanged();
  const list = peek<AppNotification[]>(keyFor(userId));
  if (list?.some((n) => n.id === id && !n.is_read)) {
    markRead(userId, id).catch((err) => logSilentFailure('Dismiss notification: mark read', err));
  }
}

/** Undo for dismissLocally: the row reappears (already read if the mark-read ping succeeded). */
export function restoreLocally(userId: string, id: string): void {
  setActiveUser(userId);
  if (!dismissed.delete(id)) return;
  dismissedVersion += 1;
  onActiveListChanged();
}

/** GET …/users/:id/preferences → `{ orderUpdates }` (missing/non-boolean = true, the backend's own default). Resolves the default on failure (logged) so the screen never blocks on it. */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  try {
    const data = await apiFetch<Record<string, unknown> | null>(`${userPath(userId)}/preferences`);
    const value = data?.orderUpdates;
    return { orderUpdates: typeof value === 'boolean' ? value : DEFAULT_PREFERENCES.orderUpdates };
  } catch (err) {
    logSilentFailure('Fetch notification preferences', err);
    return { ...DEFAULT_PREFERENCES };
  }
}

/** PUT …/users/:id/preferences with exactly `{ orderUpdates }` (the only server-gated key). Rejects on failure so the toggle can roll back. */
export async function setNotificationPreferences(userId: string, prefs: NotificationPreferences): Promise<void> {
  await apiFetch(`${userPath(userId)}/preferences`, {
    method: 'PUT',
    body: JSON.stringify({ orderUpdates: prefs.orderUpdates === true }),
  });
}

/** AuthContext.clearStoredSession(): unread → 0, every `notifications:*` list dropped, dismissals cleared, all subscribers notified. */
export function clearNotificationsMemory(): void {
  unsubscribeActiveList?.();
  unsubscribeActiveList = null;
  activeUserId = null;
  dismissed.clear();
  dismissedVersion += 1;
  visibleMemo = null;
  invalidate('notifications:');
  if (unread !== 0) {
    unread = 0;
    emit(unreadSubscribers, 'notifications unread subscriber');
  }
  emit(listSubscribers, 'notifications list subscriber');
}
