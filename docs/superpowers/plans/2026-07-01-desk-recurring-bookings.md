# Desk Recurring Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weekly and monthly recurring booking options to the Hoole desk booking app, mirroring the room booking implementation.

**Architecture:** Three layers change in lockstep — a SQL migration adds the `series_id` column and three new RPC functions; `desks.html` gains a repeat UI row identical in structure to the room booking form; `desks.js` adds store methods and form-submit routing. After all JS/HTML changes are done, both repos (room-booking and room-booking-private) get the files copied before the final commit.

**Tech Stack:** PostgreSQL (Supabase), vanilla JS ES modules, HTML5 dialogs

## Global Constraints

- Full-day bookings only — no time slots; `booking_date` is a `date` column (not `timestamptz`)
- Timezone: Europe/London for weekday checks
- Max 1 year ahead per series; max 60 occurrences
- Valid weekly intervals: 7, 14, 21, 28, 42, 56 days
- Valid nth values: 1, 2, 3, 4, -1 (last); valid weekday values: 0–4 (Mon=0, Fri=4, matching ISO DOW − 1)
- Both files (`desks.html`, `desks.js`) must be copied to `~/room-booking-private/` after every task that changes them
- Commit to both repos after the final task

---

### Task 1: SQL migration — series_id column + three new RPC functions

**Files:**
- Create: `supabase/migrations/008-desk-recurring.sql`
- Modify: `supabase/desks-schema.sql` (add column + functions to the reference copy)

**Interfaces:**
- Produces:
  - `create_recurring_desk_booking(p_desk text, p_booked_by text, p_note text, p_booking_date date, p_department text, p_interval_days int, p_until date) RETURNS jsonb` — `{series_id, created: ["YYYY-MM-DD",...], skipped: ["YYYY-MM-DD",...]}`
  - `create_monthly_desk_booking(p_desk text, p_booked_by text, p_note text, p_booking_date date, p_department text, p_nth int, p_weekday int, p_until date) RETURNS jsonb` — same shape
  - `cancel_desk_booking_series(p_id uuid, p_changed_by text, p_reason text) RETURNS int` — count of cancelled rows

- [ ] **Step 1: Create the migration file**

Create `/Users/nickpennink/room-booking/supabase/migrations/008-desk-recurring.sql` with this content:

```sql
-- Migration 008: add series support to desk bookings

ALTER TABLE public.desk_bookings
  ADD COLUMN IF NOT EXISTS series_id uuid;

-- ── Recurring (weekly/fortnightly/etc) ───────────────────────────────

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

-- ── Monthly (nth weekday of month) ───────────────────────────────────

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

-- ── Cancel series ────────────────────────────────────────────────────

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

-- ── Grants ───────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.create_recurring_desk_booking(text,text,text,date,text,int,date) TO anon;
GRANT EXECUTE ON FUNCTION public.create_monthly_desk_booking(text,text,text,date,text,int,int,date) TO anon;
GRANT EXECUTE ON FUNCTION public.cancel_desk_booking_series(uuid,text,text) TO anon;
```

- [ ] **Step 2: Update desks-schema.sql to reflect the new column and functions**

In `/Users/nickpennink/room-booking/supabase/desks-schema.sql`, add `series_id uuid,` as the last column in the `desk_bookings` table definition (after `created_at`):

```sql
  series_id    uuid,
```

Then append the three new functions and grants from the migration above to the bottom of `desks-schema.sql` (before the final comments, if any).

- [ ] **Step 3: Commit**

```bash
cd ~/room-booking
git add supabase/migrations/008-desk-recurring.sql supabase/desks-schema.sql
git commit -m "Add SQL migration for desk recurring bookings (series_id + 3 RPCs)"
git push origin main
```

---

### Task 2: desks.html — repeat UI and series cancel scope

**Files:**
- Modify: `desks.html` in both `~/room-booking/` and `~/room-booking-private/`

