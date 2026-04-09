import dotenv from 'dotenv';

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
  extensionId: requireEnv('EXTENSION_ID', process.env.EXTENSION_ID, ''),
  supabaseUrl: requireEnv('SUPABASE_URL', process.env.SUPABASE_URL, ''),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY, ''),
  polarWebhookSecret: process.env.POLAR_WEBHOOK_SECRET || '',
  polarAccessToken: process.env.POLAR_ACCESS_TOKEN || '',
  polarProProductId: process.env.POLAR_PRO_PRODUCT_ID || '',
  cloudServerUrl: process.env.CLOUDSERVER_URL || `http://localhost:${process.env.PORT || 8080}`,
};

export default config;
