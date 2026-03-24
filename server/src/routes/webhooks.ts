import express, { Request, Response } from 'express';
import logger from '../logger.js';

const webhookRouter = express.Router();

// Step 4: Webhook Architecture Placeholder
// Define the REST entry path expected for the future MoR integration
webhookRouter.post('/payment', (req: Request, res: Response) => {
  logger.info({ webhook: 'payment', body: req.body }, 'Payment Webhook Received');
  
  // todo
  return res.status(200).send('OK');
});

export default webhookRouter;
