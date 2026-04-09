import { Polar } from '@polar-sh/sdk';
import config from '../config/env.ts';
import logger from '../logger.ts';

const polar = new Polar({
    accessToken: config.polarAccessToken,
    server: config.isProd ? 'production' : 'sandbox',
});

export class PolarService {
  /**
   * Creates a Polar checkout session for Pro plan purchase.
   * The user_id metadata is the Supabase Auth UUID used to sync subscription state via webhook.
   */
  static async createCheckoutSession(userId: string, customerEmail: string, successUrl: string): Promise<string> {
    try {
      if (!config.polarProProductId) {
        throw new Error('Polar Pro Product ID is not configured.');
      }

      const checkout = await polar.checkouts.create({
        products: [config.polarProProductId],
        successUrl,
        customerEmail,
        metadata: {
          user_id: userId,
        },
      });

      return checkout.url;
    } catch (error: any) {
      logger.error({ err: error, userId }, 'Failed to create polar checkout session');
      throw new Error('Failed to create Polar Checkout Session.');
    }
  }

  /**
   * Creates a Polar Customer Portal session for subscription management.
   */
  static async createCustomerPortalSession(customerId: string): Promise<string> {
    try {
      const session = await polar.customerSessions.create({
        customerId,
      });

      return session.customerPortalUrl;
    } catch (error: any) {
      logger.error({ err: error, customerId }, 'Failed to create polar customer portal session');
      throw new Error('Failed to create Polar Customer Portal session.');
    }
  }
}
