import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS,
  ORDER_STATUSES,
  canTransition,
  canCustomerCancel,
  isTerminal,
  timelineFor,
  orderStatusForPayment,
} from '../src/modules/orders/order.state.js';

/** Checklist 8.3 — the state machine, tested without a database in the way. */

describe('transitions (8.3)', () => {
  it('walks the pickup happy path', () => {
    expect(canTransition('placed', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready_for_pickup')).toBe(true);
    expect(canTransition('ready_for_pickup', 'completed')).toBe(true);
  });

  it('walks the delivery happy path', () => {
    expect(canTransition('preparing', 'out_for_delivery')).toBe(true);
    expect(canTransition('out_for_delivery', 'completed')).toBe(true);
  });

  it('refuses to skip ahead', () => {
    expect(canTransition('placed', 'completed')).toBe(false);
    expect(canTransition('placed', 'ready_for_pickup')).toBe(false);
  });

  it('refuses to go backwards', () => {
    expect(canTransition('completed', 'preparing')).toBe(false);
    expect(canTransition('preparing', 'accepted')).toBe(false);
  });

  it('lets nothing leave a terminal state', () => {
    for (const status of ['completed', 'cancelled', 'rejected']) {
      expect(TRANSITIONS[status], status).toEqual([]);
      expect(isTerminal(status)).toBe(true);
    }
  });

  it('only leaves pending_payment for placed, cancelled or rejected (7.13)', () => {
    expect(TRANSITIONS.pending_payment).toEqual(['placed', 'cancelled', 'rejected']);
  });

  it('has a rule for every declared status, and names no status that does not exist', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const targets of Object.values(TRANSITIONS)) {
      for (const target of targets) expect(ORDER_STATUSES).toContain(target);
    }
  });

  it('treats an unknown status as allowing nothing rather than throwing', () => {
    expect(canTransition('teleported', 'completed')).toBe(false);
  });
});

describe('customer cancellation (8.4)', () => {
  it('allows cancelling before the store starts work', () => {
    for (const status of ['pending_payment', 'placed', 'accepted']) {
      expect(canCustomerCancel(status), status).toBe(true);
    }
  });

  it('refuses once the order is being prepared or later', () => {
    for (const status of ['preparing', 'ready_for_pickup', 'out_for_delivery', 'completed']) {
      expect(canCustomerCancel(status), status).toBe(false);
    }
  });
});

describe('timeline (8.5)', () => {
  it('shows pickup states for a pickup order and no delivery step', () => {
    const steps = timelineFor('pickup');

    expect(steps).toContain('ready_for_pickup');
    expect(steps).not.toContain('out_for_delivery');
  });

  it('shows delivery states for a delivery order and no pickup step', () => {
    const steps = timelineFor('delivery');

    expect(steps).toContain('out_for_delivery');
    expect(steps).not.toContain('ready_for_pickup');
  });
});

describe('payment ↔ order consistency (7.15)', () => {
  it('places an order once the payment is confirmed', () => {
    expect(orderStatusForPayment('pending_payment', 'paid')).toBe('placed');
  });

  it('cancels an order whose payment was cancelled', () => {
    expect(orderStatusForPayment('pending_payment', 'cancelled')).toBe('cancelled');
  });

  it('leaves the order where it is when the payment fails, so it can be retried', () => {
    expect(orderStatusForPayment('pending_payment', 'failed')).toBeNull();
  });

  it('leaves the order where it is while the payment is still processing', () => {
    expect(orderStatusForPayment('pending_payment', 'processing')).toBeNull();
  });

  it('never re-places an order that has already moved on', () => {
    expect(orderStatusForPayment('accepted', 'paid')).toBeNull();
    expect(orderStatusForPayment('completed', 'paid')).toBeNull();
  });
});
