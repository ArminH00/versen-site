-- Versen internal account, membership, and checkout storage.
-- Amount columns are stored as integer ore, not floating point SEK.

create table if not exists public.profiles (
  id text primary key,
  email text not null unique,
  phone text,
  first_name text,
  last_name text,
  stripe_customer_id text unique,
  shopify_customer_id text,
  membership_status text not null default 'inactive',
  membership_subscription_id text,
  preferences jsonb not null default '{}'::jsonb,
  product_suggestions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id bigserial primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  first_name text,
  last_name text,
  address1 text not null,
  address2 text,
  postal_code text not null,
  city text not null,
  country text not null default 'Sverige',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.subscriptions (
  id text primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text not null unique,
  status text not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.emails (
  id bigserial primary key,
  user_id text,
  order_id text,
  type text not null,
  resend_email_id text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create table if not exists public.abandoned_checkouts (
  id text primary key,
  user_id text,
  email text not null,
  name text,
  phone text,
  items jsonb not null default '[]'::jsonb,
  cart_value integer not null default 0,
  currency text not null default 'sek',
  status text not null default 'open',
  latest_activity text,
  contacted_at timestamptz,
  last_contacted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id text primary key,
  user_id text,
  order_id text,
  email text,
  name text,
  subject text,
  category text not null default 'övrigt',
  status text not null default 'open',
  priority text not null default 'normal',
  unread boolean not null default true,
  message text,
  messages jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_activity_log (
  id bigserial primary key,
  actor text not null default 'admin',
  action text not null,
  target_type text,
  target_id text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists order_number text,
  add column if not exists shopify_sync_error jsonb,
  add column if not exists tracking_url text,
  add column if not exists tracking_number text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists product_suggestions jsonb not null default '[]'::jsonb;

create index if not exists checkout_drafts_payment_intent_idx
  on public.checkout_drafts (stripe_payment_intent_id);

create index if not exists profiles_email_idx
  on public.profiles (lower(email));

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);

create index if not exists addresses_user_id_idx
  on public.addresses (user_id);

create index if not exists orders_user_id_idx
  on public.orders (user_id);

create index if not exists orders_email_idx
  on public.orders (lower(email));

create index if not exists orders_payment_intent_idx
  on public.orders (stripe_payment_intent_id);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create index if not exists subscriptions_user_id_idx
  on public.subscriptions (user_id);

create index if not exists subscriptions_stripe_id_idx
  on public.subscriptions (stripe_subscription_id);

create index if not exists emails_user_id_idx
  on public.emails (user_id);

create index if not exists emails_order_id_idx
  on public.emails (order_id);

create index if not exists abandoned_checkouts_email_idx
  on public.abandoned_checkouts (lower(email));

create index if not exists abandoned_checkouts_status_idx
  on public.abandoned_checkouts (status);

create index if not exists support_tickets_email_idx
  on public.support_tickets (lower(email));

create index if not exists support_tickets_status_idx
  on public.support_tickets (status);

create index if not exists support_tickets_category_idx
  on public.support_tickets (category);

create index if not exists admin_activity_target_idx
  on public.admin_activity_log (target_type, target_id);

alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.checkout_drafts enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.subscriptions enable row level security;
alter table public.emails enable row level security;
alter table public.abandoned_checkouts enable row level security;
alter table public.support_tickets enable row level security;
alter table public.admin_activity_log enable row level security;
alter table public.admin_settings enable row level security;

-- No public policies are added. Versen writes/reads records only through serverless
-- backend endpoints using SUPABASE_SECRET_KEY. Do not expose the secret key in frontend.
