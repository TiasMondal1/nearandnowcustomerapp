/**
 * Tracks whether a real native permission dialog (push notifications,
 * location, ...) may currently be on screen, so a JS-driven navigation
 * transition can wait it out instead of firing blind.
 *
 * Why this exists: right after OTP verification succeeds, `userId` flips
 * from null to real in the same render pass that navigates /otp -> /welcome.
 * That flip arms two independent effects — usePushNotifications.dev.ts's
 * push-permission request and (tabs)/home.tsx's location-permission
 * request — each deferred via InteractionManager so it doesn't fire mid-
 * transition. On a clean install, both permissions are still undetermined,
 * so both show a real, slow (100ms-2s+) native dialog; on any later app
 * open they're already decided and resolve instantly with no dialog. Only
 * on that clean-install path can either dialog still be up when
 * welcome.tsx's own unconditional 2s auto-advance timer fires a *second*
 * transition (welcome -> home) — a native OS dialog racing a JS-driven
 * screen transition is a known hard-crash class (kills the process below
 * the JS layer, so ErrorBoundary never sees it). Found + root-caused
 * 2026-09-09, see bug_fixes_2026-07-23.md.
 *
 * Session-lifetime, in-memory only — not persisted, nothing here needs to
 * survive a reload.
 */
let pendingCount = 0;

/** Call when a native permission request is about to run; call the returned function once it settles (success, failure, or the dialog is dismissed either way). */
export function beginNativePrompt(): () => void {
  pendingCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingCount = Math.max(0, pendingCount - 1);
  };
}

export function isNativePromptPending(): boolean {
  return pendingCount > 0;
}
