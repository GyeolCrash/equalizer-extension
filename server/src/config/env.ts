import dotenv from 'dotenv';
import logger from '../logger.js';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

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
  jwtSecret: requireEnv('JWT_SECRET', process.env.JWT_SECRET, ''),
  googleClientId: requireEnv('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID, ''),
  extensionId: requireEnv('EXTENSION_ID', process.env.EXTENSION_ID, ''),
  polarWebhookSecret: process.env.POLAR_WEBHOOK_SECRET || '',
  polarAccessToken: process.env.POLAR_ACCESS_TOKEN || '',
  polarProProductId: process.env.POLAR_PRO_PRODUCT_ID || '',
  cloudServerUrl: process.env.CLOUDSERVER_URL || `http://localhost:${process.env.PORT || 8080}`,
};

export default config;