**Interfaces:**
- Produces HTML elements consumed by Task 3:
  - `#f-repeat` — select with values `""`, `"7"`, `"14"`, `"21"`, `"28"`, `"42"`, `"56"`, `"monthly"`
  - `#f-until` — date input, hidden by default, inside `#f-until-label`
  - `#repeat-row` — wrapper div, hidden when editing
  - `#f-monthly-row` — hidden div with `#f-monthly-nth` and `#f-monthly-day`
  - `#c-scope` — hidden div with radios `name="dscope"` values `"one"` and `"future"`

- [ ] **Step 1: Add the repeat row to the booking form**

In `~/room-booking/desks.html`, insert this block **after** the desk/date row (`</div>` closing the `.row` with `#f-desk` and `#f-date`) and **before** the `<label>Your name` label:

```html
      <div class="row repeat-row" id="repeat-row">
        <label>Repeats
          <select id="f-repeat">
            <option value="">Does not repeat</option>
            <option value="7">Every week</option>
            <option value="14">Every 2 weeks</option>
            <option value="21">Every 3 weeks</option>
            <option value="28">Every 4 weeks</option>
            <option value="42">Every 6 weeks</option>
            <option value="56">Every 8 weeks</option>
            <option value="monthly">Monthly (set day)</option>
          </select>
        </label>
        <label id="f-until-label" class="hidden">Last date
          <input type="date" id="f-until">
        </label>
      </div>

      <div id="f-monthly-row" class="row hidden">
        <label>Which
          <select id="f-monthly-nth">
            <option value="1">1st</option>
            <option value="2">2nd</option>
            <option value="3">3rd</option>
            <option value="4">4th</option>
            <option value="-1">Last</option>
          </select>
        </label>
        <label>Day
          <select id="f-monthly-day">
            <option value="0">Monday</option>
            <option value="1">Tuesday</option>
            <option value="2">Wednesday</option>
            <option value="3">Thursday</option>
            <option value="4">Friday</option>
          </select>
        </label>
      </div>
```

- [ ] **Step 2: Add series scope to the cancel form**

In `~/room-booking/desks.html`, inside `#cancel-form`, insert this block **after** the `#c-reason` label and **before** `#cancel-error`:

```html
        <div id="c-scope" class="scope hidden">
          <label class="radio"><input type="radio" name="dscope" value="one" checked> Cancel just this booking</label>
          <label class="radio"><input type="radio" name="dscope" value="future"> Cancel this and all future repeats</label>
        </div>
```

- [ ] **Step 3: Copy to private repo**

```bash
cp ~/room-booking/desks.html ~/room-booking-private/desks.html
```

- [ ] **Step 4: Commit both repos**

```bash
cd ~/room-booking
git add desks.html
git commit -m "Add repeat UI and series cancel scope to desks.html"
git push origin main

cd ~/room-booking-private
git add desks.html
git commit -m "Add repeat UI and series cancel scope to desks.html"
git push origin main
```

---

### Task 3: desks.js — store methods, normalize, form logic

**Files:**
- Modify: `desks.js` in both `~/room-booking/` and `~/room-booking-private/`

**Interfaces:**
- Consumes: HTML elements from Task 2 (`#f-repeat`, `#f-until`, `#f-monthly-nth`, `#f-monthly-day`, `#c-scope` with `name="dscope"`)
- Consumes: RPC functions from Task 1 (`create_recurring_desk_booking`, `create_monthly_desk_booking`, `cancel_desk_booking_series`)

- [ ] **Step 1: Add `seriesId` to normalize()**

Find the `normalize` function (around line 37) and add `seriesId` mapping:

```js
function normalize(row) {
  return {
    id: row.id,
    desk: row.desk,
    bookedBy: row.booked_by,
    note: row.note || "",
    department: row.department || "",
    date: row.booking_date, // 'YYYY-MM-DD'
    createdAt: row.created_at ? new Date(row.created_at) : null,
    seriesId: row.series_id || null,
  };
}
```

