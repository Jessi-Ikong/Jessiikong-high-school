-- 2. Org structure: sessions, terms, classes, sections, subjects, periods

-- Internal schema for helpers, triggers and bookkeeping. It is NOT exposed
-- through the Supabase API (only "public" is), so nothing here is callable
-- directly by clients.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Academic session / year, e.g. '2026/2027'.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint sessions_dates_check check (end_date > start_date)
);
create unique index sessions_one_current_idx on public.sessions (is_current) where is_current;

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete restrict,
  name text not null,                       -- e.g. 'First Term'
  term_number smallint not null check (term_number between 1 and 3),
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint terms_dates_check check (end_date > start_date),
  unique (session_id, term_number),
  unique (session_id, name)
);
create unique index terms_one_current_idx on public.terms (is_current) where is_current;

-- A class level, e.g. JSS1 ... SS3. `level` orders classes for promotion.
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  level smallint not null unique check (level > 0),
  created_at timestamptz not null default now()
);

-- An arm of a class, e.g. JSS1 'A'.
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  unique (class_id, name),
  -- lets other tables prove a section belongs to a given class
  unique (id, class_id)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,
  description text,
  created_at timestamptz not null default now()
);

-- Fixed daily periods, e.g. 'Period 1' 08:00–08:40.
create table public.periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_time time not null,
  end_time time not null,
  is_break boolean not null default false,
  created_at timestamptz not null default now(),
  constraint periods_times_check check (end_time > start_time)
);
