import { redact } from './redact.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as Level) ? (raw as Level) : 'info';
}

function emit(level: Level, msg: string, context?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') process.stderr.write(`${serialized}\n`);
  else process.stdout.write(`${serialized}\n`);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
  child(base: Record<string, unknown>) {
    return {
      debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, { ...base, ...ctx }),
      info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, { ...base, ...ctx }),
      warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, { ...base, ...ctx }),
      error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, { ...base, ...ctx }),
    };
  },
};

export function errorContext(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { error: err.message, errorName: err.name, stack: err.stack?.split('\n').slice(0, 5).join('\n') };
  }
  return { error: String(err) };
}