- [ ] **Step 2: Add three store methods to supabaseStore**

Inside the `return { ... }` block of `supabaseStore` (after the existing `cancel` method), add:

```js
    createRecurring(b, intervalDays, untilStr) {
      return rpc("create_recurring_desk_booking", {
        p_desk: b.desk, p_booked_by: b.bookedBy, p_note: b.note,
        p_booking_date: b.date, p_department: b.department,
        p_interval_days: intervalDays, p_until: untilStr,
      });
    },
    createMonthly(b, nth, weekday, untilStr) {
      return rpc("create_monthly_desk_booking", {
        p_desk: b.desk, p_booked_by: b.bookedBy, p_note: b.note,
        p_booking_date: b.date, p_department: b.department,
        p_nth: nth, p_weekday: weekday, p_until: untilStr,
      });
    },
    cancelSeries(id, changedBy, reason) {
      return rpc("cancel_desk_booking_series", {
        p_id: id, p_changed_by: changedBy, p_reason: reason,
      });
    },
```

- [ ] **Step 3: Add the same three methods to demoStore**

Inside the `return { ... }` block of `demoStore` (after the existing `cancel` method), add:

```js
    createRecurring(b, intervalDays, untilStr) {
      const until = new Date(untilStr);
      const results = { created: [], skipped: [] };
      let d = new Date(b.date);
      let i = 0;
      const seriesId = crypto.randomUUID();
      while (d <= until && i < 60) {
        const dateStr = d.toISOString().slice(0, 10);
        const clash = checkClashFn(b.desk, dateStr, null);
        if (clash) {
          results.skipped.push(dateStr);
        } else {
          const db = load();
          db.bookings.push({
            id: crypto.randomUUID(), desk: b.desk, booked_by: b.bookedBy,
            note: b.note, department: b.department, booking_date: dateStr,
            series_id: seriesId, status: "active", created_at: new Date().toISOString(),
          });
          save(db);
          results.created.push(dateStr);
        }
        d = new Date(d);
        d.setDate(d.getDate() + intervalDays);
        i++;
      }
      return Promise.resolve({ series_id: seriesId, ...results });
    },
    createMonthly(b, nth, weekday, untilStr) {
      const until = new Date(untilStr);
      const results = { created: [], skipped: [] };
      const seriesId = crypto.randomUUID();
      const start = new Date(b.date);
      let year = start.getFullYear(), month = start.getMonth();
      for (let m = 0; m < 24; m++) {
        const monthStart = new Date(year, month, 1);
        if (monthStart > until) break;
        const days = [];
        for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
          if (d.getDay() !== 0 && d.getDay() !== 6 && (d.getDay() - 1 + 7) % 7 === weekday) {
            days.push(new Date(d));
          }
        }
        const candidate = nth === -1 ? days[days.length - 1] : days[nth - 1];
        if (candidate && candidate >= start && candidate <= until) {
          const dateStr = candidate.toISOString().slice(0, 10);
          const clash = checkClashFn(b.desk, dateStr, null);
          if (clash) {
            results.skipped.push(dateStr);
          } else {
            const db = load();
            db.bookings.push({
              id: crypto.randomUUID(), desk: b.desk, booked_by: b.bookedBy,
              note: b.note, department: b.department, booking_date: dateStr,
              series_id: seriesId, status: "active", created_at: new Date().toISOString(),
            });
            save(db);
            results.created.push(dateStr);
          }
        }
        month++;
        if (month > 11) { month = 0; year++; }
      }
      return Promise.resolve({ series_id: seriesId, ...results });
    },
    cancelSeries(id, changedBy, reason) {
      const db = load();
      const row = db.bookings.find((x) => x.id === id && x.status === "active");
      if (!row || !row.series_id) return Promise.reject(new Error("Not part of a series."));
      const toCancel = db.bookings.filter(
        (x) => x.series_id === row.series_id && x.booking_date >= row.booking_date && x.status === "active"
      );
      toCancel.forEach((x) => {
        x.status = "cancelled";
        db.changes.push({
          booking_id: x.id, action: "cancel", changed_by: changedBy, reason,
          old_desk: x.desk, old_date: x.booking_date, changed_at: new Date().toISOString(),
        });
      });
      save(db);
      return Promise.resolve(toCancel.length);
    },
```

