const isDeno = typeof (globalThis as any).Deno !== 'undefined';

type LogObj = object | string;

export interface ILogger {
  info(obj: LogObj, msg?: string): void;
  warn(obj: LogObj, msg?: string): void;
  error(obj: LogObj, msg?: string): void;
}

// Stub for request-context storage; populated with AsyncLocalStorage in Node.js
export let loggerContext: { getStore(): Record<string, any> | undefined } = {
  getStore: () => undefined,
};

let logger: ILogger;

if (isDeno) {
  // Edge Function: structured console output (Supabase collects stdout as logs)
  const fmt = (level: string, obj: LogObj, msg?: string): string => {
    const base: Record<string, unknown> = { time: new Date().toISOString(), level };
    if (typeof obj === 'string') {
      base['msg'] = msg ? `${obj} ${msg}` : obj;
    } else {
      Object.assign(base, obj);
      if (msg) base['msg'] = msg;
    }
    return JSON.stringify(base);
  };

  logger = {
    info: (obj, msg) => console.log(fmt('INFO', obj, msg)),
    warn: (obj, msg) => console.warn(fmt('WARN', obj, msg)),
    error: (obj, msg) => console.error(fmt('ERROR', obj, msg)),
  };
} else {
  // Node.js: pino with AsyncLocalStorage for per-request context mixing
  const [{ default: pino }, { AsyncLocalStorage }] = await Promise.all([
    import('pino'),
    import('async_hooks'),
  ]);

  const ctx = new AsyncLocalStorage<Record<string, any>>();
  loggerContext = ctx;

  const isProduction = getEnv('NODE_ENV') === 'production';

  logger = pino({
    level: getEnv('LOG_LEVEL') || 'info',
    mixin() {
      return ctx.getStore() || {};
    },
    ...(isProduction
      ? {}
      : {
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
}

// getEnv is needed here before env.ts module resolves in some import orders
function getEnv(key: string): string {
  return process.env[key] || '';
}

export default logger;
