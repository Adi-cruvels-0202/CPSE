-- 0044_cart_behaviour_events.sql — cart additions and abandoned-cart signals
-- as behaviour events (roadmap §5 P6 "Behaviour events").
--
-- cart_add is written by the server when an item really goes into a cart, never
-- by a client. cart_abandon is written by a scheduled job for an open cart that
-- has items and no activity for a day; `dedupe_key` (one per cart and last
-- activity time) makes each idle spell count once however often the job runs.
-- Neither carries prices or personal details — ids, a quantity, a count.

alter table public.customer_events drop constraint if exists customer_events_type;
alter table public.customer_events add constraint customer_events_type check (event_type in (
  'store_view', 'product_view', 'search', 'cart_add', 'cart_remove', 'checkout_start',
  'favourite_add', 'favourite_remove', 'store_save', 'list_add', 'offer_view', 'assistant_query',
  'cart_abandon'
));

alter table public.customer_events add column if not exists dedupe_key text;
alter table public.customer_events drop constraint if exists customer_events_dedupe_len;
alter table public.customer_events add constraint customer_events_dedupe_len
  check (dedupe_key is null or char_length(dedupe_key) <= 200);

create unique index if not exists customer_events_dedupe_key_uidx
  on public.customer_events (dedupe_key) where dedupe_key is not null;
