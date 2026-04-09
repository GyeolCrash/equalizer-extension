import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../logger.js';
import config from '../config/env.js';

const JWT_SECRET = config.jwtSecret;

export type AuthenticatedRequest = Request;

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { audience: config.extensionId }) as { uid: string; email: string; plan: string };
    req.user = { uid: decoded.uid, email: decoded.email, plan: decoded.plan };
    next();
  } catch (error) {
    logger.error({ error }, 'JWT Verification Failed');
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
