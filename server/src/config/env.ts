import dotenv from 'dotenv';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import logger from '../logger.js';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';
let jwtSecret = process.env.JWT_SECRET;

// Inject secret at runtime using GCP Secret Manager in production environments
if (isProd && process.env.GOOGLE_CLOUD_PROJECT) {
  const client = new SecretManagerServiceClient();
  const name = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/secrets/JWT_SECRET/versions/latest`;
  try {
    const [version] = await client.accessSecretVersion({ name });
    if (version.payload?.data) {
      jwtSecret = version.payload.data.toString();
      logger.info('Successfully injected JWT_SECRET from GCP Secret Manager.');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to load JWT_SECRET from Secret Manager. Falling back to env variable.');
  }
}

const requireEnv = (key: string, value: string | undefined, defaultForDev: string) => {
  if (!value) {
    if (isProd) {
      throw new Error(`CRITICAL: Missing required environment variable in production: ${key}`);
    }
    return defaultForDev;
  }
  return value;
};

export const config = {
  port: process.env.PORT || 8080,
  jwtSecret: requireEnv('JWT_SECRET', jwtSecret, ''),
  googleClientId: requireEnv('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID, ''),
  extensionId: requireEnv('EXTENSION_ID', process.env.EXTENSION_ID, ''),
  polarWebhookSecret: process.env.POLAR_WEBHOOK_SECRET || '',
  polarAccessToken: process.env.POLAR_ACCESS_TOKEN || '',
  polarProProductId: process.env.POLAR_PRO_PRODUCT_ID || '',
  cloudServerUrl: process.env.CLOUDSERVER_URL || `http://localhost:${process.env.PORT || 8080}`,
};

export default config;
