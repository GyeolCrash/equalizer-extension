import express, { Request, Response } from 'express';
import logger from '../logger.js';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import config from '../config/env.js';
import { UserDAO } from '../dao/user.dao.js';
import { PlanType, SubscriptionStatus } from '../types/user.types.js';

const webhookRouter = express.Router();

// Define the REST entry path for Polar Webhooks.
// We use express.raw to retrieve the exact binary Buffer of the payload to verify its cryptographic signature.
webhookRouter.post('/polar', express.raw({ type: 'application/json' }), async (req: Request, res: Response): Promise<any> => {
  try {
    const signature = req.headers['webhook-signature'];

    // Validate that the request has a signature
    if (typeof signature !== 'string') {
      logger.warn('Webhook request missing signature');
      return res.status(401).send('Missing webhook signature');
    }

    // validateEvent requires body buffer, headers, and webhook secret
    const event = validateEvent(req.body, req.headers as Record<string, string>, config.polarWebhookSecret);
    logger.info({ eventType: event.type }, 'Polar webhook verified successfully');

    // Handle Subscription events
    if (
      event.type === 'subscription.created' ||
      event.type === 'subscription.updated' ||
      event.type === 'subscription.active'
    ) {
      const payload = event.data as any;
      const googleUserId = payload.metadata?.google_user_id || payload.customer?.metadata?.google_user_id;

      if (!googleUserId) {
        logger.warn({ subId: payload.id }, 'Subscription event received without google_user_id metadata');
        return res.status(200).send('Ignored: missing metadata');
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

      let current_period_end = new Date();
      if (payload.current_period_end) {
        current_period_end = new Date(payload.current_period_end);
      }

      await UserDAO.updateSubscriptionStatus(googleUserId, {
        subscription_status: subStatus,
        plan_type: planType,
        payment_provider: 'polar',
        provider_subscription_id: payload.id,
        provider_customer_id: payload.customer_id,
        current_period_end: current_period_end,
      });

      logger.info({ googleUserId, subStatus }, 'Successfully synced polar subscription state');
    }

    // Return 2xx HTTP status to acknowledge receipt
    return res.status(200).send('OK');

  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      logger.warn('Polar Webhook Signature Verification Failed');
      return res.status(403).send('Invalid Signature');
    }
    logger.error({ err: error }, 'Error processing Polar Webhook');
    return res.status(500).send('Webhook Process Error');
  }
});

export default webhookRouter;
