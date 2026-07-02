import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { apiFetch } from './phase2Api';

const TOKEN_STORAGE_KEY = 'mahar_pos_fcm_token_v1';

const env = import.meta.env || {};

const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAK8Kcd7J5dShAqn2QlJmAZFeJRVg1mfOw',
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'maharshweonlinevpn.firebaseapp.com',
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'maharshweonlinevpn',
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'maharshweonlinevpn.firebasestorage.app',
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '648689584934',
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:648689584934:web:47f1ee30f86090fb32cfe7',
  measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-DW2DHE0211',
};

const vapidKey = env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || 'dk9KEJT2QTTOwbA3o4s55sNMeqPZEGcPJUaRS6dUYyw';

let supportPromise = null;
let messagingPromise = null;
let workerPromise = null;

function browserName() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Browser';
}

function isSecureBrowserContext() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function hasPublicConfig() {
  return Boolean(
    firebaseConfig.apiKey
      && firebaseConfig.authDomain
      && firebaseConfig.projectId
      && firebaseConfig.messagingSenderId
      && firebaseConfig.appId
      && vapidKey,
  );
}

export async function getPushSupportStatus() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, permission: 'unsupported', reason: 'browser_unavailable', publicConfig: hasPublicConfig() };
  }
  if (!('Notification' in window)) {
    return { supported: false, permission: 'unsupported', reason: 'notifications_unavailable', publicConfig: hasPublicConfig() };
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, permission: Notification.permission, reason: 'service_worker_unavailable', publicConfig: hasPublicConfig() };
  }
  if (!isSecureBrowserContext()) {
    return { supported: false, permission: Notification.permission, reason: 'secure_context_required', publicConfig: hasPublicConfig() };
  }
  if (!hasPublicConfig()) {
    return { supported: false, permission: Notification.permission, reason: 'firebase_public_config_missing', publicConfig: false };
  }
  supportPromise ||= isSupported().catch(() => false);
  const supported = await supportPromise;
  return {
    supported,
    permission: Notification.permission,
    reason: supported ? null : 'firebase_messaging_not_supported',
    publicConfig: true,
  };
}

async function firebaseMessaging() {
  if (messagingPromise) return messagingPromise;
  messagingPromise = (async () => {
    const status = await getPushSupportStatus();
    if (!status.supported) return null;
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return getMessaging(app);
  })();
  return messagingPromise;
}

async function serviceWorkerRegistration() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    await registration.update().catch(() => {});
    return registration;
  })().catch((error) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

function saveToken(token) {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore private browsing storage restrictions.
  }
}

function readSavedToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export async function requestAndRegisterPushToken() {
  const status = await getPushSupportStatus();
  if (!status.supported) return { ok: false, ...status };
  if (Notification.permission === 'denied') {
    return { ok: false, supported: true, permission: 'denied', reason: 'permission_denied' };
  }

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, supported: true, permission, reason: 'permission_not_granted' };
  }

  const messaging = await firebaseMessaging();
  const registration = await serviceWorkerRegistration();
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return { ok: false, supported: true, permission, reason: 'token_unavailable' };

  const response = await apiFetch('/api/push/tokens', {
    method: 'POST',
    body: {
      token,
      platform: 'web',
      browser: browserName(),
    },
  });
  saveToken(token);
  return { ok: true, supported: true, permission, token, server: response };
}

export async function deactivateSavedPushToken() {
  const token = readSavedToken();
  if (!token) return { ok: true, deactivated: 0 };
  const response = await apiFetch('/api/push/tokens/deactivate', {
    method: 'POST',
    body: { token },
  });
  saveToken('');
  return response;
}

export async function refreshRegisteredPushToken() {
  const status = await getPushSupportStatus();
  if (!status.supported || status.permission !== 'granted') return { ok: false, ...status };
  return requestAndRegisterPushToken();
}

export function subscribeForegroundMessages(callback) {
  let unsubscribe = () => {};
  let active = true;
  firebaseMessaging()
    .then((messaging) => {
      if (!messaging || !active) return;
      unsubscribe = onMessage(messaging, (payload) => {
        const message = {
          title: payload?.notification?.title || payload?.data?.title || 'Mahar POS',
          body: payload?.notification?.body || payload?.data?.body || 'Open Mahar POS to review.',
          url: payload?.data?.url || '/',
          eventType: payload?.data?.eventType || 'APP_NOTIFICATION',
          raw: payload,
        };
        callback?.(message);
        window.dispatchEvent(new CustomEvent('mahar-push-message', { detail: message }));
      });
    })
    .catch((error) => console.warn('FCM foreground message listener skipped:', error.message));

  const workerHandler = (event) => {
    if (event?.data?.type !== 'MAHAR_PUSH_OPEN') return;
    const url = event.data.url || '/';
    if (/^https?:\/\//i.test(url)) window.location.href = url;
    else window.location.href = url;
  };
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', workerHandler);
  }

  return () => {
    active = false;
    unsubscribe();
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.removeEventListener('message', workerHandler);
    }
  };
}
