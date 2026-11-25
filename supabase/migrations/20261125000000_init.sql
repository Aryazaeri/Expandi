-- Expandi — personal finance dashboard schema
-- Every user-owned table is protected by row-level security (user_id = auth.uid()).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  -- secret used by the SMS / e-mail webhooks to identify you
  ingest_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  income_baseline numeric(14, 2),
  annual_inflation numeric(6, 4) not null default 0.30,
  emergency_months int not null default 6,
  min_savings_rate numeric(5, 4) not null default 0.10,
  ai_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- accounts
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  bank text not null default 'other' check (bank in ('isbank', 'vakifbank', 'ziraat', 'papara', 'other')),
  type text not null default 'checking' check (type in ('checking', 'credit_card', 'wallet', 'cash', 'savings', 'investment')),
  currency text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR', 'GBP', 'XAU')),
  last4 text,
  balance numeric(16, 2),
  balance_updated_at timestamptz,
  include_in_net_worth boolean not null default true,
  created_at timestamptz not null default now()
);
create index accounts_user_idx on public.accounts (user_id);

-- ---------------------------------------------------------------- categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text,
  name text not null,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  icon text not null default 'Circle',
  color text not null default '#71717a',
  is_fixed boolean not null default false,
  is_essential boolean not null default false,
  monthly_budget numeric(14, 2),
  sort int not null default 100,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);
create index categories_user_idx on public.categories (user_id);

-- ---------------------------------------------------------------- transactions
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  occurred_at timestamptz not null,
  amount numeric(16, 2) not null,            -- signed, original currency (negative = money out)
  currency text not null default 'TRY',
  amount_try numeric(16, 2) not null,        -- signed, converted at import time
  description text not null default '',
  merchant text,
  counterparty text,
  category_id uuid references public.categories (id) on delete set null,
  source text not null default 'manual' check (source in ('sms', 'email', 'statement', 'manual', 'ai')),
  status text not null default 'confirmed' check (status in ('confirmed', 'review')),
  installments int,
  notes text,
  raw_text text,
  raw_hash text,
  created_at timestamptz not null default now()
);
create index transactions_user_date_idx on public.transactions (user_id, occurred_at desc);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_account_idx on public.transactions (account_id);
-- the same SMS / e-mail can never be imported twice (NULLs don't collide)
alter table public.transactions add constraint transactions_raw_hash_uq unique (user_id, raw_hash);

-- ---------------------------------------------------------------- learned category rules
create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pattern text not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, pattern)
);
create index category_rules_category_idx on public.category_rules (category_id);

-- ---------------------------------------------------------------- goals
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  target_amount numeric(16, 2) not null check (target_amount > 0),
  saved_amount numeric(16, 2) not null default 0,
  currency text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR', 'GBP', 'XAU')),
  target_date date,
  is_emergency_fund boolean not null default false,
  created_at timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id);

-- ---------------------------------------------------------------- ingest log / review queue
create table public.ingest_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('sms', 'email', 'statement')),
  sender text,
  raw text not null,
  status text not null check (status in ('parsed', 'ai_parsed', 'ignored', 'failed', 'duplicate', 'dismissed')),
  reason text,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ingest_events_user_idx on public.ingest_events (user_id, created_at desc);
create index ingest_events_tx_idx on public.ingest_events (transaction_id);

-- ---------------------------------------------------------------- FX rates (shared, written by the server)
create table public.fx_rates (
  code text not null check (code in ('USD', 'EUR', 'GBP', 'XAU')),
  rate_date date not null,
  rate numeric(16, 6) not null,  -- TRY per 1 unit (XAU = per gram)
  source text not null,
  created_at timestamptz not null default now(),
  primary key (code, rate_date)
);

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.category_rules enable row level security;
alter table public.goals enable row level security;
alter table public.ingest_events enable row level security;
alter table public.fx_rates enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own accounts" on public.accounts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own categories" on public.categories
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own transactions" on public.transactions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rules" on public.category_rules
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own goals" on public.goals
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own ingest events" on public.ingest_events
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "rates readable" on public.fx_rates
  for select to authenticated using (true);

