// Hoole desk booking — full-day bookings.
// Storage: Supabase when configured in config.js, otherwise an in-browser
// demo store so the page can be tried before going live.

const DESKS = [
  "Reception",
  "Desk 1",
  "Desk 2",
  "Desk 3",
  "Desk 4",
  "Desk 5",
  "Desk 6",
];

// Each desk gets its own Oliver & Co brand colour: [background, text]
const DESK_COLOURS = {
  "Reception": ["#ab1365", "#ffffff"], // pink
  "Desk 1": ["#2e4057", "#ffffff"],    // blue
  "Desk 2": ["#2e5556", "#ffffff"],    // green
  "Desk 3": ["#311b3a", "#ffffff"],    // purple
  "Desk 4": ["#dbb75a", "#222628"],    // yellow (granite text)
  "Desk 5": ["#222628", "#ffffff"],    // granite
  "Desk 6": ["#8c0f53", "#ffffff"],    // deep pink
};
function deskColours(desk) {
  return DESK_COLOURS[desk] || ["#ab1365", "#ffffff"];
}

const DEPARTMENTS = [
  "IT", "People", "Client Services", "Admin", "ID", "PI", "Clin Neg",
  "Conveyancing", "Commercial Property", "Corporate & Commercial", "Family",
  "Accounts", "Wills & Probate", "Litigation & Disputes", "Ops", "Marketing",
];

// ── Storage layer ───────────────────────────────────────────────────

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

