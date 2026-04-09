/**
 * Supabase Edge Function entry point (Deno runtime).
 * Deploy path: supabase/functions/main/index.ts (symlink or copy this file)
 *
 * Shared business logic (UserDAO, AuthService, PolarService) is called directly.
 * JWT is handled with `jose` (Web Crypto API — works in Deno, Node.js, and browsers).
 * Express/cors/helmet/rate-limit are NOT used here; Supabase handles infrastructure-level concerns.
 */

import { SignJWT, jwtVerify } from 'jose';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import config from './config/env.js';
import { AuthService } from './services/auth.service.js';
import { UserDAO } from './dao/user.dao.js';
import { PolarService } from './services/polar.service.js';
import { PlanType, SubscriptionStatus } from './types/user.types.js';
import logger from './logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': `chrome-extension://${config.extensionId}`,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: CORS_HEADERS });
}

const jwtSecret = new TextEncoder().encode(config.jwtSecret);

async function signJwt(
  payload: Record<string, unknown>,
  expiresInSeconds: number,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(config.extensionId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(jwtSecret);
}

async function verifyJwt(
  req: Request,
): Promise<{ uid: string; email: string; plan: string } | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwtSecret, {
      audience: config.extensionId,
    });
    return {
      uid: payload['uid'] as string,
      email: payload['email'] as string,
      plan: payload['plan'] as string,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handlers (pure Request → Response, no Express dependency)
// ---------------------------------------------------------------------------

async function handleLogin(req: Request): Promise<Response> {
  try {
    const { accessToken: supabaseToken } = await req.json();
    if (!supabaseToken) return json({ error: 'Missing Access Token' }, 400);

    const payload = await AuthService.verifySupabaseToken(supabaseToken);
    let user = await UserDAO.getUserById(payload.sub);
    if (!user) {
      user = await UserDAO.createUserProfile(payload.sub, {
        email: payload.email,
        display_name: payload.name,
      });
    }

    const accessToken = await signJwt(
      { uid: payload.sub, plan: user.plan_type, email: user.email },
      3600,
    );
    const refreshToken = await signJwt(
      { uid: payload.sub, email: user.email },
      7 * 24 * 3600,
    );

    return json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, plan: user.plan_type, status: user.subscription_status },
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Authentication login error');
    return json({ error: error.message || 'Authentication Failed' }, 401);
  }
}

async function handleRefresh(req: Request): Promise<Response> {
  try {
    const { refreshToken } = await req.json();
    if (!refreshToken) return json({ error: 'Missing Refresh Token' }, 400);

    let decoded: { uid: string };
    try {
      const { payload } = await jwtVerify(refreshToken, jwtSecret, { audience: config.extensionId });
      decoded = { uid: payload['uid'] as string };
    } catch {
      return json({ error: 'Invalid or Expired Refresh Token' }, 401);
    }

    const user = await UserDAO.getUserById(decoded.uid);
    if (!user) return json({ error: 'User not found' }, 404);

    const newAccessToken = await signJwt(
      { uid: user.id, plan: user.plan_type, email: user.email },
      3600,
    );
    return json({ accessToken: newAccessToken });
  } catch (error: any) {
    logger.error({ err: error }, 'Refresh token error');
    return json({ error: 'Invalid or Expired Refresh Token' }, 401);
  }
}

async function handleUserStatus(req: Request): Promise<Response> {
  const user = await verifyJwt(req);
  if (!user) return json({ error: 'Unauthorized: No token provided' }, 401);

  const userData = await UserDAO.getUserById(user.uid);
  if (!userData) return json({ error: 'User Not Found' }, 404);
  return json(userData);
}

async function handleCreateCheckout(req: Request): Promise<Response> {
  const user = await verifyJwt(req);
  if (!user) return json({ error: 'Unauthorized: No token provided' }, 401);

  try {
    const { successUrl } = await req.json().catch(() => ({}));
    const defaultSuccessUrl = `${config.cloudServerUrl}/success`;

    const checkoutUrl = await PolarService.createCheckoutSession(
      user.uid,
      user.email,
      successUrl || defaultSuccessUrl,
    );
    return json({ url: checkoutUrl });
  } catch (error: any) {
    logger.error({ err: error, uid: user.uid }, 'Error in createCheckout');
    return json({ error: error.message || 'Payment Checkout Generation Failed' }, 500);
  }
}