Note: `checkClashFn` is the existing inline clash checker inside demoStore. You need to extract it. Find the existing `create` method in demoStore which does:
```js
if (db.bookings.find(
  (x) => x.status === "active" && x.id !== ignoreId && x.desk === desk && x.booking_date === date
))
```
Add a helper at the top of demoStore (before `return {`):
```js
  function checkClashFn(desk, date, ignoreId) {
    return load().bookings.find(
      (x) => x.status === "active" && x.id !== ignoreId && x.desk === desk && x.booking_date === date
    );
  }
```

- [ ] **Step 4: Wire up `#f-repeat` change handler**

In the `init()` function (or wherever event listeners are wired), add after the existing listeners:

```js
  $("#f-repeat").addEventListener("change", () => {
    const val = $("#f-repeat").value;
    const isRepeat = val !== "";
    const isMonthly = val === "monthly";
    $("#f-until-label").classList.toggle("hidden", !isRepeat);
    $("#f-monthly-row").classList.toggle("hidden", !isMonthly);
  });
```

- [ ] **Step 5: Reset repeat fields in openCreateModal**

Inside `openCreateModal`, after the existing field resets (after `$("#f-note").value = ""`), add:

```js
  $("#f-repeat").value = "";
  $("#f-until").value = "";
  $("#f-until-label").classList.add("hidden");
  $("#f-monthly-row").classList.add("hidden");
  $("#repeat-row").classList.remove("hidden");
```

- [ ] **Step 6: Hide repeat row in openEditModal**

Inside `openEditModal`, after the existing field resets, add:

```js
  $("#repeat-row").classList.add("hidden");
```

