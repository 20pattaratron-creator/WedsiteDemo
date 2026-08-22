// Firebase configuration is read from Vite environment variables.
// Keep real values in .env.local (development) or Vercel Environment Variables.

const requiredConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const missingFirebaseEnv = Object.entries(requiredConfig)
  .filter(([, value]) => !String(value || "").trim())
  .map(([key]) => key);

if (missingFirebaseEnv.length > 0) {
  throw new Error(
    `Firebase configuration is incomplete: ${missingFirebaseEnv.join(", ")}. ` +
    "Set the matching VITE_FIREBASE_* variables in .env.local or Vercel."
  );
}

export const firebaseConfig = Object.freeze({
  ...requiredConfig,
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID }
    : {})
});
