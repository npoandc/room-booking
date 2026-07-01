-- Migration 007: update validate_booking to recognise "Owen Suite" instead of "David Owen Suite"

CREATE OR REPLACE FUNCTION public.validate_booking(
  p_room text, p_title text, p_booked_by text,
  p_starts_at timestamptz, p_ends_at timestamptz
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_start timestamp := p_starts_at AT TIME ZONE 'Europe/London';
  v_end   timestamp := p_ends_at   AT TIME ZONE 'Europe/London';
BEGIN
  IF p_room IS NULL OR p_room NOT IN
    ('Board Room', 'Room 1', 'Room 2', 'Room 3', 'Owen Suite', 'Hoole Meeting Room')
  THEN
    RAISE EXCEPTION 'Unknown room.';
  END IF;
  IF COALESCE(TRIM(p_title), '') = '' THEN
    RAISE EXCEPTION 'Please enter a purpose for the booking.';
  END IF;
  IF COALESCE(TRIM(p_booked_by), '') = '' THEN
    RAISE EXCEPTION 'Please enter your name.';
  END IF;
  IF v_start >= v_end THEN
    RAISE EXCEPTION 'The end time must be after the start time.';
  END IF;
  IF EXTRACT(DOW FROM v_start) IN (0, 6) THEN
    RAISE EXCEPTION 'Rooms can only be booked Monday to Friday.';
  END IF;
  IF v_start::time < '08:00' OR v_end::time > '18:00' THEN
    RAISE EXCEPTION 'Rooms are only bookable between 8:00 am and 6:00 pm.';
  END IF;
END $$;
