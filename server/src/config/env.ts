import dotenv from 'dotenv';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import pino from 'pino';

dotenv.config();
const logger = pino();

let jwtSecret = process.env.JWT_SECRET || 'gc-audio-secret';

// Inject secret at runtime using GCP Secret Manager in production environments
if (process.env.NODE_ENV === 'production' && process.env.GOOGLE_CLOUD_PROJECT) {
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

export const config = {
  port: process.env.PORT || 8080,
  jwtSecret,
  googleClientId: process.env.GOOGLE_CLIENT_ID || 'gc-audio-client',
  extensionId: process.env.EXTENSION_ID || 'gc-audio-extension',
};
export default config;
