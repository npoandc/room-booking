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
  department   text,
  booking_date date not null,
  status       text not null default 'active' check (status in ('active', 'cancelled')),
  created_at   timestamptz not null default now(),
  series_id    uuid
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
  p_desk text, p_booked_by text, p_note text, p_date date, p_department text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform validate_desk_booking(p_desk, p_booked_by, p_date);
  if p_department is null or p_department not in (
    'IT','People','Client Services','Admin','ID','PI','Clin Neg','Conveyancing',
    'Commercial Property','Corporate & Commercial','Family','Accounts',
    'Wills & Probate','Litigation & Disputes','Ops','Marketing'
  ) then
    raise exception 'Please choose a department.';
  end if;
  begin
    insert into desk_bookings (desk, booked_by, note, booking_date, department)
    values (p_desk, trim(p_booked_by), nullif(trim(p_note), ''), p_date, p_department)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'DESK_TAKEN: % is already booked on that day. Please pick another desk or day.', p_desk;
  end;
  return v_id;
end $$;

create or replace function public.change_desk_booking(
  p_id uuid, p_changed_by text, p_reason text,
  p_desk text, p_date date, p_note text default null, p_department text default null
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
  if p_department is not null and p_department not in (
    'IT','People','Client Services','Admin','ID','PI','Clin Neg','Conveyancing',
    'Commercial Property','Corporate & Commercial','Family','Accounts',
    'Wills & Probate','Litigation & Disputes','Ops','Marketing'
  ) then
    raise exception 'Please choose a valid department.';
  end if;

  begin
    update desk_bookings
       set desk = p_desk,
           booking_date = p_date,
           note = coalesce(nullif(trim(p_note), ''), note),
           department = coalesce(p_department, department)
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

grant execute on function public.create_desk_booking(text, text, text, date, text) to anon;
grant execute on function public.change_desk_booking(uuid, text, text, text, date, text, text) to anon;
grant execute on function public.cancel_desk_booking(uuid, text, text) to anon;
revoke execute on function public.validate_desk_booking(text, text, date) from anon;

-- ── Recurring bookings (series support) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.create_recurring_desk_booking(
  p_desk        text,
  p_booked_by   text,
  p_note        text,
  p_booking_date date,
  p_department  text,
  p_interval_days int,
  p_until       date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_series  uuid := gen_random_uuid();
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_date    date;
  v_i       int := 0;
BEGIN
  PERFORM validate_desk_booking(p_desk, p_booked_by, p_booking_date);
  IF p_interval_days NOT IN (7, 14, 21, 28, 42, 56) THEN
    RAISE EXCEPTION 'Repeat interval must be 1, 2, 3, 4, 6, or 8 weeks.';
  END IF;
  IF p_until IS NULL OR p_until < p_booking_date THEN
    RAISE EXCEPTION 'Please choose when the repeat should finish.';
  END IF;
  IF p_until > p_booking_date + 366 THEN
    RAISE EXCEPTION 'Repeating bookings can run for up to one year.';
  END IF;

  LOOP
    v_date := p_booking_date + (v_i * p_interval_days);
    EXIT WHEN v_date > p_until OR v_i >= 60;
    BEGIN
      INSERT INTO desk_bookings (desk, booked_by, note, booking_date, department, series_id)
      VALUES (p_desk, TRIM(p_booked_by), NULLIF(TRIM(COALESCE(p_note,'')), ''), v_date, p_department, v_series);
      v_created := v_created || to_jsonb(to_char(v_date, 'YYYY-MM-DD'));
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped || to_jsonb(to_char(v_date, 'YYYY-MM-DD'));
    END;
    v_i := v_i + 1;
  END LOOP;

  IF jsonb_array_length(v_created) = 0 THEN
    RAISE EXCEPTION 'DESK_TAKEN: % is already booked on every chosen date.', p_desk;
  END IF;

  RETURN jsonb_build_object('series_id', v_series, 'created', v_created, 'skipped', v_skipped);
END $$;

CREATE OR REPLACE FUNCTION public.create_monthly_desk_booking(
  p_desk        text,
  p_booked_by   text,
  p_note        text,
  p_booking_date date,
  p_department  text,
  p_nth         int,
  p_weekday     int,
  p_until       date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_series      uuid := gen_random_uuid();
  v_created     jsonb := '[]'::jsonb;
  v_skipped     jsonb := '[]'::jsonb;
  v_year        int;
  v_month       int;
  v_month_start date;
  v_occurrences date[];
  v_count       int;
  v_candidate   date;
  v_d           date;
BEGIN
  PERFORM validate_desk_booking(p_desk, p_booked_by, p_booking_date);
  IF p_nth NOT IN (1, 2, 3, 4, -1) THEN
    RAISE EXCEPTION 'Which must be 1st, 2nd, 3rd, 4th, or Last.';
  END IF;
  IF p_weekday NOT IN (0, 1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Day must be Monday through Friday.';
  END IF;
  IF p_until IS NULL OR p_until < p_booking_date THEN
    RAISE EXCEPTION 'Please choose when the repeat should finish.';
  END IF;
  IF p_until > p_booking_date + 365 THEN
    RAISE EXCEPTION 'Monthly bookings can run for up to one year.';
  END IF;

  v_year  := EXTRACT(YEAR  FROM p_booking_date)::int;
  v_month := EXTRACT(MONTH FROM p_booking_date)::int;

  FOR i IN 0..23 LOOP
    v_month_start := make_date(v_year, v_month, 1);
    EXIT WHEN v_month_start > p_until;

    v_occurrences := ARRAY[]::date[];
    v_d := v_month_start;
    WHILE EXTRACT(MONTH FROM v_d) = v_month LOOP
      IF (EXTRACT(ISODOW FROM v_d)::int - 1) = p_weekday THEN
        v_occurrences := v_occurrences || v_d;
      END IF;
      v_d := v_d + 1;
    END LOOP;

    v_count := COALESCE(array_length(v_occurrences, 1), 0);
    v_candidate := NULL;
    IF v_count > 0 THEN
      IF p_nth > 0 AND p_nth <= v_count THEN
        v_candidate := v_occurrences[p_nth];
      ELSIF p_nth = -1 THEN
        v_candidate := v_occurrences[v_count];
      END IF;
    END IF;

    IF v_candidate IS NOT NULL
       AND v_candidate >= p_booking_date
       AND v_candidate <= p_until THEN
      BEGIN
        INSERT INTO desk_bookings (desk, booked_by, note, booking_date, department, series_id)
        VALUES (p_desk, TRIM(p_booked_by), NULLIF(TRIM(COALESCE(p_note,'')), ''), v_candidate, p_department, v_series);
        v_created := v_created || to_jsonb(to_char(v_candidate, 'YYYY-MM-DD'));
      EXCEPTION WHEN unique_violation THEN
        v_skipped := v_skipped || to_jsonb(to_char(v_candidate, 'YYYY-MM-DD'));
      END;
    END IF;

    v_month := v_month + 1;
    IF v_month > 12 THEN v_month := 1; v_year := v_year + 1; END IF;
  END LOOP;

  IF jsonb_array_length(v_created) = 0 THEN
    RAISE EXCEPTION 'DESK_TAKEN: % is already booked on every chosen date.', p_desk;
  END IF;

  RETURN jsonb_build_object('series_id', v_series, 'created', v_created, 'skipped', v_skipped);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_desk_booking_series(
  p_id         uuid,
  p_changed_by text,
  p_reason     text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_series  uuid;
  v_date    date;
  v_ids     uuid[];
  v_row     desk_bookings%rowtype;
BEGIN
  IF COALESCE(TRIM(p_changed_by), '') = '' THEN
    RAISE EXCEPTION 'Please enter who is cancelling this booking.';
  END IF;
  IF LENGTH(COALESCE(TRIM(p_reason), '')) < 3 THEN
    RAISE EXCEPTION 'Please give a reason for cancelling.';
  END IF;

  SELECT series_id, booking_date INTO v_series, v_date
    FROM desk_bookings WHERE id = p_id AND status = 'active';
  IF NOT FOUND OR v_series IS NULL THEN
    RAISE EXCEPTION 'Booking not found or not part of a series.';
  END IF;

  SELECT array_agg(id) INTO v_ids
    FROM desk_bookings
   WHERE series_id = v_series
     AND booking_date >= v_date
     AND status = 'active';

  UPDATE desk_bookings SET status = 'cancelled'
   WHERE id = ANY(v_ids);

  INSERT INTO desk_booking_changes
    (booking_id, action, changed_by, reason, old_desk, old_date)
  SELECT id, 'cancel', TRIM(p_changed_by), TRIM(p_reason), desk, booking_date
    FROM desk_bookings WHERE id = ANY(v_ids);

  RETURN array_length(v_ids, 1);
END $$;

GRANT EXECUTE ON FUNCTION public.create_recurring_desk_booking(text,text,text,date,text,int,date) TO anon;
GRANT EXECUTE ON FUNCTION public.create_monthly_desk_booking(text,text,text,date,text,int,int,date) TO anon;
GRANT EXECUTE ON FUNCTION public.cancel_desk_booking_series(uuid,text,text) TO anon;
