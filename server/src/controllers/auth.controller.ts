import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserDAO } from '../dao/user.dao.js';
import jwt from 'jsonwebtoken';
import logger from '../logger.js';
import config from '../config/env.js';

const JWT_SECRET = config.jwtSecret;

export class AuthController {

  /**
   * Primary authentication endpoint: POST /api/auth/login
   * Expects 'accessToken' (Supabase JWT from the client's Supabase Auth session) in request body.
   */
  static async login(req: Request, res: Response): Promise<Response> {
    try {
      const { accessToken: supabaseToken } = req.body;
      if (!supabaseToken) {
        return res.status(400).json({ error: 'Missing Access Token' });
      }

      // Step 1: Verify Supabase access token — user already exists in auth.users (created by Supabase OAuth)
      const payload = await AuthService.verifySupabaseToken(supabaseToken);
      const supabaseUserId = payload.sub;

      // Step 2: Find or create user profile row in public.users
      let user = await UserDAO.getUserById(supabaseUserId);
      if (!user) {
        user = await UserDAO.createUserProfile(supabaseUserId, {
          email: payload.email,
          display_name: payload.name,
        });
      }

      // Step 3: Issue JWTs — audience is the extension ID
      const accessToken = jwt.sign(
        { uid: supabaseUserId, plan: user.plan_type, email: user.email },
        JWT_SECRET,
        { expiresIn: '1h', audience: config.extensionId }
      );
      const refreshToken = jwt.sign(
        { uid: supabaseUserId, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d', audience: config.extensionId }
      );

      return res.status(200).json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          plan: user.plan_type,
          status: user.subscription_status,
        },
      });

    } catch (error: any) {
      logger.error({ err: error }, 'Authentication login error');
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

      const decoded = jwt.verify(refreshToken, JWT_SECRET, {
        audience: config.extensionId,
      }) as { uid: string };

      const user = await UserDAO.getUserById(decoded.uid);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const newAccessToken = jwt.sign(
        { uid: user.id, plan: user.plan_type, email: user.email },
        JWT_SECRET,
        { expiresIn: '1h', audience: config.extensionId }
      );

      return res.status(200).json({ accessToken: newAccessToken });

    } catch (error: any) {
      logger.error({ err: error }, 'Refresh token error');
      return res.status(401).json({ error: 'Invalid or Expired Refresh Token' });
    }
  }
}
