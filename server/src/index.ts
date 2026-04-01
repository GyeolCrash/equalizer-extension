import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger, { loggerContext } from './logger.js';
import config from './config/env.js';
import userRouter from './routes/user.js';
import authRouter from './routes/auth.js';
import webhookRouter from './routes/webhooks.js';
import successRouter from './routes/success.js';

const app: Express = express();
const port = config.port;

// Trust the first proxy in Google Cloud Run to get accurate client IP for rate limiting
app.set('trust proxy', 1);

// Configure Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // Limit each IP to 20 requests per window
  standardHeaders: 'draft-7', // set draft-7 standard RateLimit headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res, next, options) => {
    logger.warn({ ip: req.ip }, 'Rate limit exceeded');
    res.status(options.statusCode).json({ error: options.message });
  }
});

// Step 1: Middleware
app.use(limiter);
app.use(helmet());

app.use(cors({
  origin: `chrome-extension://${config.extensionId}`, // Explicitly allow ONLY extension
  methods: ['GET', 'POST', 'OPTIONS'],
}));
// Webhooks MUST be mounted before express.json() to capture raw unparsed body for signature validation
app.use('/api/webhooks', webhookRouter);
app.use('/success', successRouter);

app.use(express.json());
// Request logging middleware
app.use((req: Request, res: Response, next) => {
  const traceHeader = req.header('X-Cloud-Trace-Context');
  let traceId = '';

  if (traceHeader && process.env.GOOGLE_CLOUD_PROJECT) {
    traceId = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/traces/${traceHeader.split('/')[0]}`;
  }

  const context = traceId ? { 'logging.googleapis.com/trace': traceId } : {};

  loggerContext.run(context, () => {
    logger.info({ method: req.method, url: req.url }, 'Incoming Request');
    next();
  });
});

// Step 3: API Routers
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);

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
