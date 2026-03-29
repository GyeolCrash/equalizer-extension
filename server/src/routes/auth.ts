import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import { AuthController } from '../controllers/auth.controller.js';

const authRouter = express.Router();

// Step 2: Custom JWT Issuance and Management
const loginSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'Token is required'),
  }),
});

const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh Token is required'),
  }),
});

authRouter.post('/login', validateRequest(loginSchema), AuthController.login);
authRouter.post('/refresh', validateRequest(refreshSchema), AuthController.refresh);

export default authRouter;
