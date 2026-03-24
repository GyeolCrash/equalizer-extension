import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserDAO } from '../dao/user.dao.js';
import jwt from 'jsonwebtoken';
import pino from 'pino';

const logger = pino();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development-only';

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
      const googleUserId = payload.sub; // Extracts the 'sub' claim as unique identifier

      // Step 2.2: Check Firestore DAO for existing user
      let user = await UserDAO.getUserById(googleUserId);

      // Step 2.3: Create profile if user not found
      if (!user) {
        user = await UserDAO.createUserProfile(googleUserId, {
          email: payload.email!,
          display_name: payload.name || payload.email!.split('@')[0],
        });
      }

      // Step 2.4: Generate custom signed JWT containing { uid, plan }
      const customToken = jwt.sign(
        { 
          uid: googleUserId, 
          plan: user.plan_type 
        }, 
        JWT_SECRET, 
        { 
          expiresIn: '7d', // Token valid for 7 days
          audience: process.env.GOOGLE_CLIENT_ID 
        }
      );

      // Step 2.5: Return the generated custom JWT back to the client application
      return res.status(200).json({ 
        token: customToken,
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
}
