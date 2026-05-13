-- Versen admin dashboard additions.
-- Safe to run more than once. Do not drop existing tables.

alter table public.subscriptions
  add column if not exists amount integer not null default 0,
  add column if not exists currency text not null default 'sek',
  add column if not exists interval text,
  add column if not exists price_id text,
  add column if not exists updated_at timestamptz not null default now();

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

alter table public.abandoned_checkouts enable row level security;
alter table public.support_tickets enable row level security;
alter table public.admin_activity_log enable row level security;
alter table public.admin_settings enable row level security;
