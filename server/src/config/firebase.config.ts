import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Initialize the Firebase Admin SDK using App Default Credentials (ADC).
 * This ensures compatibility with Google Cloud Run environment.
 * The 'db' instance is exported as a singleton module.
 */

// If credentials should be loaded from a file (e.g. for local testing), use standard ADC mechanism.
// Google Cloud Run automatically handles ADC if identity is delegated to a service account.
const app = getApps().length === 0 ? initializeApp() : getApp();

export const db = getFirestore(app);