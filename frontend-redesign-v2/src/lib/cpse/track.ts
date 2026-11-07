// @ts-nocheck
// Ported verbatim from the original CPSE customer app (frontend/customer/src/lib/track.js).
import { endpoints } from './endpoints';
import { readSession } from './tokens';

/**
 * Records one activity event (roadmap §5 P6 "Behaviour events"), when there is
 * a signed-in customer. Fire and forget: shopping never waits on it or fails
 * because of it. The server drops the event if the customer turned activity
 * off in Preferences, and ignores ids that do not belong together.
 */
export function track(event) {
  if (!readSession()) return;
  endpoints.shopping.recordEvent(event).catch(() => undefined);
}
