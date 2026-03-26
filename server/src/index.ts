import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import logger from './logger.js';
import config from './config/env.js';
import userRouter from './routes/user.js';
import authRouter from './routes/auth.js';
import webhookRouter from './routes/webhooks.js';

const app: Express = express();
const port = config.port;

// Step 1: Middleware
app.use(helmet());
app.use(cors({
  origin: `chrome-extension://${config.extensionId}`, // Explicitly allow ONLY extension
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming Request');
  next();
});

// Step 3: API Routers
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/webhooks', webhookRouter);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Error Handler
app.use((err: Error, req: Request, res: Response, next: any) => {
  logger.error(err, 'Unhandled Error');
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
});

export default app;
