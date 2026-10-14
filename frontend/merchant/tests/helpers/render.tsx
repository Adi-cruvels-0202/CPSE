import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import { vi } from 'vitest';
import { http } from '../../src/api/client';
import { adminHttp } from '../../src/admin/adminApi';
import { writeSession } from '../../src/lib/session';
import { ToastProvider } from '../../src/hooks/useToast';

/**
 * A small screen-test kit with no extra dependencies: React's own act(), a
 * real router, query client and toasts, and a fake HTTP transport answering
 * with the backend's envelope. Requests are recorded so a test can assert
 * exactly what a screen sent.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export interface Sent { method: string; url: string; params?: any; body?: any; headers: any }
type Reply = { status?: number; data?: any; meta?: any; error?: { code: string; message: string; details?: any } };
export type Route = [method: string, pattern: RegExp, reply: (req: Sent) => Reply];

export function fakeServer(routes: Route[]) {
  const sent: Sent[] = [];
  const adapter = vi.fn(async (config: any) => {
    let body = config.data;
    try { body = typeof body === 'string' ? JSON.parse(body) : body; } catch { /* raw text */ }
    const req: Sent = { method: config.method.toUpperCase(), url: config.url, params: config.params, body, headers: config.headers };
    sent.push(req);
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(req.url));
    const reply = route ? route[2](req) : { status: 404, error: { code: 'NOT_FOUND', message: `No fake for ${req.method} ${req.url}` } };
    const status = reply.status ?? 200;
    const data = reply.error ? { success: false, error: { ...reply.error, details: reply.error.details ?? null } } : { success: true, data: reply.data ?? {}, ...(reply.meta ? { meta: reply.meta } : {}) };
    const response = { status, data, headers: {}, config, statusText: String(status) };
    if (status >= 400) {
      const error: any = new Error(`Request failed with status code ${status}`);
      error.response = response; error.config = config; error.isAxiosError = true;
      throw error;
    }
    return response;
  });
  http.defaults.adapter = adapter as any;
  adminHttp.defaults.adapter = adapter as any;
  axios.defaults.adapter = adapter as any;
  return sent;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

export async function render(ui: ReactNode, { path = '/' } = {}) {
  writeSession({ accessToken: 'token-1', refreshToken: 'refresh-1' });
  container = document.createElement('div');
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return container;
}

export async function cleanup() {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null; container = null;
}

/** Let queries and mutations settle. */
export async function settle(times = 5) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

export async function waitFor<T>(check: () => T, { timeout = 1500 } = {}): Promise<T> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeout) {
    try {
      const value = check();
      if (value !== undefined && value !== null && value !== false) return value;
    } catch (error) { lastError = error; }
    await settle(1);
  }
  throw lastError ?? new Error('waitFor timed out');
}

export const text = () => document.body.textContent ?? '';

export function byText(selector: string, content: string | RegExp): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>(selector)];
  // An exact match wins over one that merely contains the text ("Open" vs "Open a khata").
  const match = typeof content === 'string'
    ? all.find((el) => el.textContent?.trim() === content) ?? all.find((el) => el.textContent?.includes(content))
    : all.find((el) => content.test(el.textContent ?? ''));
  if (!match) throw new Error(`No ${selector} with text ${content}`);
  return match;
}

export const byLabel = <T extends HTMLElement = HTMLInputElement>(label: string | RegExp): T => {
  const el = [...document.querySelectorAll<HTMLLabelElement>('label')].find((l) => (typeof label === 'string' ? l.textContent?.trim() === label : label.test(l.textContent ?? '')));
  const target = el?.htmlFor ? document.getElementById(el.htmlFor) : el?.querySelector('input,select,textarea');
  if (!target) throw new Error(`No field labelled ${label}`);
  return target as T;
};

export async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  await settle();
}

/** Type into a controlled input the way React notices. */
export async function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export async function submit(form: HTMLFormElement) {
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
}