-- ---------------------------------------------------------------- new user bootstrap
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.categories (user_id, slug, name, kind, icon, color, is_fixed, is_essential, sort)
  select new.id, v.slug, v.name, v.kind, v.icon, v.color, v.is_fixed, v.is_essential, v.sort
  from (values
      ('groceries', 'Groceries', 'expense', 'ShoppingBasket', '#16a34a', false, true, 0),
      ('food-delivery', 'Food delivery', 'expense', 'Bike', '#f97316', false, false, 1),
      ('dining', 'Dining & cafés', 'expense', 'Coffee', '#ea580c', false, false, 2),
      ('transport', 'Transport & fuel', 'expense', 'Car', '#0ea5e9', false, true, 3),
      ('housing', 'Rent & housing', 'expense', 'Home', '#7c3aed', true, true, 4),
      ('bills', 'Bills & utilities', 'expense', 'Zap', '#eab308', true, true, 5),
      ('subscriptions', 'Subscriptions', 'expense', 'Repeat', '#db2777', false, false, 6),
      ('shopping', 'Shopping', 'expense', 'ShoppingBag', '#e11d48', false, false, 7),
      ('entertainment', 'Entertainment', 'expense', 'Clapperboard', '#9333ea', false, false, 8),
      ('health', 'Health', 'expense', 'HeartPulse', '#ef4444', false, true, 9),
      ('personal-care', 'Personal care', 'expense', 'Sparkles', '#f472b6', false, false, 10),
      ('education', 'Education', 'expense', 'GraduationCap', '#2563eb', false, false, 11),
      ('travel', 'Travel', 'expense', 'Plane', '#06b6d4', false, false, 12),
      ('cash', 'Cash withdrawal', 'expense', 'Banknote', '#65a30d', false, false, 13),
      ('fees', 'Fees & interest', 'expense', 'Percent', '#b91c1c', false, false, 14),
      ('gifts', 'Gifts & donations', 'expense', 'Gift', '#c026d3', false, false, 15),
      ('other', 'Other', 'expense', 'CircleDashed', '#71717a', false, false, 16),
      ('income', 'Income', 'income', 'Wallet', '#059669', false, false, 17),
      ('refunds', 'Refunds', 'income', 'Undo2', '#10b981', false, false, 18),
      ('interest-income', 'Interest & returns', 'income', 'TrendingUp', '#14b8a6', false, false, 19),
      ('other-income', 'Other income', 'income', 'PiggyBank', '#34d399', false, false, 20),
      ('transfer', 'Transfers (own accounts)', 'transfer', 'ArrowLeftRight', '#64748b', false, false, 21),
      ('card-payment', 'Credit card payment', 'transfer', 'CreditCard', '#475569', false, false, 22),
      ('investments', 'Savings & investments', 'transfer', 'Landmark', '#0f766e', false, false, 23)
  ) as v (slug, name, kind, icon, color, is_fixed, is_essential, sort);

  insert into public.accounts (user_id, name, bank, type) values
    (new.id, 'İşbank', 'isbank', 'checking'),
    (new.id, 'VakıfBank', 'vakifbank', 'checking'),
    (new.id, 'Ziraat', 'ziraat', 'checking'),
    (new.id, 'Papara', 'papara', 'wallet');
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- rotate the webhook token from the app
create or replace function public.rotate_ingest_token()
returns text
language sql
security invoker
set search_path = ''
as $$
  update public.profiles
     set ingest_token = encode(extensions.gen_random_bytes(24), 'hex')
   where id = (select auth.uid())
  returning ingest_token;
$$;

revoke execute on function public.rotate_ingest_token() from public, anon;
grant execute on function public.rotate_ingest_token() to authenticated;
