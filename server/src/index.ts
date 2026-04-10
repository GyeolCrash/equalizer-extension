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

// Auth callback page: magic link redirects here. Tokens are in the URL fragment (never sent to server).
// The injected content script reads them and forwards to the extension background service worker.
app.get('/auth/callback', (_req: Request, res: Response) => {
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signed In</title>
  <style>
    body{font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a1a;margin:0;color:#fff}
    .card{background:#222;padding:2.5rem;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.4);text-align:center;border-top:5px solid #4caf50;max-width:400px}
    h1{margin-bottom:10px}.icon{font-size:3rem;margin-bottom:10px}p{color:#aaa;margin-top:1rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Signed in successfully</h1>
    <p>You can close this tab and return to the extension.</p>
  </div>
  <script>setTimeout(()=>window.close(),5000);</script>
</body>
</html>`);
});

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
