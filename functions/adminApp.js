const admin = require('firebase-admin');

function parseServiceAccountFromEnv() {
  const candidates = [
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    process.env.GCP_SERVICE_ACCOUNT_JSON,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const rawValue of candidates) {
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === 'object' && parsed.project_id && parsed.client_email && parsed.private_key) {
        return parsed;
      }
    } catch (error) {
      console.error('Failed to parse service account JSON from env:', error);
    }
  }

  return null;
}

function getCustomTokenServiceAccountId() {
  const candidates = [
    process.env.GPMARKET_CUSTOM_TOKEN_SERVICE_ACCOUNT_ID,
    process.env.FIREBASE_SERVICE_ACCOUNT_ID,
    process.env.GOOGLE_SERVICE_ACCOUNT_ID,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return candidates[0] || '';
}

let adminInitializationInfo = null;

function initializeAdminApp() {
  if (admin.apps.length) {
    adminInitializationInfo = adminInitializationInfo || {
      mode: 'reused',
      emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR),
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '',
    };
    return admin.app();
  }

  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR);
  const serviceAccount = parseServiceAccountFromEnv();
  const customTokenServiceAccountId = getCustomTokenServiceAccountId();
  const initOptions = {};
  let mode = 'default';

  if (isEmulator) {
    mode = 'emulator';
  } else if (serviceAccount) {
    initOptions.credential = admin.credential.cert(serviceAccount);
    mode = 'service-account-env';
  }

  const configuredStorageBucket = String(
    process.env.GPMARKET_STORAGE_BUCKET
      || process.env.STORAGE_BUCKET
      || process.env.FIREBASE_STORAGE_BUCKET
      || '',
  ).trim();

  if (configuredStorageBucket) {
    initOptions.storageBucket = configuredStorageBucket;
  }

  if (!isEmulator && customTokenServiceAccountId) {
    initOptions.serviceAccountId = customTokenServiceAccountId;
  }

  const app = Object.keys(initOptions).length > 0
    ? admin.initializeApp(initOptions)
    : admin.initializeApp();

  adminInitializationInfo = {
    mode,
    emulator: isEmulator,
    projectId:
      serviceAccount?.project_id
      || process.env.GCLOUD_PROJECT
      || process.env.GCP_PROJECT
      || app.options.projectId
      || '',
    hasServiceAccountEnv: Boolean(serviceAccount),
    customTokenServiceAccountId: customTokenServiceAccountId || '',
    emulatorHost: String(process.env.FIRESTORE_EMULATOR_HOST || '').trim(),
  };

  console.info('Firebase Admin initialized:', adminInitializationInfo);
  return app;
}

const app = initializeAdminApp();
const db = admin.firestore(app);

module.exports = {
  admin,
  app,
  db,
  initializeAdminApp,
  getAdminInitializationInfo: () => adminInitializationInfo,
};
