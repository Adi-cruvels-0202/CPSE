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
    // Checklist 10.4: an email address is personal data, not an identifier we
    // need in an operational log. A customer id is how a log line names a person.
    expect(output).not.toContain('user@example.com');
  });

  it('redacts personal data as well as credentials (10.4)', async () => {
    const logger = await freshLogger('info');
    const { lines, restore } = captureStdout();

    logger.info('order placed', {
      customerId: '9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e12',
      orderNumber: 'CPSE-260919-000001',
      email: 'aditya@example.com',
      phone: '+919876543210',
      recipientName: 'Aditya Suresh',
      deliveryAddress: { line1: '221B Model Town', postalCode: '141002' },
      idempotencyKey: 'key-abc',
      signature: 'deadbeef',
    });
    restore();

    const output = lines.join('');
    for (const secret of [
      'aditya@example.com',
      '+919876543210',
      'Aditya Suresh',
      '221B Model Town',
      '141002',
      'key-abc',
      'deadbeef',
    ]) {
      expect(output, secret).not.toContain(secret);
    }

    // What is left is what an operator actually needs to trace the request.
    expect(output).toContain('9f8a1c2e-5b3d-4a7f-9c1e-2d4b6a8c0e12');
    expect(output).toContain('CPSE-260919-000001');
  });

  it('caps a value a caller controls, so one entry cannot bury the others', async () => {
    const logger = await freshLogger('info');
    const { lines, restore } = captureStdout();

    logger.warn('suspicious input', { note: 'A'.repeat(5000) });
    restore();

    const output = lines.join('');
    expect(output).toContain('[truncated 5000 chars]');
    expect(output.length).toBeLessThan(1500);
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
