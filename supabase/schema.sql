-- Versen internal checkout storage.
-- Amount columns are stored as integer ore, not floating point SEK.

create table if not exists public.checkout_drafts (
  id text primary key,
  user_id text not null,
  email text not null,
  phone text,
  shipping_address jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  subtotal integer not null default 0,
  discount integer not null default 0,
  shipping integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  currency text not null default 'sek',
  cart_id text,
  discount_codes jsonb not null default '[]'::jsonb,
  stripe_payment_intent_id text unique,
  site_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  user_id text not null,
  email text not null,
  phone text,
  shipping_address jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  subtotal integer not null default 0,
  discount integer not null default 0,
  shipping integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  currency text not null default 'sek',
  stripe_payment_intent_id text unique,
  payment_status text not null default 'pending',
  order_status text not null default 'pending',
  shopify_order_id text,
  order_number text,
  shopify_sync_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigserial primary key,
  order_id text not null references public.orders(id) on delete cascade,
  shopify_product_id text,
  shopify_variant_id text not null,
  title text not null,
  quantity integer not null check (quantity > 0),
  unit_price integer not null default 0,
  total_price integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists checkout_drafts_payment_intent_idx
  on public.checkout_drafts (stripe_payment_intent_id);

create index if not exists orders_user_id_idx
  on public.orders (user_id);

create index if not exists orders_email_idx
  on public.orders (lower(email));

create index if not exists orders_payment_intent_idx
  on public.orders (stripe_payment_intent_id);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

alter table public.checkout_drafts enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- No public policies are added. Versen writes/reads orders only through serverless
-- backend endpoints using SUPABASE_SECRET_KEY. Do not expose the secret key in frontend.
