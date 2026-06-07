-- ===========================================================================
-- Matmatch — database schema + Row Level Security
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: uses "if not exists" / "drop policy if exists".
-- ===========================================================================

-- Enums --------------------------------------------------------------------
do $$ begin
  create type role as enum ('teacher', 'school');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum ('pending', 'accepted', 'declined', 'cancelled');
exception when duplicate_object then null; end $$;

-- profiles -----------------------------------------------------------------
-- One row per auth user. Holds which side of the marketplace they are.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        role not null,
  full_name   text not null,
  phone       text,
  created_at  timestamptz not null default now()
);

-- teacher_profiles ---------------------------------------------------------
create table if not exists public.teacher_profiles (
  id               uuid primary key references public.profiles (id) on delete cascade,
  headline         text not null default '',
  bio              text not null default '',
  city             text not null default '',
  styles           text[] not null default '{}',
  languages        text[] not null default '{}',
  certifications   text,
  experience_years int not null default 0,
  hourly_rate      numeric(8,2),
  travel_radius_km int not null default 25,
  photo_url        text,
  is_published     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- availability_slots -------------------------------------------------------
-- Weekly recurring availability (weekday 0 = Sunday … 6 = Saturday).
create table if not exists public.availability_slots (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.teacher_profiles (id) on delete cascade,
  weekday     int not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  check (end_time > start_time)
);
create index if not exists availability_slots_teacher_idx
  on public.availability_slots (teacher_id);

-- school_profiles ----------------------------------------------------------
create table if not exists public.school_profiles (
  id          uuid primary key references public.profiles (id) on delete cascade,
  name        text not null default '',
  city        text not null default '',
  address     text,
  website     text,
  about       text,
  created_at  timestamptz not null default now()
);

-- bookings -----------------------------------------------------------------
create table if not exists public.bookings (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.school_profiles (id) on delete cascade,
  teacher_id    uuid not null references public.teacher_profiles (id) on delete cascade,
  date          date not null,
  start_time    time not null,
  end_time      time not null,
  style         text not null default '',
  location      text,
  message       text,
  proposed_rate numeric(8,2),
  status        booking_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists bookings_teacher_idx on public.bookings (teacher_id);
create index if not exists bookings_school_idx  on public.bookings (school_id);

-- updated_at trigger -------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_teacher_profiles_touch on public.teacher_profiles;
create trigger trg_teacher_profiles_touch before update on public.teacher_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_bookings_touch on public.bookings;
create trigger trg_bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.profiles          enable row level security;
alter table public.teacher_profiles  enable row level security;
alter table public.availability_slots enable row level security;
alter table public.school_profiles    enable row level security;
alter table public.bookings           enable row level security;

-- profiles: anyone signed in can read (needed to show names); you write yours
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id);

-- teacher_profiles: published profiles are world-readable; owner reads/writes own
drop policy if exists teacher_read_published on public.teacher_profiles;
create policy teacher_read_published on public.teacher_profiles
  for select using (is_published = true or auth.uid() = id);

drop policy if exists teacher_insert_self on public.teacher_profiles;
create policy teacher_insert_self on public.teacher_profiles
  for insert with check (auth.uid() = id);

drop policy if exists teacher_update_self on public.teacher_profiles;
create policy teacher_update_self on public.teacher_profiles
  for update using (auth.uid() = id);

-- availability: readable by anyone (to show on a profile); owner manages own
drop policy if exists avail_read on public.availability_slots;
create policy avail_read on public.availability_slots
  for select using (true);

drop policy if exists avail_write_own on public.availability_slots;
create policy avail_write_own on public.availability_slots
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- school_profiles: signed-in users can read (teacher sees who booked); owner writes own
drop policy if exists school_read on public.school_profiles;
create policy school_read on public.school_profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists school_insert_self on public.school_profiles;
create policy school_insert_self on public.school_profiles
  for insert with check (auth.uid() = id);

drop policy if exists school_update_self on public.school_profiles;
create policy school_update_self on public.school_profiles
  for update using (auth.uid() = id);

-- bookings: visible to the two parties; school creates; either party updates status
drop policy if exists bookings_read_parties on public.bookings;
create policy bookings_read_parties on public.bookings
  for select using (auth.uid() = school_id or auth.uid() = teacher_id);

drop policy if exists bookings_insert_school on public.bookings;
create policy bookings_insert_school on public.bookings
  for insert with check (auth.uid() = school_id);

drop policy if exists bookings_update_parties on public.bookings;
create policy bookings_update_parties on public.bookings
  for update using (auth.uid() = school_id or auth.uid() = teacher_id);

-- ===========================================================================
-- Auto-create profile rows on sign-up
-- The app passes role + full_name as auth metadata; this trigger (which runs as
-- the table owner and so bypasses RLS) creates the profiles + role-specific row.
-- This means profile creation never depends on the browser having a session yet.
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role role;
  v_name text;
begin
  v_role := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'teacher')::role;
  v_name := coalesce(new.raw_user_meta_data ->> 'full_name', '');

  insert into public.profiles (id, role, full_name)
    values (new.id, v_role, v_name)
    on conflict (id) do nothing;

  if v_role = 'teacher' then
    insert into public.teacher_profiles (id)
      values (new.id) on conflict (id) do nothing;
  else
    insert into public.school_profiles (id, name)
      values (new.id, v_name) on conflict (id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- Done. Sign-up (email + password) happens via Supabase Auth in the app; the
-- trigger above creates the matching profiles / teacher_profiles / school_profiles
-- rows automatically from the auth metadata.
-- ===========================================================================
