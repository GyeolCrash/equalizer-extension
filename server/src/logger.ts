import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

const isProduction = process.env.NODE_ENV === 'production';

export const loggerContext = new AsyncLocalStorage<Record<string, any>>();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin() {
    return loggerContext.getStore() || {};
  },
  ...(isProduction ? {} : {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
