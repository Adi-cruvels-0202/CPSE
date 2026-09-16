-- 0007_product_images.sql — Checklist 1.5.
-- Separate table rather than an array column: each image carries its own alt
-- text and position, and the gallery is paged independently of the product row.

create table if not exists public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  url         text not null,
  alt_text    text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint product_images_url_len check (char_length(url) between 1 and 2048)
);

create index if not exists product_images_product_id_idx
  on public.product_images (product_id, sort_order);
