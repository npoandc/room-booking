# Desk Recurring Bookings — Design Spec
Date: 2026-07-01

## Overview
Add the same recurring booking options to the Hoole desk booking app that already exist in the room booking app: weekly intervals (every 1/2/3/4/6/8 weeks) and monthly (nth weekday of the month). Mirrors the room booking implementation as closely as possible.

## Database Changes (new migration)

### desk_bookings table
- Add column: `series_id uuid` (nullable — null means a one-off booking)

### New RPC functions
- `create_recurring_desk_booking(p_desk, p_booked_by, p_note, p_booking_date, p_department, p_interval_days, p_until)` — creates a series of weekly/fortnightly/etc bookings; skips dates where the desk is already taken; returns `{series_id, created[], skipped[]}`
- `create_monthly_desk_booking(p_desk, p_booked_by, p_note, p_booking_date, p_department, p_nth, p_weekday, p_until)` — creates bookings on the nth weekday of each month; same skip/return behaviour
- `cancel_desk_booking_series(p_id, p_changed_by, p_reason)` — cancels the booking with the given id and all future bookings in the same series; returns count of cancelled rows

### Constraints
- Max 1 year ahead (same as room booking)
- Max 60 occurrences per series
- Valid intervals: 7, 14, 21, 28, 42, 56 days
- Weekday 0–4 (Mon–Fri), nth in (1, 2, 3, 4, -1)

## desks.html Changes

### Booking form (create only — not edit)
- Add Repeats `<select>` with options: Does not repeat / Every week / Every 2 weeks / Every 3 weeks / Every 4 weeks / Every 6 weeks / Every 8 weeks / Monthly (set day)
- Add Last date `<input type="date">` — shown when any repeat option is chosen
- Add Monthly sub-row (hidden unless Monthly chosen): Which select (1st/2nd/3rd/4th/Last) + Day select (Mon–Fri)

### Cancel form
- Add series scope radio buttons — shown only when the booking has a `series_id`:
  - "Cancel just this booking" (default)
  - "Cancel this and all future repeats"

## desks.js Changes

### Store methods (supabaseStore + demoStore)
- `createRecurring(b, intervalDays, untilStr)` — calls `create_recurring_desk_booking` RPC
- `createMonthly(b, nth, weekday, untilStr)` — calls `create_monthly_desk_booking` RPC
- `cancelSeries(id, changedBy, reason)` — calls `cancel_desk_booking_series` RPC

### normalize()
- Map `series_id` from database row onto booking object

### Form submit handler
- Detect repeat mode (none / weekly / monthly) from the Repeats select
- Route to correct store method
- Show skipped-dates notice if any dates were skipped

### Cancel form
- Show series scope radio when `managedBooking.seriesId` is set
- Pass scope to store: single cancel or series cancel

### openCreateModal / openManageModal
- Reset repeat fields on open
- Show ↻ series indicator in manage modal when `seriesId` is set

## Files Changed
- `supabase/migrations/008-desk-recurring.sql` (new)
- `supabase/desks-schema.sql` (updated to reflect new column + functions)
- `desks.html` (both repos)
- `desks.js` (both repos)

## Out of Scope
- No changes to room booking
- No changes to the guide (can be done separately)
- No email notifications for desk recurring (not requested)
