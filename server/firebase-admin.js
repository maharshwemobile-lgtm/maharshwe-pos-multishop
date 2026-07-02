let messagingClient = null;
let initError = null;

function normalizedPrivateKey() {
  return String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
}

function firebaseConfig() {
  return {
    projectId: String(process.env.FIREBASE_PROJECT_ID || '').trim(),
    clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
    privateKey: normalizedPrivateKey(),
  };
}

function isFirebaseAdminConfigured() {
  const config = firebaseConfig();
  return Boolean(config.projectId && config.clientEmail && config.privateKey);
}

function getFirebaseMessaging() {
  if (messagingClient) return messagingClient;
  if (!isFirebaseAdminConfigured()) return null;
  if (initError) return null;

  try {
    const { cert, getApps, initializeApp } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    const config = firebaseConfig();
    const app = getApps().find((item) => item.name === 'mahar-pos-fcm')
      || initializeApp({
        credential: cert({
          projectId: config.projectId,
          clientEmail: config.clientEmail,
          privateKey: config.privateKey,
        }),
      }, 'mahar-pos-fcm');
    messagingClient = getMessaging(app);
    return messagingClient;
  } catch (error) {
    initError = error;
    console.warn('Firebase Admin SDK is not available:', error.message);
    return null;
  }
}

async function sendFcmMessages(messages) {
  const messaging = getFirebaseMessaging();
  if (!messaging) {
    return {
      ok: false,
      skipped: true,
      successCount: 0,
      failureCount: 0,
      responses: [],
      message: isFirebaseAdminConfigured()
        ? 'Firebase Admin SDK could not be initialized'
        : 'Firebase Admin SDK is not configured',
    };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: true, skipped: false, successCount: 0, failureCount: 0, responses: [] };
  }

  const responses = [];
  let successCount = 0;
  let failureCount = 0;

  for (let index = 0; index < messages.length; index += 500) {
    const batch = messages.slice(index, index + 500);
    if (typeof messaging.sendEach === 'function') {
      const result = await messaging.sendEach(batch);
      successCount += result.successCount || 0;
      failureCount += result.failureCount || 0;
      responses.push(...(result.responses || []));
    } else {
      const result = await Promise.all(batch.map((message) => (
        messaging.send(message)
          .then((messageId) => ({ success: true, messageId }))
          .catch((error) => ({ success: false, error }))
      )));
      responses.push(...result);
      successCount += result.filter((item) => item.success).length;
      failureCount += result.filter((item) => !item.success).length;
    }
  }

  return {
    ok: failureCount === 0,
    skipped: false,
    successCount,
    failureCount,
    responses,
  };
}

module.exports = {
  getFirebaseMessaging,
  isFirebaseAdminConfigured,
  sendFcmMessages,
};
