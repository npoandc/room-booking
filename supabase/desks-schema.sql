-- Desk booking system (Hoole office) — full-day bookings.
-- Run once in your Supabase project: SQL Editor → New query → paste → Run.
-- This is separate from the room booking tables and can be run safely
-- alongside them.

-- ── Tables ──────────────────────────────────────────────────────────

create table if not exists public.desk_bookings (
  id           uuid primary key default gen_random_uuid(),
  desk         text not null,
  booked_by    text not null,
  note         text,
  booking_date date not null,
  status       text not null default 'active' check (status in ('active', 'cancelled')),
  created_at   timestamptz not null default now()
);

-- The core guarantee: a desk can only be booked once per day.
create unique index if not exists desk_bookings_no_double
  on public.desk_bookings (desk, booking_date)
  where (status = 'active');

create table if not exists public.desk_booking_changes (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.desk_bookings (id),
  action      text not null check (action in ('change', 'cancel')),
  changed_by  text not null,
  reason      text not null,
  old_desk    text,
  old_date    date,
  new_desk    text,
  new_date    date,
  changed_at  timestamptz not null default now()
);

create index if not exists desk_booking_changes_booking_idx
  on public.desk_booking_changes (booking_id);

-- ── Validation ──────────────────────────────────────────────────────

create or replace function public.validate_desk_booking(
  p_desk text, p_booked_by text, p_date date
) returns void
language plpgsql as $$
begin
  if p_desk is null or p_desk not in
    ('Reception', 'Desk 1', 'Desk 2', 'Desk 3', 'Desk 4', 'Desk 5', 'Desk 6')
  then
    raise exception 'Unknown desk.';
  end if;
  if coalesce(trim(p_booked_by), '') = '' then
    raise exception 'Please enter your name.';
  end if;
  if p_date is null then
    raise exception 'Please pick a date.';
  end if;
  if extract(isodow from p_date) > 5 then
    raise exception 'Desks can only be booked Monday to Friday.';
  end if;
end $$;

-- ── Public API (the only way the website can write) ─────────────────

create or replace function public.create_desk_booking(
  p_desk text, p_booked_by text, p_note text, p_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform validate_desk_booking(p_desk, p_booked_by, p_date);
  begin
    insert into desk_bookings (desk, booked_by, note, booking_date)
    values (p_desk, trim(p_booked_by), nullif(trim(p_note), ''), p_date)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'DESK_TAKEN: % is already booked on that day. Please pick another desk or day.', p_desk;
  end;
  return v_id;
end $$;

create or replace function public.change_desk_booking(
  p_id uuid, p_changed_by text, p_reason text,
  p_desk text, p_date date, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old desk_bookings%rowtype;
begin
  if coalesce(trim(p_changed_by), '') = '' then
    raise exception 'Please enter who is making this change.';
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Please give a reason for this change.';
  end if;

  select * into v_old from desk_bookings where id = p_id and status = 'active' for update;
  if not found then
    raise exception 'Booking not found (it may have been cancelled).';
  end if;

  perform validate_desk_booking(p_desk, v_old.booked_by, p_date);

  begin
    update desk_bookings
       set desk = p_desk,
           booking_date = p_date,
           note = coalesce(nullif(trim(p_note), ''), note)
     where id = p_id;
  exception when unique_violation then
    raise exception 'DESK_TAKEN: % is already booked on that day. Please pick another desk or day.', p_desk;
  end;

  insert into desk_booking_changes
    (booking_id, action, changed_by, reason, old_desk, old_date, new_desk, new_date)
  values
    (p_id, 'change', trim(p_changed_by), trim(p_reason),
     v_old.desk, v_old.booking_date, p_desk, p_date);
end $$;

create or replace function public.cancel_desk_booking(
  p_id uuid, p_changed_by text, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old desk_bookings%rowtype;
begin
  if coalesce(trim(p_changed_by), '') = '' then
    raise exception 'Please enter who is cancelling this booking.';
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Please give a reason for cancelling.';
  end if;

  select * into v_old from desk_bookings where id = p_id and status = 'active' for update;
  if not found then
    raise exception 'Booking not found (it may already have been cancelled).';
  end if;

  update desk_bookings set status = 'cancelled' where id = p_id;

  insert into desk_booking_changes
    (booking_id, action, changed_by, reason, old_desk, old_date)
  values
    (p_id, 'cancel', trim(p_changed_by), trim(p_reason), v_old.desk, v_old.booking_date);
end $$;

-- ── Access control ──────────────────────────────────────────────────

alter table public.desk_bookings enable row level security;
alter table public.desk_booking_changes enable row level security;

create policy "anyone can read desk bookings"
  on public.desk_bookings for select using (true);
create policy "anyone can read the desk change log"
  on public.desk_booking_changes for select using (true);

grant execute on function public.create_desk_booking(text, text, text, date) to anon;
grant execute on function public.change_desk_booking(uuid, text, text, text, date, text) to anon;
grant execute on function public.cancel_desk_booking(uuid, text, text) to anon;
revoke execute on function public.validate_desk_booking(text, text, date) from anon;
