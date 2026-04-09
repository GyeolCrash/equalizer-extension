import express, { Request, Response } from 'express';
import logger from '../logger.js';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import config from '../config/env.js';
import { UserDAO } from '../dao/user.dao.js';
import { PlanType, SubscriptionStatus } from '../types/user.types.js';

const webhookRouter = express.Router();

// express.raw() must capture the unparsed Buffer for Polar signature verification.
webhookRouter.post('/polar', express.raw({ type: 'application/json' }), async (req: Request, res: Response): Promise<any> => {
  try {
    const signature = req.headers['webhook-signature'];

    if (typeof signature !== 'string') {
      logger.warn('Webhook request missing signature');
      return res.status(401).send('Missing webhook signature');
    }

    const payloadBuffer = req.body;
    const payloadString = payloadBuffer instanceof Buffer ? payloadBuffer.toString('utf-8') : payloadBuffer;
    const event = validateEvent(payloadString, req.headers as Record<string, string>, config.polarWebhookSecret);
    logger.info({ eventType: event.type }, 'Polar webhook verified successfully');

    if (
      event.type === 'subscription.created' ||
      event.type === 'subscription.updated' ||
      event.type === 'subscription.active'
    ) {
      const payload = event.data as any;
      // user_id holds the Supabase Auth UUID set during checkout session creation
      const userId = payload.metadata?.user_id || payload.customer?.metadata?.user_id;

      if (!userId) {
        logger.warn({ subId: payload.id }, 'Subscription event received without user_id metadata');
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
