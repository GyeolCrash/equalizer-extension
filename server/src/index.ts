import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from './logger.ts';
import config from './config/env.ts';
import userRouter from './routes/user.ts';
import authRouter from './routes/auth.ts';
import webhookRouter from './routes/webhooks.ts';
import successRouter from './routes/success.ts';

const app: Express = express();
const port = config.port;

// Trust the first proxy to get accurate client IP for rate limiting
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn({ ip: req.ip }, 'Rate limit exceeded');
    res.status(options.statusCode).json({ error: options.message });
  }
});

app.use(limiter);
app.use(helmet());
app.use(cors({
  origin: `chrome-extension://${config.extensionId}`,
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// Webhooks must be mounted before express.json() to capture raw body for signature validation
app.use('/api/webhooks', webhookRouter);
app.use('/success', successRouter);

app.use(express.json());

app.use((req: Request, res: Response, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming Request');
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.use((err: Error, req: Request, res: Response, next: any) => {
  logger.error(err, 'Unhandled Error');
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
});

export default app;
