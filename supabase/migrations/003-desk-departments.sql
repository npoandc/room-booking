-- Migration: add a department to desk bookings.
-- Run in the Supabase SQL editor. Safe to run alongside the existing tables.

alter table public.desk_bookings add column if not exists department text;

-- Replace the create/change functions so they accept and validate a department.
-- (A department with a typo or outside the list is rejected.)

drop function if exists public.create_desk_booking(text, text, text, date);
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

drop function if exists public.change_desk_booking(uuid, text, text, text, date, text);
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

grant execute on function public.create_desk_booking(text, text, text, date, text) to anon;
grant execute on function public.change_desk_booking(uuid, text, text, text, date, text, text) to anon;
