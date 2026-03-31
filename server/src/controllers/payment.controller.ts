import { Request, Response } from 'express';
import { PolarService } from '../services/polar.service.js';
import { UserDAO } from '../dao/user.dao.js';
import logger from '../logger.js';
import config from '../config/env.js';

export class PaymentController {
    /**
     * Pro 플랜 결제를 위한 Checkout URL 발급
     */
    static async createCheckout(req: Request, res: Response): Promise<Response> {
        try {
            // req.user는 requireAuth 미들웨어에서 인증된 사용자 정보를 보장함.
            const user = req.user!;
            const { successUrl } = req.body;

            const defaultSuccessUrl = `${config.cloudServerUrl}/success`;

            const checkoutUrl = await PolarService.createCheckoutSession(
                user.uid,
                user.email,
                successUrl || defaultSuccessUrl
            );

            return res.status(200).json({ url: checkoutUrl });
        } catch (error: any) {
            logger.error({ err: error, uid: req.user?.uid }, 'Error in createCheckout');
            return res.status(500).json({ error: error.message || 'Payment Checkout Generation Failed' });
        }
    }

    /**
     * Free 플랜 다운그레이드 및 정기구독 갱신/관리를 위한 Customer Portal URL 발급
     */
    static async manageSubscription(req: Request, res: Response): Promise<Response> {
        try {
            const user = req.user!;
            const userProfile = await UserDAO.getUserById(user.uid);

            if (!userProfile) {
                return res.status(404).json({ error: 'Firestore DB에서 사용자 프로필을 찾을 수 없습니다.' });
            }

            if (!userProfile.provider_customer_id) {
                return res.status(400).json({ error: '활성화된 구독 이력(Provider Customer ID)이 존재하지 않습니다.' });
            }

            const portalUrl = await PolarService.createCustomerPortalSession(userProfile.provider_customer_id);

            return res.status(200).json({ url: portalUrl });
        } catch (error: any) {
            logger.error({ err: error, uid: req.user?.uid }, 'Error in manageSubscription');
            return res.status(500).json({ error: error.message || 'Portal URL Generation Failed' });
        }
    }
}