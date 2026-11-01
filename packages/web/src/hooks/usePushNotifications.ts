import { useEffect, useCallback, useRef, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useAuthStore } from '@festie/shared/stores/authStore';

type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';
type UnsupportedReason = 'browser' | 'ios-needs-install' | 'not-configured' | null;

export interface UsePushNotificationsReturn {
  isSupported: boolean;
  /** True until the hook knows whether push is supported (the VAPID key request is in flight). */
  checking: boolean;
  /** The VAPID key request failed for a reason other than 404 (offline, 5xx, 429). `retry` tries again. */
  keyError: boolean;
  retry: () => void;
  subscribed: boolean;
  unsupportedReason: UnsupportedReason;
  permission: NotificationPermission | 'default';
  permissionState: PushPermissionState;
  requestPermission: () => Promise<NotificationPermission | 'default' | null>;
  registerToken: () => Promise<void>;
  unregisterToken: () => Promise<void>;
}

let _currentToken: string | null = null;
// undefined = not fetched yet, null = server has no VAPID keys.
let _vapidKey: string | null | undefined;

/**
 * Fetch the server's VAPID public key once per page. Resolves null when web push is not set up (404).
 * Rejects on any other failure, which is not cached, so a retry can succeed.
 */
async function loadVapidKey(): Promise<string | null> {
  if (_vapidKey !== undefined) return _vapidKey;
  try {
    const { publicKey } = await api.get<{ publicKey: string }>('/notifications/vapid-key');
    _vapidKey = publicKey; // eslint-disable-line require-atomic-updates -- module-level cache, not a real race
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err;
    _vapidKey = null; // eslint-disable-line require-atomic-updates
  }
  return _vapidKey;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  let raw = '';
  for (const byte of new Uint8Array(buf)) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function subscribeWithKey(registration: ServiceWorkerRegistration, key: string) {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as Uint8Array<ArrayBuffer>,
  });
}

async function postToken(subscription: PushSubscription): Promise<void> {
  const token = JSON.stringify(subscription);
  if (token === _currentToken) return;
  await api.post<void>('/notifications/token', { token, platform: 'web' });
  _currentToken = token; // eslint-disable-line require-atomic-updates -- module-level flag, not a real race
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [checking, setChecking] = useState(true);
  const [keyError, setKeyError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const [subscribed, setSubscribed] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<UnsupportedReason>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'default'>('default');
  const user = useAuthStore((state) => state.user);

  const permissionState: PushPermissionState = !isSupported
    ? 'unsupported'
    : (permission as PushPermissionState);

  useEffect(() => {
    // iOS Safari quirk: `PushManager` exists in regular tabs since iOS 16.4,
    // but `subscribe()` only works when the PWA is launched from the Home
    // Screen (standalone mode). We distinguish three states:
    //   1. No push APIs → reason='browser' (truly unsupported)
    //   2. iOS Safari tab → reason='ios-needs-install' (prompt Add to Home)
    //   3. Standalone PWA or non-iOS browser with APIs → supported=true
    const hasApis =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    // iPadOS 13+ reports as Mac; ontouchend presence disambiguates.
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
    const isStandalone =
      (typeof navigator !== 'undefined' && (navigator as unknown as { standalone?: boolean }).standalone === true) ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(display-mode: standalone)').matches === true);

    if (!hasApis) {
      setIsSupported(false);
      setUnsupportedReason('browser');
      setChecking(false);
      return;
    }
    if (isIOS && !isStandalone) {
      setIsSupported(false);
      setUnsupportedReason('ios-needs-install');
      setChecking(false);
      return;
    }
    setPermission(Notification.permission);
    setChecking(true);
    setKeyError(false);

    let cancelled = false;
    (async () => {
      let key: string | null;
      try {
        key = await loadVapidKey();
      } catch (err) {
        if (cancelled) return;
        console.warn('Could not load the web push key', err);
        setKeyError(true);
        setChecking(false);
        return;
      }
      if (cancelled) return;
      setChecking(false);
      if (!key) {
        setIsSupported(false);
        setUnsupportedReason('not-configured');
        return;
      }
      setIsSupported(true);
      setUnsupportedReason(null);
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!cancelled) setSubscribed(existing !== null);
    })().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const requestPermission = useCallback(async (): Promise<
    NotificationPermission | 'default' | null
  > => {
    if (!isSupported || !('Notification' in window)) {
      return null;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return null;
    }
  }, [isSupported]);

  const registerToken = useCallback(async (): Promise<void> => {
    if (!isSupported) return;
    const key = await loadVapidKey();
    if (!key) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await subscribeWithKey(registration, key);
    await postToken(subscription);
    setSubscribed(true);
  }, [isSupported]);

  const unregisterToken = useCallback(async (): Promise<void> => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setSubscribed(false);
      return;
    }

    try {
      await api.delete<void>('/notifications/token', { body: { token: JSON.stringify(subscription) } });
    } catch {
      // Swallow — server may have already removed the token
    }

    await subscription.unsubscribe();
    _currentToken = null;
    setSubscribed(false);
  }, []);

  // Auto-register when permission is already granted and user is logged in.
  // Guest guard: `user !== null` must be checked FIRST — without this the
  // effect would POST /notifications/token with no session cookie, which the
  // server rejects as 400 "Invalid push token" / 429 "Too many token
  // registrations" on every guest page load and popped a red toast that
  // guests have no way to action.
  // It only re-posts an EXISTING subscription and never creates one, so a user
  // who pressed Disable stays off.
  useEffect(() => {
    if (
      user === null ||
      !isSupported ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }
    (async () => {
      const key = await loadVapidKey();
      if (!key) return;
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      const current = subscription.options?.applicationServerKey;
      if (current && bufferToBase64Url(current) !== key.replace(/=+$/, '')) {
        // Subscribed under an older VAPID key: move to the current one.
        await subscription.unsubscribe();
        subscription = await subscribeWithKey(registration, key);
      }
      await postToken(subscription);
      setSubscribed(true);
    })().catch((err) => {
      // Swallow silently — the auto-register path is best-effort and
      // firing a red toast for a background registration failure the
      // user never initiated is more confusing than helpful.
      console.error(err);
    });
  }, [isSupported, user]);

  // Clean up on logout. Always drop the browser subscription, even when the
  // DELETE fails: the session is gone, and a shared computer must stop getting
  // the last user's pushes. The server prunes the dead token on its next send.
  const hadUser = useRef(false);
  useEffect(() => {
    const loggedOut = !user && hadUser.current;
    hadUser.current = user !== null;
    if (!loggedOut || !('serviceWorker' in navigator)) return;
    (async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager?.getSubscription();
      if (!subscription) return;
      await api.delete<void>('/notifications/token', { body: { token: JSON.stringify(subscription) } }).catch(() => {});
      await subscription.unsubscribe();
      _currentToken = null;
      setSubscribed(false);
    })().catch(console.error);
  }, [user]);

  return {
    isSupported,
    checking,
    keyError,
    retry,
    subscribed,
    unsupportedReason,
    permission,
    permissionState,
    requestPermission,
    registerToken,
    unregisterToken,
  };
}