async function handleManageSubscription(req: Request): Promise<Response> {
  const user = await verifyJwt(req);
  if (!user) return json({ error: 'Unauthorized: No token provided' }, 401);

  try {
    const userProfile = await UserDAO.getUserById(user.uid);
    if (!userProfile) return json({ error: 'User profile not found.' }, 404);
    if (!userProfile.provider_customer_id) {
      return json({ error: 'No active subscription history found.' }, 400);
    }

    const portalUrl = await PolarService.createCustomerPortalSession(userProfile.provider_customer_id);
    return json({ url: portalUrl });
  } catch (error: any) {
    logger.error({ err: error, uid: user.uid }, 'Error in manageSubscription');
    return json({ error: error.message || 'Portal URL Generation Failed' }, 500);
  }
}

async function handlePolarWebhook(req: Request): Promise<Response> {
  try {
    const signature = req.headers.get('webhook-signature');
    if (!signature) {
      logger.warn('Webhook request missing signature');
      return text('Missing webhook signature', 401);
    }

    const payloadString = await req.text();
    const headers = Object.fromEntries(req.headers.entries());
    const event = validateEvent(payloadString, headers, config.polarWebhookSecret);
    logger.info({ eventType: event.type }, 'Polar webhook verified successfully');

    if (
      event.type === 'subscription.created' ||
      event.type === 'subscription.updated' ||
      event.type === 'subscription.active'
    ) {
      const payload = event.data as any;
      const userId = payload.metadata?.user_id || payload.customer?.metadata?.user_id;

      if (!userId) {
        logger.warn({ subId: payload.id }, 'Subscription event received without user_id metadata');
        return text('Ignored: missing metadata');
      }

      const statusInput = payload.status;
      let subStatus: SubscriptionStatus = 'none';
      let planType: PlanType = 'free';

      if (statusInput === 'active' || statusInput === 'trialing') {
        subStatus = 'active';
        planType = 'pro';
      } else if (statusInput === 'canceled' || statusInput === 'revoked' || statusInput === 'past_due') {
        subStatus = 'canceled';
      }

      const current_period_end = payload.current_period_end
        ? new Date(payload.current_period_end).toISOString()
        : new Date().toISOString();

      await UserDAO.updateSubscriptionStatus(userId, {
        subscription_status: subStatus,
        plan_type: planType,
        payment_provider: 'polar',
        provider_subscription_id: payload.id,
        provider_customer_id: payload.customer_id,
        current_period_end,
      });

      logger.info({ userId, subStatus }, 'Successfully synced polar subscription state');
    }

    return text('OK');
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      logger.warn('Polar Webhook Signature Verification Failed');
      return text('Invalid Signature', 403);
    }
    logger.error({ err: error }, 'Error processing Polar Webhook');
    return text('Webhook Process Error', 500);
  }
}

function handleSuccess(): Response {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f7fafc; margin: 0; }
    .card { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; border-top: 5px solid #48bb78; }
    h1 { color: #2d3748; padding-bottom: 0px; margin-bottom: 10px; }
    p { color: #4a5568; margin-top: 1rem; font-size: 1.1rem; }
    .icon { font-size: 4rem; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎉</div>
    <h1>Payment is completed.</h1>
    <p>Thank you for upgrading to Pro plan.</p>
    <p>You can close this window and return to the extension.</p>
  </div>
  <script>setTimeout(() => window.close(), 8000);</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ---------------------------------------------------------------------------
// Main router — Deno.serve()
// ---------------------------------------------------------------------------

(globalThis as any).Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const { pathname, method } = Object.assign(url, { method: req.method });

  logger.info({ method, url: pathname }, 'Incoming Request');

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method === 'POST' && pathname === '/api/auth/login') return handleLogin(req);
  if (method === 'POST' && pathname === '/api/auth/refresh') return handleRefresh(req);
  if (method === 'GET'  && pathname === '/api/user/status') return handleUserStatus(req);
  if (method === 'POST' && pathname === '/api/user/checkout') return handleCreateCheckout(req);
  if (method === 'POST' && pathname === '/api/user/portal') return handleManageSubscription(req);
  if (method === 'POST' && pathname === '/api/webhooks/polar') return handlePolarWebhook(req);
  if (method === 'GET'  && pathname === '/success') return handleSuccess();
  if (method === 'GET'  && pathname === '/health') return text('OK');

  return json({ error: 'Not Found' }, 404);
});
