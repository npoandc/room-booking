-- Room booking system — database schema for Supabase.
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

create extension if not exists btree_gist;

-- ── Tables ──────────────────────────────────────────────────────────

create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  room             text not null,
  title            text not null,
  booked_by        text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'active' check (status in ('active', 'cancelled')),
  created_at       timestamptz not null default now(),
  -- Outlook mirroring (used by the GitHub Action in scripts/outlook-sync.mjs)
  outlook_event_id text,
  needs_sync       boolean not null default true,
  constraint ends_after_start check (ends_at > starts_at)
);

-- The core guarantee: two active bookings for the same room can never
-- overlap, even if two people click "Book" at the same instant.
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (room with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'active');

create table if not exists public.booking_changes (
  id            bigint generated always as identity primary key,
  booking_id    uuid not null references public.bookings (id),
  action        text not null check (action in ('change', 'cancel')),
  changed_by    text not null,
  reason        text not null,
  old_room      text,
  old_starts_at timestamptz,
  old_ends_at   timestamptz,
  new_room      text,
  new_starts_at timestamptz,
  new_ends_at   timestamptz,
  changed_at    timestamptz not null default now()
);

create index if not exists booking_changes_booking_idx
  on public.booking_changes (booking_id);

-- ── Validation shared by create and change ──────────────────────────

create or replace function public.validate_booking(
  p_room text, p_title text, p_booked_by text,
  p_starts_at timestamptz, p_ends_at timestamptz
) returns void
language plpgsql as $$
declare
  v_start timestamp := p_starts_at at time zone 'Europe/London';
  v_end   timestamp := p_ends_at   at time zone 'Europe/London';
begin
  if p_room is null or p_room not in
    ('Board Room', 'Room 1', 'Room 2', 'Room 3', 'David Owen Suite', 'Hoole Meeting Room')
  then
    raise exception 'Unknown room.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Please enter a purpose for the booking.';
  end if;
  if coalesce(trim(p_booked_by), '') = '' then
    raise exception 'Please enter your name.';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The end time must be after the start time.';
  end if;
  if v_start::date <> v_end::date then
    raise exception 'A booking must start and end on the same day.';
  end if;
  if extract(isodow from v_start) > 5 then
    raise exception 'Rooms can only be booked Monday to Friday.';
  end if;
  if v_start::time < time '08:00' or v_end::time > time '18:00' then
    raise exception 'Rooms can be booked between 08:00 and 18:00.';
  end if;
end $$;

-- ── Public API (the only way the website can write) ─────────────────

create or replace function public.create_booking(
  p_room text, p_title text, p_booked_by text,
  p_starts_at timestamptz, p_ends_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform validate_booking(p_room, p_title, p_booked_by, p_starts_at, p_ends_at);
  begin
    insert into bookings (room, title, booked_by, starts_at, ends_at)
    values (p_room, trim(p_title), trim(p_booked_by), p_starts_at, p_ends_at)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'ROOM_TAKEN: % is already booked during that time. Please pick another time or room.', p_room;
  end;
  return v_id;
end $$;

create or replace function public.change_booking(
  p_id uuid, p_changed_by text, p_reason text,
  p_room text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_title text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old bookings%rowtype;
begin
  if coalesce(trim(p_changed_by), '') = '' then
    raise exception 'Please enter who is making this change.';
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Please give a reason for this change.';
  end if;

  select * into v_old from bookings where id = p_id and status = 'active' for update;
  if not found then
    raise exception 'Booking not found (it may have been cancelled).';
  end if;

  perform validate_booking(
    p_room, coalesce(p_title, v_old.title), v_old.booked_by, p_starts_at, p_ends_at);

  begin
    update bookings
       set room = p_room,
           title = coalesce(trim(p_title), title),
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           needs_sync = true
     where id = p_id;
  exception when exclusion_violation then
    raise exception 'ROOM_TAKEN: % is already booked during that time. Please pick another time or room.', p_room;
  end;

  insert into booking_changes
    (booking_id, action, changed_by, reason,
     old_room, old_starts_at, old_ends_at,
     new_room, new_starts_at, new_ends_at)
  values
    (p_id, 'change', trim(p_changed_by), trim(p_reason),
     v_old.room, v_old.starts_at, v_old.ends_at,
     p_room, p_starts_at, p_ends_at);
end $$;

create or replace function public.cancel_booking(
  p_id uuid, p_changed_by text, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old bookings%rowtype;
begin
  if coalesce(trim(p_changed_by), '') = '' then
    raise exception 'Please enter who is cancelling this booking.';
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Please give a reason for cancelling.';
  end if;

  select * into v_old from bookings where id = p_id and status = 'active' for update;
  if not found then
    raise exception 'Booking not found (it may already have been cancelled).';
  end if;

  update bookings set status = 'cancelled', needs_sync = true where id = p_id;

  insert into booking_changes
    (booking_id, action, changed_by, reason, old_room, old_starts_at, old_ends_at)
  values
    (p_id, 'cancel', trim(p_changed_by), trim(p_reason),
     v_old.room, v_old.starts_at, v_old.ends_at);
end $$;

-- ── Access control ──────────────────────────────────────────────────
-- The website (anon key) may READ bookings and the change log, but all
-- writes must go through the three functions above, which enforce the
-- office-hours rules and the who/why audit trail.

alter table public.bookings enable row level security;
alter table public.booking_changes enable row level security;

create policy "anyone can read bookings"
  on public.bookings for select using (true);
create policy "anyone can read the change log"
  on public.booking_changes for select using (true);

grant execute on function public.create_booking(text, text, text, timestamptz, timestamptz) to anon;
grant execute on function public.change_booking(uuid, text, text, text, timestamptz, timestamptz, text) to anon;
grant execute on function public.cancel_booking(uuid, text, text) to anon;
revoke execute on function public.validate_booking(text, text, text, timestamptz, timestamptz) from anon;
