import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The logger reads LOG_LEVEL at import time via config/env.js, so each test
 * re-imports it with a fresh module registry.
 */
async function freshLogger(level) {
  vi.resetModules();
  process.env.LOG_LEVEL = level;
  const { logger } = await import('../src/lib/logger.js');
  return logger;
}

afterEach(() => {
  process.env.LOG_LEVEL = 'silent';
  vi.resetModules();
});

function captureStdout() {
  const lines = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('logger', () => {
  it('redacts sensitive values instead of logging them', async () => {
    const logger = await freshLogger('info');
    const { lines, restore } = captureStdout();

    logger.info('login attempt', {
      email: 'user@example.com',
      password: 'hunter2',
      token: 'ey.super.secret',
      nested: { refreshToken: 'rt_live_123' },
    });
    restore();

    const output = lines.join('');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('ey.super.secret');
    expect(output).not.toContain('rt_live_123');
    expect(output).toContain('[redacted]');
    expect(output).toContain('user@example.com');
  });

  it('suppresses messages below the configured level', async () => {
    const logger = await freshLogger('warn');
    const { lines, restore } = captureStdout();

    logger.debug('noisy');
    logger.info('also noisy');
    restore();

    expect(lines).toHaveLength(0);
  });

  it('writes structured JSON', async () => {
    const logger = await freshLogger('info');
    const { lines, restore } = captureStdout();

    logger.info('request completed', { status: 200 });
    restore();

    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('request completed');
    expect(entry.status).toBe(200);
    expect(entry.time).toBeTruthy();
  });
});
