import { Polar } from '@polar-sh/sdk';
import config from '../config/env.js';
import logger from '../logger.js';

const polar = new Polar({
    accessToken: config.polarAccessToken,
    server: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
});

export class PolarService {
  /**
   * Pro Plan 구매를 위한 Checkout Session 생성
   */
  static async createCheckoutSession(googleUserId: string, customerEmail: string, successUrl: string): Promise<string> {
    try {
      if (!config.polarProProductId) {
        throw new Error('Polar Pro Product ID is not configured.');
      }

      const checkout = await polar.checkouts.create({
        products: [config.polarProProductId],
        successUrl,
        customerEmail,
        metadata: {
          google_user_id: googleUserId, // Webhook 동기화용 필수 필드
        },
      });

      return checkout.url;
    } catch (error: any) {
      logger.error({ err: error, googleUserId }, 'Failed to create polar checkout session');
      throw new Error('Polar Checkout Session 생성에 실패했습니다.');
    }
  }

  /**
   * Free Plan으로의 다운그레이드 및 결제 관리를 위한 Customer Portal 세션 발급
   */
  static async createCustomerPortalSession(customerId: string): Promise<string> {
    try {
      const session = await polar.customerSessions.create({
        customerId,
      });

      return session.customerPortalUrl;
    } catch (error: any) {
      logger.error({ err: error, customerId }, 'Failed to create polar customer portal session');
      throw new Error('Polar Customer Portal 생성에 실패했습니다.');
    }
  }
}
