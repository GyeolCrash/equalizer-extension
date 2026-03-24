import express, { Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { UserDAO } from '../dao/user.dao.js';

const userRouter = express.Router();

// Step 3: Design Idempotent API Routers
// GET /api/user/status: Resolve user subscription standing
userRouter.get('/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { uid } = req.user!;
  const userData = await UserDAO.getUserById(uid);
  if (!userData) {
    return res.status(404).json({ error: 'User Not Found' });
  }
  return res.status(200).json(userData);
});

export default userRouter;
