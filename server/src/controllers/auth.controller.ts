import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserDAO } from '../dao/user.dao.js';
import { db } from '../config/firebase.config.js'; // Ensure app is initialized
import { getAuth } from 'firebase-admin/auth';
import jwt from 'jsonwebtoken';
import logger from '../logger.js';
import config from '../config/env.js';

const JWT_SECRET = config.jwtSecret;

export class AuthController {

  /**
   * Primary authentication endpoint: POST /api/auth/login
   * Expects 'idToken' from chrome.identity in request body.
   */
  static async login(req: Request, res: Response): Promise<Response> {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        return res.status(400).json({ error: 'Missing ID Token' });
      }

      // Step 2.1: Verify Google ID Token
      const payload = await AuthService.verifyGoogleToken(idToken);
      const googleUserId = payload.sub!;

      // Step 2.2: Check Firestore DAO for existing user
      let user = await UserDAO.getUserById(googleUserId);

      // Step 2.3: Create profile if user not found
      if (!user) {
        user = await UserDAO.createUserProfile(googleUserId, {
          email: payload.email!,
          display_name: payload.name || payload.email!.split('@')[0],
        });
      }

      // Step 2.4: Generate Firebase Custom Token
      const auth = getAuth();
      const firebaseCustomToken = await auth.createCustomToken(googleUserId, {
        plan: user.plan_type
      });

      // Step 2.5: Generate signed JWTs for Express middleware
      const accessToken = jwt.sign(
        { uid: googleUserId, plan: user.plan_type, email: user.email },
        JWT_SECRET,
        { expiresIn: '1h', audience: config.googleClientId } // Short expiration
      );

      const refreshToken = jwt.sign(
        { uid: googleUserId, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d', audience: config.googleClientId } // Long expiration
      );

      // Return both tokens to the client application
      return res.status(200).json({
        accessToken,
        refreshToken,
        firebaseCustomToken,
        user: {
          id: user.id,
          email: user.email,
          plan: user.plan_type,
          status: user.subscription_status
        }
      });

    } catch (error: any) {
      logger.error('Authentication login error', error);
      return res.status(401).json({ error: error.message || 'Authentication Failed' });
    }
  }

  /**
   * Refresh token endpoint: POST /api/auth/refresh
   */
  static async refresh(req: Request, res: Response): Promise<Response> {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ error: 'Missing Refresh Token' });
      }

      // Verify the provided refresh token
      const decoded = jwt.verify(refreshToken, JWT_SECRET, {
        audience: config.googleClientId
      }) as { uid: string };

      const user = await UserDAO.getUserById(decoded.uid);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Generate a new 1h access token
      const newAccessToken = jwt.sign(
        { uid: user.id, plan: user.plan_type, email: user.email },
        JWT_SECRET,
        { expiresIn: '1h', audience: config.googleClientId }
      );

      return res.status(200).json({ accessToken: newAccessToken });

    } catch (error: any) {
      logger.error('Refresh token error', error);
      return res.status(401).json({ error: 'Invalid or Expired Refresh Token' });
    }
  }
}
