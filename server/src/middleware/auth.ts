import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import logger from '../logger.js';
const client = new OAuth2Client();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-local-secret';

declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email: string;
        plan: string;
      };
    }
  }
}

export type AuthenticatedRequest = Request;

// Step 1: Google OAuth2 Token Verification
export const verifyGoogleToken = async (idToken: string) => {
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error('Invalid Google token payload');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name || '',
    };
  } catch (error) {
    logger.error({ error }, 'Google Token Verification Failed');
    return null;
  }
};

// Step 2: Custom JWT Issuance
export const generateToken = (payload: { uid: string; plan: string; email: string }) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

// Step 3: Authorization Middleware
export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { uid: string; email: string; plan: string };
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      plan: decoded.plan,
    };
    next();
  } catch (error) {
    logger.error({ error }, 'JWT Verification Failed');
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
