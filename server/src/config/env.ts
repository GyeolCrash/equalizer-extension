const isDeno = typeof (globalThis as any).Deno !== 'undefined';

/**
 * Runtime-agnostic environment variable accessor.
 * Reads from Deno.env in Edge Function context, process.env in Node.js.
 */
export const getEnv = (key: string): string => {
  if (isDeno) {
    return (globalThis as any).Deno.env.get(key) || '';
  }
  return process.env[key] || '';
};

// Load .env file in Node.js only — Deno reads from Deno.env directly
if (!isDeno) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config();
}

const isProd = getEnv('NODE_ENV') === 'production';

const requireEnv = (key: string, defaultForDev: string = '') => {
  const value = getEnv(key);
  if (!value) {
    if (isProd) {
      throw new Error(`CRITICAL: Missing required environment variable in production: ${key}`);
    }
    return defaultForDev;
  }
  return value;
};

export const config = {
  port: getEnv('PORT') || '8080',
  jwtSecret: requireEnv('JWT_SECRET'),
  extensionId: requireEnv('EXTENSION_ID'),
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  polarWebhookSecret: getEnv('POLAR_WEBHOOK_SECRET'),
  polarAccessToken: getEnv('POLAR_ACCESS_TOKEN'),
  polarProProductId: getEnv('POLAR_PRO_PRODUCT_ID'),
  cloudServerUrl: getEnv('CLOUDSERVER_URL') || `http://localhost:${getEnv('PORT') || '8080'}`,
  isProd,
};

export default config;
