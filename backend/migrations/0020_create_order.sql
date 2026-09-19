-- 0020_create_order.sql — atomic order creation. Checklist 7.4 – 7.9.
--
-- Everything an order needs is written in ONE transaction: the order, its
-- items, the first status-history entry, the payment intent, the stock
-- decrement, and the cart being marked checked out. Doing this from the API in
-- six round trips would leave an order with no items, or a decremented stock
-- with no order, the first time a request died halfway.
--
-- The API prices the basket (src/lib/pricing.js) and passes the result in;
-- this function re-checks availability and stock under the row locks it takes,
-- which is what actually stops two simultaneous orders overselling the last
-- unit. It never re-prices — one pricing engine, in one place (D26).
--
-- Returns: { order_id, order_number, replayed }

create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id     uuid := (payload ->> 'customer_id')::uuid;
  v_store_id        uuid := (payload ->> 'store_id')::uuid;
  v_cart_id         uuid := nullif(payload ->> 'cart_id', '')::uuid;
  v_idempotency_key text := nullif(payload ->> 'idempotency_key', '');
  v_status          order_status := (payload ->> 'status')::order_status;
  v_order_id        uuid;
  v_order_number    text;
  v_item            jsonb;
  v_product_id      uuid;
  v_variant_id      uuid;
  v_quantity        integer;
  v_updated         integer;
begin
  -- Checklist 7.5. A replayed Idempotency-Key returns the original order
  -- instead of creating a second one. Checked first so a retry after a network
  -- timeout is cheap and side-effect free.
  if v_idempotency_key is not null then
    select id, order_number into v_order_id, v_order_number
      from public.orders
     where customer_id = v_customer_id
       and idempotency_key = v_idempotency_key;

    if found then
      return jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'replayed', true
      );
    end if;
  end if;

  insert into public.orders (
    store_id, customer_id, fulfilment_mode, status, payment_status,
    address_id, delivery_address, store_snapshot,
    subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
    customer_note, idempotency_key
  ) values (
    v_store_id,
    v_customer_id,
    (payload ->> 'fulfilment_mode')::fulfilment_mode,
    v_status,
    (payload ->> 'payment_status')::payment_status,
    nullif(payload ->> 'address_id', '')::uuid,
    payload -> 'delivery_address',
    payload -> 'store_snapshot',
    (payload ->> 'subtotal_paise')::integer,
    (payload ->> 'discount_paise')::integer,
    (payload ->> 'delivery_fee_paise')::integer,
    (payload ->> 'tax_paise')::integer,
    (payload ->> 'total_paise')::integer,
    nullif(payload ->> 'customer_note', ''),
    v_idempotency_key
  )
  returning id, order_number into v_order_id, v_order_number;

  -- Items + stock, one line at a time so the failure message can name the
  -- product the customer has to remove.
  for v_item in select * from jsonb_array_elements(payload -> 'items')
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    v_quantity   := (v_item ->> 'quantity')::integer;

    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_name,
      image_url, unit_price_paise, quantity, line_total_paise
    ) values (
      v_order_id,
      v_product_id,
      v_variant_id,
      v_item ->> 'product_name',
      nullif(v_item ->> 'variant_name', ''),
      nullif(v_item ->> 'image_url', ''),
      (v_item ->> 'unit_price_paise')::integer,
      v_quantity,
      (v_item ->> 'line_total_paise')::integer
    );

    -- Availability is re-checked HERE, inside the transaction, because the
    -- customer's cart was validated seconds ago and the merchant may have
    -- changed something since.
    if v_variant_id is not null then
      update public.product_variants
         set stock = case when stock is null then null else stock - v_quantity end
       where id = v_variant_id
         and is_available
         and (stock is null or stock >= v_quantity);
    else
      update public.products
         set stock = case when stock is null then null else stock - v_quantity end
       where id = v_product_id
         and store_id = v_store_id
         and is_available
         and (stock is null or stock >= v_quantity);
    end if;

    get diagnostics v_updated = row_count;

    -- Zero rows updated means the item went unavailable or sold out between
    -- the quote and now. Raising rolls the whole order back (checklist 7.16).
    if v_updated = 0 then
      raise exception 'ITEM_UNAVAILABLE:%', coalesce(v_item ->> 'product_name', 'An item')
        using errcode = 'P0001';
    end if;
  end loop;

  -- Checklist 1.11 / 8.3: the timeline starts with the state the order was
  -- born in, so "placed at" and "awaiting payment since" are both answerable.
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order_id, null, v_status, 'customer', payload ->> 'history_note');

  -- Checklist 7.6. The payment intent is part of the same transaction, so an
  -- online order can never exist without the row that tracks its payment.
  if payload -> 'payment' is not null and payload -> 'payment' <> 'null'::jsonb then
    insert into public.payments (order_id, provider, amount_paise, currency, status)
    values (
      v_order_id,
      payload -> 'payment' ->> 'provider',
      (payload -> 'payment' ->> 'amount_paise')::integer,
      coalesce(payload -> 'payment' ->> 'currency', 'INR'),
      coalesce((payload -> 'payment' ->> 'status')::payment_status, 'pending')
    );
  end if;

  -- Checklist 7.9. The cart is emptied only once everything above succeeded;
  -- a rollback leaves the customer's basket exactly as it was.
  if v_cart_id is not null then
    update public.carts set checked_out_at = now() where id = v_cart_id and customer_id = v_customer_id;
    delete from public.cart_items where cart_id = v_cart_id;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'replayed', false
  );
end;
$$;

-- Only the service role calls this; RLS on the underlying tables still applies
-- to everyone else.
revoke all on function public.create_order(jsonb) from public, anon, authenticated;
