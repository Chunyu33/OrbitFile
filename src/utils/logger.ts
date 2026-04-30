// 统一前端日志工具
// 替代零散的 console.error/warn/log，提供结构化前缀和级别

type LogLevel = 'info' | 'warn' | 'error';

const PREFIX = '[orbit-file]';

function fmt(level: LogLevel, message: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const line = `${PREFIX} [${level.toUpperCase()}] ${ts} ${message}`;
  switch (level) {
    case 'error':
      console.error(line, ...args);
      break;
    case 'warn':
      console.warn(line, ...args);
      break;
    default:
      console.log(line, ...args);
  }
}

export const logger = {
  info: (msg: string, ...args: unknown[]) => fmt('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => fmt('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => fmt('error', msg, ...args),
};
