import { Request, Response } from 'express';
import { PolarService } from '../services/polar.service.ts';
import { UserDAO } from '../dao/user.dao.ts';
import logger from '../logger.ts';
import config from '../config/env.ts';

export class PaymentController {
    /**
     * Issues a Polar checkout URL for Pro plan purchase.
     */
    static async createCheckout(req: Request, res: Response): Promise<Response> {
        try {
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
     * Issues a Polar Customer Portal URL for subscription management.
     */
    static async manageSubscription(req: Request, res: Response): Promise<Response> {
        try {
            const user = req.user!;
            const userProfile = await UserDAO.getUserById(user.uid);

            if (!userProfile) {
                return res.status(404).json({ error: 'User profile not found.' });
            }

            if (!userProfile.provider_customer_id) {
                return res.status(400).json({ error: 'No active subscription history found.' });
            }

            const portalUrl = await PolarService.createCustomerPortalSession(userProfile.provider_customer_id);

            return res.status(200).json({ url: portalUrl });
        } catch (error: any) {
            logger.error({ err: error, uid: req.user?.uid }, 'Error in manageSubscription');
            return res.status(500).json({ error: error.message || 'Portal URL Generation Failed' });
        }
    }
}