async function supabaseStore() {
  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
  );
  const client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  function rpc(name, args) {
    return client.rpc(name, args).then(({ data, error }) => {
      if (error) throw new Error(error.message.replace(/^DESK_TAKEN:\s*/, ""));
      return data;
    });
  }

  return {
    live: true,
    async list(startStr, endStr) {
      const { data, error } = await client
        .from("desk_bookings")
        .select("*")
        .eq("status", "active")
        .gte("booking_date", startStr)
        .lte("booking_date", endStr);
      if (error) throw new Error(error.message);
      return data.map(normalize);
    },
    create(b) {
      return rpc("create_desk_booking", {
        p_desk: b.desk, p_booked_by: b.bookedBy, p_note: b.note,
        p_date: b.date, p_department: b.department,
      });
    },
    change(id, b, changedBy, reason) {
      return rpc("change_desk_booking", {
        p_id: id, p_changed_by: changedBy, p_reason: reason,
        p_desk: b.desk, p_date: b.date, p_note: b.note, p_department: b.department,
      });
    },
    cancel(id, changedBy, reason) {
      return rpc("cancel_desk_booking", {
        p_id: id, p_changed_by: changedBy, p_reason: reason,
      });
    },
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
    async history(id) {
      const { data, error } = await client
        .from("desk_booking_changes")
        .select("*")
        .eq("booking_id", id)
        .order("changed_at", { ascending: true });
      if (error) return [];
      return data;
    },
    async listAllChanges() {
      const [changesRes, createdRes] = await Promise.all([
        client.from("desk_booking_changes").select("*")
          .order("changed_at", { ascending: false }).limit(200),
        client.from("desk_bookings").select("desk, booked_by, booking_date, created_at")
          .order("created_at", { ascending: false }).limit(200),
      ]);
      if (changesRes.error) throw new Error(changesRes.error.message);
      if (createdRes.error) throw new Error(createdRes.error.message);
      const creates = createdRes.data.map((b) => ({
        action: "create", changed_at: b.created_at, changed_by: b.booked_by,
        reason: null, old_desk: b.desk, old_date: b.booking_date,
      }));
      return [...changesRes.data, ...creates]
        .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at))
        .slice(0, 200);
    },
    async statsBookings() {
      const { data, error } = await client
        .from("desk_bookings")
        .select("department, booking_date")
        .eq("status", "active")
        .limit(5000);
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

function demoStore() {
  const KEY = "desk-bookings-demo";
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"bookings":[],"changes":[]}');
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));

  const taken = (db, desk, date, ignoreId) =>
    db.bookings.find(
      (x) => x.status === "active" && x.id !== ignoreId && x.desk === desk && x.booking_date === date
    );

  function checkClashFn(desk, date, ignoreId) {
    return load().bookings.find(
      (x) => x.status === "active" && x.id !== ignoreId && x.desk === desk && x.booking_date === date
    );
  }

  return {
    live: false,
    async list(startStr, endStr) {
      return load()
        .bookings.filter(
          (x) => x.status === "active" && x.booking_date >= startStr && x.booking_date <= endStr
        )
        .map(normalize);
    },
    async create(b) {
      const db = load();
      if (taken(db, b.desk, b.date, null))
        throw new Error(`${b.desk} is already booked on that day. Please pick another desk or day.`);
      db.bookings.push({
        id: crypto.randomUUID(), desk: b.desk, booked_by: b.bookedBy,
        note: b.note || null, department: b.department || null,
        booking_date: b.date, status: "active",
        created_at: new Date().toISOString(),
      });
      save(db);
    },
    async change(id, b, changedBy, reason) {
      const db = load();
      const row = db.bookings.find((x) => x.id === id && x.status === "active");
      if (!row) throw new Error("Booking not found (it may have been cancelled).");
      if (taken(db, b.desk, b.date, id))
        throw new Error(`${b.desk} is already booked on that day. Please pick another desk or day.`);
      db.changes.push({
        booking_id: id, action: "change", changed_by: changedBy, reason,
        old_desk: row.desk, old_date: row.booking_date,
        new_desk: b.desk, new_date: b.date, changed_at: new Date().toISOString(),
      });
      Object.assign(row, {
        desk: b.desk, booking_date: b.date,
        note: b.note || row.note, department: b.department || row.department,
      });
      save(db);
    },
    async cancel(id, changedBy, reason) {
      const db = load();
      const row = db.bookings.find((x) => x.id === id && x.status === "active");
      if (!row) throw new Error("Booking not found (it may have been cancelled).");
      row.status = "cancelled";
      db.changes.push({
        booking_id: id, action: "cancel", changed_by: changedBy, reason,
        old_desk: row.desk, old_date: row.booking_date, changed_at: new Date().toISOString(),
      });
      save(db);
    },
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
    async history(id) {
      return load().changes.filter((c) => c.booking_id === id);
    },
    async listAllChanges() {
      const db = load();
      const creates = db.bookings
        .filter((b) => b.created_at)
        .map((b) => ({
          action: "create", changed_at: b.created_at, changed_by: b.booked_by,
          reason: null, old_desk: b.desk, old_date: b.booking_date,
        }));
      return [...db.changes, ...creates]
        .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at))
        .slice(0, 200);
    },
    async statsBookings() {
      return load()
        .bookings.filter((b) => b.status === "active")
        .map((b) => ({ department: b.department, booking_date: b.booking_date }));
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtDayLong(d) {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function shortDay(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ── State ───────────────────────────────────────────────────────────

let store;
let viewMode = ["day", "month"].includes(localStorage.getItem("desk-view-mode"))
  ? localStorage.getItem("desk-view-mode")
  : "week";
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let editingBooking = null;
let managedBooking = null;
let statsScope = localStorage.getItem("desk-stats-scope") === "all" ? "all" : "month";

// ── Rendering ───────────────────────────────────────────────────────

async function render() {
  $("#date-picker").value = toDateInput(currentDate);
  $("#view-day").classList.toggle("active", viewMode === "day");
  $("#view-week").classList.toggle("active", viewMode === "week");
  $("#view-month").classList.toggle("active", viewMode === "month");
  $("#hint").textContent =
    viewMode === "day"
      ? "Click a free desk to book it for the day. Click a booking to change or cancel it."
      : viewMode === "week"
      ? "Click a free space to book that desk for the day. Click a booking to change or cancel it."
      : "Click a day to open it and book a desk.";
  if (viewMode === "week") return renderWeek();
  if (viewMode === "month") return renderMonth();
  return renderDay();
}

const todayStr = () => toDateInput(new Date());

async function renderDay() {
  const grid = $("#grid");
  if (isWeekend(currentDate)) {
    grid.innerHTML = "";
    $("#grid-wrap").classList.add("hidden");
    $("#closed-msg").classList.remove("hidden");
    $("#day-heading").textContent = fmtDayLong(currentDate);
    return;
  }
  $("#grid-wrap").classList.remove("hidden");
  $("#closed-msg").classList.add("hidden");
  $("#day-heading").textContent = fmtDayLong(currentDate);

  const dStr = toDateInput(currentDate);
  let dayBookings = [];
  try {
    dayBookings = await store.list(dStr, dStr);
  } catch (err) {
    showBanner(`Could not load bookings: ${err.message}`);
  }
  const isPast = dStr < todayStr();

  grid.innerHTML = "";
  for (const desk of DESKS) {
    const booking = dayBookings.find((b) => b.desk === desk);
    const row = document.createElement("div");
    row.className = "desk-row";

    row.appendChild(deskLabelEl(desk));

    const status = document.createElement("div");
    status.className = "desk-status";
    if (booking) {
      status.appendChild(bookingChip(booking, true));
    } else if (isPast) {
      const free = document.createElement("span");
      free.className = "desk-free past";
      free.textContent = "—";
      status.appendChild(free);
    } else {
      const free = document.createElement("button");
      free.type = "button";
      free.className = "desk-free";
      free.textContent = "Free — click to book";
      free.addEventListener("click", () => openCreateModal(desk, dStr));
      status.appendChild(free);
    }
    row.appendChild(status);
    grid.appendChild(row);
  }
}

async function renderMonth() {
  $("#grid-wrap").classList.remove("hidden");
  $("#closed-msg").classList.add("hidden");

  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  $("#day-heading").textContent =
    first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const start = new Date(first);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weekStarts = [];
  for (let c = new Date(start); c <= last; c.setDate(c.getDate() + 7)) {
    weekStarts.push(new Date(c));
  }
  const rangeEnd = new Date(start);
  rangeEnd.setDate(rangeEnd.getDate() + weekStarts.length * 7);

  let bookings = [];
  try {
    bookings = await store.list(toDateInput(start), toDateInput(rangeEnd));
  } catch (err) {
    showBanner(`Could not load bookings: ${err.message}`);
  }
  const byDate = {};
  for (const b of bookings) (byDate[b.date] = byDate[b.date] || []).push(b);

  const today = todayStr();
  const grid = $("#grid");
  grid.innerHTML = "";

  const header = document.createElement("div");
  header.className = "month-row";
  for (const wd of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
    const h = document.createElement("div");
    h.className = "month-weekday";
    h.textContent = wd;
    header.appendChild(h);
  }
  grid.appendChild(header);

  for (const wkStart of weekStarts) {
    const row = document.createElement("div");
    row.className = "month-row";
    for (let i = 0; i < 5; i++) {
      const d = new Date(wkStart);
      d.setDate(d.getDate() + i);
      const dStr = toDateInput(d);
      const inMonth = d.getMonth() === m;
      const cell = document.createElement(inMonth ? "button" : "div");
      cell.className =
        "month-cell" + (inMonth ? "" : " other-month") + (dStr === today ? " today" : "");

      const num = document.createElement("div");
      num.className = "month-date";
      num.textContent = d.getDate();
      cell.appendChild(num);

      const dayB = byDate[dStr] || [];
      if (inMonth && dayB.length) {
        const dots = document.createElement("div");
        dots.className = "month-dots";
        for (const desk of DESKS) {
          if (!dayB.some((b) => b.desk === desk)) continue;
          const dot = document.createElement("span");
          dot.className = "month-dot";
          dot.style.background = deskColours(desk)[0];
          dot.title = desk;
          dots.appendChild(dot);
        }
        cell.appendChild(dots);
        const free = DESKS.length - dayB.length;
        const cnt = document.createElement("div");
        cnt.className = "month-count";
        cnt.textContent = free === 0 ? "Full" : `${free} free`;
        cell.appendChild(cnt);
      }
      if (inMonth) {
        cell.type = "button";
        cell.addEventListener("click", () => {
          currentDate = d;
          setViewMode("day");
        });
      }
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

async function renderWeek() {
  $("#grid-wrap").classList.remove("hidden");
  $("#closed-msg").classList.add("hidden");

  const monday = new Date(currentDate);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);

  $("#day-heading").textContent =
    `Monday ${monday.getDate()} ${monday.toLocaleDateString("en-GB", { month: "long" })}` +
    ` – Friday ${friday.getDate()} ${friday.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;

  let weekBookings = [];
  try {
    weekBookings = await store.list(toDateInput(monday), toDateInput(friday));
  } catch (err) {
    showBanner(`Could not load bookings: ${err.message}`);
  }

  const today = todayStr();
  const grid = $("#grid");
  grid.innerHTML = "";

  const gotoDay = (d) => {
    currentDate = new Date(d);
    viewMode = "day";
    localStorage.setItem("desk-view-mode", "day");
    render();
  };

  const header = document.createElement("div");
  header.className = "desk-week-row";
  header.appendChild(Object.assign(document.createElement("div"), { className: "room-label" }));
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const h = document.createElement("button");
    h.type = "button";
    h.className = "week-day-header" + (toDateInput(d) === today ? " today" : "");
    h.textContent = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    h.addEventListener("click", () => gotoDay(d));
    header.appendChild(h);
  }
  grid.appendChild(header);

  for (const desk of DESKS) {
    const row = document.createElement("div");
    row.className = "desk-week-row";
    row.appendChild(deskLabelEl(desk));

    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const dStr = toDateInput(d);
      const cell = document.createElement("div");
      cell.className = "week-cell" + (dStr === today ? " today" : "");
      const booking = weekBookings.find((b) => b.desk === desk && b.date === dStr);
      if (booking) {
        cell.appendChild(bookingChip(booking, false));
      } else if (dStr >= today) {
        cell.classList.add("clickable");
        cell.addEventListener("click", () => openCreateModal(desk, dStr));
      }
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

function deskLabelEl(desk) {
  const label = document.createElement("div");
  label.className = "room-label";
  const dot = document.createElement("span");
  dot.className = "room-dot";
  dot.style.background = deskColours(desk)[0];
  label.appendChild(dot);
  label.appendChild(document.createTextNode(desk));
  return label;
}

function bookingChip(booking, withNote) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "desk-chip";
  const [bg, fg] = deskColours(booking.desk);
  chip.style.background = bg;
  chip.style.color = fg;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = booking.bookedBy;
  chip.appendChild(who);
  if (withNote && booking.note) {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = booking.note;
    chip.appendChild(note);
  }
  chip.title = booking.note ? `${booking.bookedBy} · ${booking.note}` : booking.bookedBy;
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    openManageModal(booking);
  });
  return chip;
}

async function renderStats() {
  $("#stats-month").classList.toggle("active", statsScope === "month");
  $("#stats-all").classList.toggle("active", statsScope === "all");

  let rows = [];
  try {
    rows = await store.statsBookings();
  } catch {
    rows = [];
  }
  const ym = todayStr().slice(0, 7);
  const inScope =
    statsScope === "month" ? rows.filter((r) => (r.booking_date || "").slice(0, 7) === ym) : rows;

  const counts = {};
  for (const r of inScope) {
    const dept = r.department || "Not specified";
    counts[dept] = (counts[dept] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const list = $("#dept-stats-list");
  list.innerHTML = "";
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "dept-stats-empty";
    p.textContent = `No desk bookings ${statsScope === "month" ? "this month" : "yet"}.`;
    list.appendChild(p);
    return;
  }
  const max = entries[0][1];
  entries.forEach(([dept, n], i) => {
    const row = document.createElement("div");
    row.className = "dept-bar-row" + (i === 0 ? " top" : "");
    const name = document.createElement("div");
    name.className = "dept-bar-name";
    name.textContent = dept;
    const track = document.createElement("div");
    track.className = "dept-bar-track";
    const fill = document.createElement("div");
    fill.className = "dept-bar-fill";
    fill.style.width = `${Math.round((n / max) * 100)}%`;
    track.appendChild(fill);
    const cnt = document.createElement("div");
    cnt.className = "dept-bar-count";
    cnt.textContent = n;
    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(cnt);
    list.appendChild(row);
  });
}

function showBanner(text) {
  const el = $("#banner");
  el.textContent = text;
  el.classList.remove("hidden");
}
function showNotice(text) {
  $("#notice-text").textContent = text;
  $("#notice").classList.remove("hidden");
}

// ── Booking form (create + edit) ────────────────────────────────────

function fillDeskSelect() {
  const sel = $("#f-desk");
  for (const d of DESKS) sel.add(new Option(d, d));
}

function fillDeptSelect() {
  const sel = $("#f-dept");
  sel.add(new Option("Choose a department…", ""));
  for (const d of DEPARTMENTS) sel.add(new Option(d, d));
}

function openCreateModal(desk, dateStr) {
  editingBooking = null;
  $("#booking-modal-title").textContent = "Book a desk";
  $("#booking-submit").textContent = "Book desk";
  $("#edit-only").classList.add("hidden");
  $("#f-invite").value = "";
  $("#f-invite-field").classList.remove("hidden");
  $("#f-desk").value = desk;
  $("#f-date").value = dateStr;
  $("#f-name").value = localStorage.getItem("my-name") || "";
  $("#f-dept").value = localStorage.getItem("my-dept") || "";
  $("#f-note").value = "";
  $("#f-changed-by").value = "";
  $("#f-reason").value = "";
  $("#f-repeat").value = "";
  $("#f-until").value = "";
  $("#f-until-label").classList.add("hidden");
  $("#f-monthly-row").classList.add("hidden");
  $("#repeat-row").classList.remove("hidden");
  clearFormMessages();
  checkClash();
  $("#booking-modal").showModal();
}

function openEditModal(booking) {
  editingBooking = booking;
  $("#booking-modal-title").textContent = "Change desk booking";
  $("#booking-submit").textContent = "Save changes";
  $("#edit-only").classList.remove("hidden");
  $("#f-invite-field").classList.add("hidden");
  $("#f-desk").value = booking.desk;
  $("#f-date").value = booking.date;
  $("#f-name").value = booking.bookedBy;
  $("#f-dept").value = booking.department || "";
  $("#f-note").value = booking.note;
  $("#f-changed-by").value = localStorage.getItem("my-name") || "";
  $("#f-reason").value = "";
  $("#repeat-row").classList.add("hidden");
  clearFormMessages();
  checkClash();
  $("#booking-modal").showModal();
}

function clearFormMessages() {
  $("#clash-warning").classList.add("hidden");
  $("#form-error").classList.add("hidden");
}

async function checkClash() {
  const desk = $("#f-desk").value;
  const dateStr = $("#f-date").value;
  const warning = $("#clash-warning");
  if (!dateStr) return warning.classList.add("hidden");
  let taken;
  try {
    const list = await store.list(dateStr, dateStr);
    taken = list.find((b) => b.desk === desk && b.id !== editingBooking?.id);
  } catch { taken = null; }
  if (taken) {
    warning.textContent = `⚠️ ${desk} is already booked on ${shortDay(parseDate(dateStr))} by ${taken.bookedBy}. Please pick another desk or day.`;
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}

function formError(msg) {
  const el = $("#form-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function submitBookingForm(event) {
  event.preventDefault();
  clearFormMessages();

  const desk = $("#f-desk").value;
  const dateStr = $("#f-date").value;
  const name = $("#f-name").value.trim();
  const note = $("#f-note").value.trim();
  const department = $("#f-dept").value;

  if (!dateStr) return formError("Please pick a date.");
  if (isWeekend(parseDate(dateStr)))
    return formError("Desks can only be booked Monday to Friday.");
  if (!name) return formError("Please enter your name.");
  if (!department) return formError("Please choose a department.");

  const payload = { desk, bookedBy: name, note, date: dateStr, department };
  const { good: inviteEmails, bad: inviteBad } = editingBooking
    ? { good: [], bad: [] }
    : splitEmails($("#f-invite").value);
  if (inviteBad.length)
    return formError(
      `Invites can only be sent to Oliver & Co email addresses (…${EMAIL_DOMAIN}). Please remove: ${inviteBad.join(", ")}`
    );
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
      if (result.skipped?.length) {
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
}

// ── Manage modal ────────────────────────────────────────────────────

async function openManageModal(booking) {
  managedBooking = booking;
  $("#m-title").textContent = `${booking.desk} — ${booking.bookedBy}`;
  const seriesNote = document.getElementById("m-series");
  if (seriesNote) seriesNote.classList.toggle("hidden", !booking.seriesId);
  const d = $("#m-details");
  d.innerHTML = "";
  const lines = [
    ["Desk", booking.desk],
    ["Day", fmtDayLong(parseDate(booking.date))],
    ["Booked by", booking.bookedBy],
  ];
  if (booking.department) lines.push(["Department", booking.department]);
  if (booking.note) lines.push(["Note", booking.note]);
  if (booking.createdAt) {
    lines.push(["Added", booking.createdAt.toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })]);
  }
  for (const [k, v] of lines) {
    const p = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = `${k}: `;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(v));
    d.appendChild(p);
    d.appendChild(document.createElement("br"));
  }

  const hist = $("#m-history");
  hist.innerHTML = "";
  const changes = await store.history(booking.id);
  if (changes.length) {
    const title = document.createElement("p");
    title.className = "h-title";
    title.textContent = "Change history";
    hist.appendChild(title);
    for (const c of changes) {
      const p = document.createElement("p");
      const when = new Date(c.changed_at).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      p.textContent =
        c.action === "cancel"
          ? `${when} — cancelled by ${c.changed_by}: “${c.reason}”`
          : `${when} — changed by ${c.changed_by}: “${c.reason}”`;
      hist.appendChild(p);
    }
  }

  $("#cancel-form").classList.add("hidden");
  const scopeDiv = document.getElementById("c-scope");
  if (scopeDiv) scopeDiv.classList.toggle("hidden", !booking.seriesId);
  const oneRadio = document.querySelector('input[name="dscope"][value="one"]');
  if (oneRadio) oneRadio.checked = true;
  $("#cancel-error").classList.add("hidden");
  $("#cal-menu").classList.add("hidden");
  $("#invite-emails").value = "";
  $("#invite-error").classList.add("hidden");
  $("#c-name").value = localStorage.getItem("my-name") || "";
  $("#c-reason").value = "";
  $("#manage-modal").showModal();
}

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

// ── History modal ───────────────────────────────────────────────────

async function openHistoryModal() {
  const list = $("#history-list");
  list.innerHTML = "";
  let changes = [];
  try {
    changes = await store.listAllChanges();
  } catch (err) {
    list.innerHTML = `<p class="history-empty">Could not load the history: ${err.message}</p>`;
  }
  if (!changes.length && !list.innerHTML) {
    list.innerHTML = `<p class="history-empty">No desk bookings yet.</p>`;
  }
  for (const c of changes) {
    const entry = document.createElement("div");
    entry.className = "history-entry";
    const head = document.createElement("div");
    head.className = "h-head";
    const verb = document.createElement("span");
    verb.className =
      c.action === "cancel" ? "h-cancel" : c.action === "create" ? "h-create" : "h-change";
    verb.textContent =
      c.action === "cancel" ? "Cancelled" : c.action === "create" ? "Booked" : "Changed";
    head.appendChild(verb);
    let headText = ` — ${c.old_desk}, ${shortDay(parseDate(c.old_date))}`;
    if (c.action === "change" && c.new_desk) {
      headText += ` → ${c.new_desk}, ${shortDay(parseDate(c.new_date))}`;
    }
    head.appendChild(document.createTextNode(headText));

    const meta = document.createElement("div");
    meta.className = "h-meta";
    const when = new Date(c.changed_at).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    meta.textContent = c.reason
      ? `by ${c.changed_by}: “${c.reason}” · ${when}`
      : `by ${c.changed_by} · ${when}`;
    entry.appendChild(head);
    entry.appendChild(meta);
    list.appendChild(entry);
  }
  $("#history-modal").showModal();
}

// ── Add to my calendar (all-day event) ──────────────────────────────

function icsEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function ymd(dateStr) {
  return dateStr.replace(/-/g, "");
}
function nextDayYmd(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + 1);
  return toDateInput(d).replace(/-/g, "");
}
function eventTitle(b) {
  return `Desk booked: ${b.desk} (Hoole)`;
}
const APP_URL = "https://npoandc.github.io/room-booking/desks.html";
function eventDescription(b) {
  return (
    `Desk booked by ${b.bookedBy}${b.note ? " — " + b.note : ""} via the Oliver & Co desk booking app.\n\n` +
    `Please don't edit this calendar entry directly — any change or cancellation must be made in the desk booking app, otherwise the desk stays booked:\n${APP_URL}`
  );
}
function downloadIcs(b) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Oliver & Co//Desk Bookings//EN",
    "BEGIN:VEVENT",
    `UID:${b.id}@oliverandco-desk-booking`,
    `DTSTART;VALUE=DATE:${ymd(b.date)}`,
    `DTEND;VALUE=DATE:${nextDayYmd(b.date)}`,
    `SUMMARY:${icsEscape(eventTitle(b))}`,
    `LOCATION:Hoole office, Oliver & Co`,
    `URL:${APP_URL}`,
    `DESCRIPTION:${icsEscape(eventDescription(b))}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Desk-${b.desk.replace(/\s+/g, "-")}-${b.date}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}
function outlookUrl(b) {
  const q = new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent",
    subject: eventTitle(b), location: "Hoole office, Oliver & Co",
    body: eventDescription(b),
    startdt: `${b.date}T00:00:00`, enddt: `${b.date}T23:59:00`, allday: "true",
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${q}`;
}
function googleUrl(b) {
  const q = new URLSearchParams({
    action: "TEMPLATE", text: eventTitle(b), location: "Hoole office, Oliver & Co",
    details: eventDescription(b),
    dates: `${ymd(b.date)}/${nextDayYmd(b.date)}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const EMAIL_DOMAIN = "@oliverandco.co.uk";

function parseEmails(str) {
  return (str || "").split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
}

function splitEmails(str) {
  const good = [], bad = [];
  for (const e of parseEmails(str)) {
    (e.toLowerCase().endsWith(EMAIL_DOMAIN) ? good : bad).push(e);
  }
  return { good, bad };
}

// Opens the assistant's own email client with a ready-to-send invite.
function inviteMailto(b, emails) {
  const subject = `Desk booked for you: ${b.desk} — ${fmtDayLong(parseDate(b.date))}`;
  const body = [
    "Hi,",
    "",
    "A desk has been booked for you at the Hoole office:",
    "",
    `Desk: ${b.desk}`,
    `Day: ${fmtDayLong(parseDate(b.date))}`,
    b.note ? `Note: ${b.note}` : "",
    "",
    `Add it to your calendar: ${outlookUrl(b)}`,
    "",
    "Any change or cancellation is made in the desk booking app:",
    APP_URL,
  ].filter((l) => l !== null).join("\n");
  return `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ── Wiring ──────────────────────────────────────────────────────────

async function init() {
  if (window.CONFIG?.SUPABASE_URL && window.CONFIG?.SUPABASE_ANON_KEY) {
    try {
      store = await supabaseStore();
    } catch (err) {
      showBanner(`Could not connect to the bookings database: ${err.message}`);
      store = demoStore();
    }
  } else {
    store = demoStore();
    showBanner(
      "Demo mode — desk bookings are saved only in this browser. Connect Supabase (see README) to share with the whole office."
    );
  }

  fillDeskSelect();
  fillDeptSelect();

  $("#stats-month").addEventListener("click", () => {
    statsScope = "month";
    localStorage.setItem("desk-stats-scope", "month");
    renderStats();
  });
  $("#stats-all").addEventListener("click", () => {
    statsScope = "all";
    localStorage.setItem("desk-stats-scope", "all");
    renderStats();
  });

  $("#prev-day").addEventListener("click", () => shiftDate(-1));
  $("#next-day").addEventListener("click", () => shiftDate(1));
  $("#view-day").addEventListener("click", () => setViewMode("day"));
  $("#view-week").addEventListener("click", () => setViewMode("week"));
  $("#view-month").addEventListener("click", () => setViewMode("month"));
  $("#today-btn").addEventListener("click", () => {
    currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    render();
  });
  $("#date-picker").addEventListener("change", (e) => {
    if (!e.target.value) return;
    currentDate = parseDate(e.target.value);
    render();
  });

  $("#booking-form").addEventListener("submit", submitBookingForm);
  $("#f-desk").addEventListener("change", checkClash);
  $("#f-date").addEventListener("change", checkClash);

  $("#f-repeat").addEventListener("change", () => {
    const val = $("#f-repeat").value;
    const isRepeat = val !== "";
    const isMonthly = val === "monthly";
    $("#f-until-label").classList.toggle("hidden", !isRepeat);
    $("#f-monthly-row").classList.toggle("hidden", !isMonthly);
  });

  $("#notice-ok").addEventListener("click", () => $("#notice").classList.add("hidden"));
  $("#history-btn").addEventListener("click", openHistoryModal);

  $("#m-ics-btn").addEventListener("click", () => $("#cal-menu").classList.toggle("hidden"));
  $("#cal-outlook").addEventListener("click", () => window.open(outlookUrl(managedBooking), "_blank", "noopener"));
  $("#invite-send").addEventListener("click", () => {
    const { good, bad } = splitEmails($("#invite-emails").value);
    const err = $("#invite-error");
    if (bad.length) {
      err.textContent = `Only Oliver & Co addresses (…${EMAIL_DOMAIN}) can be invited. Please remove: ${bad.join(", ")}`;
      err.classList.remove("hidden");
      return;
    }
    if (!good.length) { $("#invite-emails").focus(); return; }
    err.classList.add("hidden");
    window.location.href = inviteMailto(managedBooking, good);
  });

  $("#m-change-btn").addEventListener("click", () => {
    $("#manage-modal").close();
    openEditModal(managedBooking);
  });
  $("#m-cancel-btn").addEventListener("click", () => $("#cancel-form").classList.remove("hidden"));
  $("#c-back").addEventListener("click", () => $("#cancel-form").classList.add("hidden"));
  $("#cancel-form").addEventListener("submit", submitCancelForm);

  for (const btn of document.querySelectorAll("[data-close]")) {
    btn.addEventListener("click", (e) => e.target.closest("dialog").close());
  }

  await render();
  renderStats();
}

function shiftDate(delta) {
  if (viewMode === "month") {
    currentDate.setDate(1);
    currentDate.setMonth(currentDate.getMonth() + delta);
  } else {
    currentDate.setDate(currentDate.getDate() + delta * (viewMode === "week" ? 7 : 1));
  }
  render();
}
function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem("desk-view-mode", mode);
  render();
}

init();
