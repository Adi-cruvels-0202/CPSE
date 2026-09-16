-- 0001_enums.sql — extensions + every enum the schema uses.
-- Checklist 1.16. Enums come first because later tables reference them.
-- Money is stored as INTEGER PAISE everywhere (decision D8). Integer caps at
-- ~21.4 crore rupees, which is far above anything this portal will see.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive slugs/emails

-- The customer-visible order lifecycle. 'pending_payment' only exists while an
-- online payment is in flight; a cash order is 'placed' immediately.
do $$ begin
  create type order_status as enum (
    'pending_payment',
    'placed',
    'accepted',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'completed',
    'cancelled',
    'rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum (
    'pending',
    'processing',
    'paid',
    'failed',
    'cancelled',
    'refunded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type fulfilment_mode as enum ('pickup', 'delivery');
exception when duplicate_object then null; end $$;

-- 'debit'  = customer owes the store more (a credit purchase)
-- 'credit' = customer paid the store back
do $$ begin
  create type khata_txn_type as enum ('debit', 'credit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum (
    'order_placed',
    'order_status_changed',
    'order_cancelled',
    'payment_succeeded',
    'payment_failed',
    'khata_updated'
  );
exception when duplicate_object then null; end $$;
