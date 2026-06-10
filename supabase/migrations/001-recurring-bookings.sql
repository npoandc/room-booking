-- Migration: repeating (recurring) bookings.
-- Run on an existing database. Fresh installs get all of this from schema.sql.

alter table public.bookings add column if not exists series_id uuid;
create index if not exists bookings_series_idx on public.bookings (series_id);

-- Books a repeating series as individual bookings sharing a series_id.
-- Dates whose slot is already taken are skipped and reported, the rest
-- are booked. Repeat arithmetic is done in London local time so a 10:00
-- meeting stays at 10:00 across daylight-saving changes.
create or replace function public.create_recurring_booking(
  p_room text, p_title text, p_booked_by text,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_interval_days int, p_until date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_series uuid := gen_random_uuid();
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_local_start timestamp;
  v_local_end timestamp;
  v_i int := 0;
begin
  if p_interval_days not in (7, 14, 28) then
    raise exception 'Repeat must be every 1, 2 or 4 weeks.';
  end if;
  if p_until is null or p_until < (p_starts_at at time zone 'Europe/London')::date then
    raise exception 'Please choose when the repeat should finish.';
  end if;
  if p_until > (p_starts_at at time zone 'Europe/London')::date + 366 then
    raise exception 'Repeating bookings can run for up to one year.';
  end if;

  perform validate_booking(p_room, p_title, p_booked_by, p_starts_at, p_ends_at);

  loop
    v_local_start := (p_starts_at at time zone 'Europe/London') + (v_i * p_interval_days) * interval '1 day';
    exit when v_local_start::date > p_until or v_i >= 60;
    v_local_end := (p_ends_at at time zone 'Europe/London') + (v_i * p_interval_days) * interval '1 day';
    begin
      insert into bookings (room, title, booked_by, starts_at, ends_at, series_id)
      values (p_room, trim(p_title), trim(p_booked_by),
              v_local_start at time zone 'Europe/London',
              v_local_end at time zone 'Europe/London',
              v_series);
      v_created := v_created || to_jsonb(to_char(v_local_start::date, 'YYYY-MM-DD'));
    exception when exclusion_violation then
      v_skipped := v_skipped || to_jsonb(to_char(v_local_start::date, 'YYYY-MM-DD'));
    end;
    v_i := v_i + 1;
  end loop;

  if jsonb_array_length(v_created) = 0 then
    raise exception 'ROOM_TAKEN: % is already booked at that time on every chosen date.', p_room;
  end if;

  return jsonb_build_object('series_id', v_series, 'created', v_created, 'skipped', v_skipped);
end $$;

-- Cancels a booking plus all later bookings in the same series.
create or replace function public.cancel_booking_series(
  p_id uuid, p_changed_by text, p_reason text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_old bookings%rowtype;
  r bookings%rowtype;
  v_n int := 0;
begin
  if coalesce(trim(p_changed_by), '') = '' then
    raise exception 'Please enter who is cancelling this booking.';
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Please give a reason for cancelling.';
  end if;

  select * into v_old from bookings where id = p_id and status = 'active';
  if not found then
    raise exception 'Booking not found (it may already have been cancelled).';
  end if;
  if v_old.series_id is null then
    raise exception 'This booking is not part of a repeating series.';
  end if;

  for r in
    select * from bookings
    where series_id = v_old.series_id and status = 'active' and starts_at >= v_old.starts_at
    for update
  loop
    update bookings set status = 'cancelled', needs_sync = true where id = r.id;
    insert into booking_changes
      (booking_id, action, changed_by, reason, old_room, old_starts_at, old_ends_at)
    values
      (r.id, 'cancel', trim(p_changed_by), trim(p_reason), r.room, r.starts_at, r.ends_at);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

grant execute on function public.create_recurring_booking(text, text, text, timestamptz, timestamptz, int, date) to anon;
grant execute on function public.cancel_booking_series(uuid, text, text) to anon;