(Repeating doesn't apply when editing an existing booking.)

- [ ] **Step 7: Update submitBookingForm to handle recurring paths**

Replace the `try` block inside `submitBookingForm` (currently just `if (editingBooking) { ... } else { await store.create(payload); ... }`) with:

```js
  const repeatVal = $("#f-repeat").value;
  const isMonthly = repeatVal === "monthly";
  const repeatDays = isMonthly ? 0 : (Number(repeatVal) || 0);
  const untilStr = $("#f-until").value;
  if (!editingBooking && (repeatDays || isMonthly) && !untilStr)
    return formError("Please choose the last date for the repeat.");

  const submitBtn = $("#booking-submit");
  submitBtn.disabled = true;
  try {
    if (editingBooking) {
      const changedBy = $("#f-changed-by").value.trim();
      const reason = $("#f-reason").value.trim();
      if (!changedBy) return formError("Please enter who is making this change.");
      if (reason.length < 3) return formError("Please give a reason for this change.");
      await store.change(editingBooking.id, payload, changedBy, reason);
      localStorage.setItem("my-name", changedBy);
    } else if (isMonthly) {
      const nth = Number($("#f-monthly-nth").value);
      const weekday = Number($("#f-monthly-day").value);
      const result = await store.createMonthly(payload, nth, weekday, untilStr);
      if (result.skipped?.length) {
        const days = result.skipped.map((d) =>
          parseDate(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
        );
        showNotice(
          `${result.created.length} bookings made. ⚠️ These dates were skipped because ${payload.desk} is already booked then: ${days.join(", ")}.`
        );
      }
      localStorage.setItem("my-name", name);
    } else if (repeatDays) {
      const result = await store.createRecurring(payload, repeatDays, untilStr);
      if (result.skipped.length) {
        const days = result.skipped.map((d) =>
          parseDate(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
        );
        showNotice(
          `${result.created.length} bookings made. ⚠️ These dates were skipped because ${payload.desk} is already booked then: ${days.join(", ")}.`
        );
      }
      localStorage.setItem("my-name", name);
    } else {
      await store.create(payload);
      localStorage.setItem("my-name", name);
    }
    localStorage.setItem("my-dept", department);
    $("#booking-modal").close();
    currentDate = parseDate(dateStr);
    await render();
    renderStats();
    if (inviteEmails.length) {
      showNotice(`Opening an email invite for ${inviteEmails.length} ${inviteEmails.length > 1 ? "people" : "person"} — check your email program, then press Send.`);
      window.location.href = inviteMailto(payload, inviteEmails);
    }
  } catch (err) {
    formError(err.message);
  } finally {
    submitBtn.disabled = false;
  }
```

Note: Remove the old `const submitBtn` declaration and `try` block — they are being replaced wholesale.

- [ ] **Step 8: Show series indicator in openManageModal**

In `openManageModal`, after `$("#m-title").textContent = ...`, add:

```js
  const seriesNote = document.getElementById("m-series");
  if (seriesNote) seriesNote.classList.toggle("hidden", !booking.seriesId);
```

Then in `desks.html`, add this element inside `#manage-modal` after `<h2 id="m-title"></h2>`:

```html
      <p id="m-series" class="series-note hidden">↻ Part of a repeating series</p>
```

- [ ] **Step 9: Show series scope in cancel form and update submitCancelForm**

In `openManageModal`, after `$("#cancel-form").classList.add("hidden")`, add:

```js
  const scopeDiv = document.getElementById("c-scope");
  if (scopeDiv) scopeDiv.classList.toggle("hidden", !booking.seriesId);
  const oneRadio = document.querySelector('input[name="dscope"][value="one"]');
  if (oneRadio) oneRadio.checked = true;
```

Replace `submitCancelForm` with:

```js
async function submitCancelForm(event) {
  event.preventDefault();
  const name = $("#c-name").value.trim();
  const reason = $("#c-reason").value.trim();
  const errEl = $("#cancel-error");
  errEl.classList.add("hidden");
  if (!name || reason.length < 3) {
    errEl.textContent = "To cancel a booking you must say who is cancelling it and why.";
    errEl.classList.remove("hidden");
    return;
  }
  const scope = document.querySelector('input[name="dscope"]:checked')?.value || "one";
  try {
    if (managedBooking.seriesId && scope === "future") {
      const n = await store.cancelSeries(managedBooking.id, name, reason);
      showNotice(`${n} desk booking${n === 1 ? "" : "s"} cancelled.`);
    } else {
      await store.cancel(managedBooking.id, name, reason);
    }
    localStorage.setItem("my-name", name);
    $("#manage-modal").close();
    await render();
    renderStats();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
}
```

- [ ] **Step 10: Copy to private repo and commit both**

```bash
cp ~/room-booking/desks.js ~/room-booking-private/desks.js
cp ~/room-booking/desks.html ~/room-booking-private/desks.html

cd ~/room-booking
git add desks.js desks.html
git commit -m "Add recurring desk booking support (weekly + monthly)"
git push origin main

cd ~/room-booking-private
git add desks.js desks.html
git commit -m "Add recurring desk booking support (weekly + monthly)"
git push origin main
```

---

### Task 4: Run the SQL migration in Supabase

**Files:** None (user action required)

- [ ] **Step 1: Run migration 008 in Supabase**

Go to [supabase.com/dashboard](https://supabase.com/dashboard) → project **rkalpwgtefmxnvyjqcvp** → **SQL Editor** → **New query**.

Paste the full contents of `supabase/migrations/008-desk-recurring.sql` and click **Run**.

Expected result: `Success. No rows returned`

- [ ] **Step 2: Verify**

Open the desk booking app. Click a free desk. The booking form should now show a **Repeats** dropdown. Try booking with "Every week" selected — the **Last date** field should appear. Confirm it creates multiple bookings visible in the week/month view.
