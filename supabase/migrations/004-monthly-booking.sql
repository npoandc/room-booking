-- Migration 004: monthly recurring bookings + fix weekly interval validation

-- Fix create_recurring_booking to accept 21, 42, 56 day intervals
CREATE OR REPLACE FUNCTION public.create_recurring_booking(
  p_room text, p_title text, p_booked_by text,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_interval_days int, p_until date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_series uuid := gen_random_uuid();
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_local_start timestamp;
  v_local_end timestamp;
  v_i int := 0;
BEGIN
  IF p_interval_days NOT IN (7, 14, 21, 28, 42, 56) THEN
    RAISE EXCEPTION 'Repeat interval must be 1, 2, 3, 4, 6, or 8 weeks.';
  END IF;
  IF p_until IS NULL OR p_until < (p_starts_at AT TIME ZONE 'Europe/London')::date THEN
    RAISE EXCEPTION 'Please choose when the repeat should finish.';
  END IF;
  IF p_until > (p_starts_at AT TIME ZONE 'Europe/London')::date + 366 THEN
    RAISE EXCEPTION 'Repeating bookings can run for up to one year.';
  END IF;

  PERFORM validate_booking(p_room, p_title, p_booked_by, p_starts_at, p_ends_at);

  LOOP
    v_local_start := (p_starts_at AT TIME ZONE 'Europe/London') + (v_i * p_interval_days) * INTERVAL '1 day';
    EXIT WHEN v_local_start::date > p_until OR v_i >= 60;
    v_local_end := (p_ends_at AT TIME ZONE 'Europe/London') + (v_i * p_interval_days) * INTERVAL '1 day';
    BEGIN
      INSERT INTO bookings (room, title, booked_by, starts_at, ends_at, series_id)
      VALUES (p_room, TRIM(p_title), TRIM(p_booked_by),
              v_local_start AT TIME ZONE 'Europe/London',
              v_local_end   AT TIME ZONE 'Europe/London',
              v_series);
      v_created := v_created || to_jsonb(to_char(v_local_start::date, 'YYYY-MM-DD'));
    EXCEPTION WHEN exclusion_violation THEN
      v_skipped := v_skipped || to_jsonb(to_char(v_local_start::date, 'YYYY-MM-DD'));
    END;
    v_i := v_i + 1;
  END LOOP;

  IF jsonb_array_length(v_created) = 0 THEN
    RAISE EXCEPTION 'ROOM_TAKEN: % is already booked at that time on every chosen date.', p_room;
  END IF;

  RETURN jsonb_build_object('series_id', v_series, 'created', v_created, 'skipped', v_skipped);
END $$;

-- New function: create_monthly_booking (nth weekday of month)
CREATE OR REPLACE FUNCTION public.create_monthly_booking(
  p_room      text,
  p_title     text,
  p_booked_by text,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_nth       int,   -- 1=first 2=second 3=third 4=fourth -1=last
  p_weekday   int,   -- 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri
  p_until     date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_series    uuid := gen_random_uuid();
  v_created   jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
  v_duration  interval;
  v_base_time time;
  v_year      int;
  v_month     int;
  v_month_start date;
  v_candidate date;
  v_occurrences date[];
  v_count     int;
  v_d         date;
BEGIN
  IF p_nth NOT IN (1, 2, 3, 4, -1) THEN
    RAISE EXCEPTION 'Which must be 1st, 2nd, 3rd, 4th, or Last.';
  END IF;
  IF p_weekday NOT IN (0, 1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Day must be Monday through Friday.';
  END IF;
  IF p_until IS NULL OR p_until < (p_starts_at AT TIME ZONE 'Europe/London')::date THEN
    RAISE EXCEPTION 'Please choose when the repeat should finish.';
  END IF;
  IF p_until > (p_starts_at AT TIME ZONE 'Europe/London')::date + 365 THEN
    RAISE EXCEPTION 'Monthly bookings can run for up to one year.';
  END IF;

  PERFORM validate_booking(p_room, p_title, p_booked_by, p_starts_at, p_ends_at);

  v_duration  := p_ends_at - p_starts_at;
  v_base_time := (p_starts_at AT TIME ZONE 'Europe/London')::time;
  v_year      := EXTRACT(YEAR  FROM (p_starts_at AT TIME ZONE 'Europe/London'))::int;
  v_month     := EXTRACT(MONTH FROM (p_starts_at AT TIME ZONE 'Europe/London'))::int;

  FOR i IN 0..23 LOOP
    v_month_start := make_date(v_year, v_month, 1);
    EXIT WHEN v_month_start > p_until;

    -- Collect every occurrence of the target weekday this month
    -- ISO DOW: 1=Mon … 7=Sun; p_weekday: 0=Mon … so ISO = p_weekday + 1
    v_occurrences := ARRAY[]::date[];
    v_d := v_month_start;
    WHILE EXTRACT(MONTH FROM v_d) = v_month LOOP
      IF EXTRACT(ISODOW FROM v_d)::int - 1 = p_weekday THEN
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
       AND v_candidate >= (p_starts_at AT TIME ZONE 'Europe/London')::date
       AND v_candidate <= p_until THEN
      DECLARE
        v_start_ts timestamptz := (v_candidate + v_base_time) AT TIME ZONE 'Europe/London';
      BEGIN
        INSERT INTO bookings (room, title, booked_by, starts_at, ends_at, series_id)
        VALUES (p_room, TRIM(p_title), TRIM(p_booked_by),
                v_start_ts, v_start_ts + v_duration, v_series);
        v_created := v_created || to_jsonb(to_char(v_candidate, 'YYYY-MM-DD'));
      EXCEPTION WHEN exclusion_violation THEN
        v_skipped := v_skipped || to_jsonb(to_char(v_candidate, 'YYYY-MM-DD'));
      END;
    END IF;

    v_month := v_month + 1;
    IF v_month > 12 THEN v_month := 1; v_year := v_year + 1; END IF;
  END LOOP;

  IF jsonb_array_length(v_created) = 0 THEN
    RAISE EXCEPTION 'ROOM_TAKEN: % is already booked at that time on every chosen date.', p_room;
  END IF;

  RETURN jsonb_build_object('series_id', v_series, 'created', v_created, 'skipped', v_skipped);
END $$;

GRANT EXECUTE ON FUNCTION public.create_monthly_booking(text,text,text,timestamptz,timestamptz,int,int,date) TO anon;
