/**
 * Levelled logs to stdout (.claude/rules/logging.md). LOG_LEVEL is `error`,
 * `warn`, `info` or `debug`. The default is `info`. Each other value stops
 * the service at startup.
 */

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
type Level = (typeof LEVELS)[number];

const parse = (value: string | undefined): Level => {
  const level = (value || 'info') as Level;
  if (!LEVELS.includes(level)) {
    throw new Error(
      `LOG_LEVEL must be one of ${LEVELS.join(', ')}. It is "${value}".`,
    );
  }
  return level;
};

const threshold = LEVELS.indexOf(parse(process.env.LOG_LEVEL));

const write = (level: Level, message: string) => {
  if (LEVELS.indexOf(level) > threshold) return;
  const line = `${new Date().toISOString()} ${level} ${message}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
};

export const log = {
  error: (message: string) => write('error', message),
  warn: (message: string) => write('warn', message),
  info: (message: string) => write('info', message),
  debug: (message: string) => write('debug', message),
};
