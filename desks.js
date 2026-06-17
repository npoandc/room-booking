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

// ── Storage layer ───────────────────────────────────────────────────

function normalize(row) {
  return {
    id: row.id,
    desk: row.desk,
    bookedBy: row.booked_by,
    note: row.note || "",
    date: row.booking_date, // 'YYYY-MM-DD'
    createdAt: row.created_at ? new Date(row.created_at) : null,
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
        p_desk: b.desk, p_booked_by: b.bookedBy, p_note: b.note, p_date: b.date,
      });
    },
    change(id, b, changedBy, reason) {
      return rpc("change_desk_booking", {
        p_id: id, p_changed_by: changedBy, p_reason: reason,
        p_desk: b.desk, p_date: b.date, p_note: b.note,
      });
    },
    cancel(id, changedBy, reason) {
      return rpc("cancel_desk_booking", {
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
        note: b.note || null, booking_date: b.date, status: "active",
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
      Object.assign(row, { desk: b.desk, booking_date: b.date, note: b.note || row.note });
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
let viewMode = localStorage.getItem("desk-view-mode") === "day" ? "day" : "week";
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let editingBooking = null;
let managedBooking = null;

// ── Rendering ───────────────────────────────────────────────────────

async function render() {
  $("#date-picker").value = toDateInput(currentDate);
  $("#view-day").classList.toggle("active", viewMode === "day");
  $("#view-week").classList.toggle("active", viewMode === "week");
  $("#hint").textContent =
    viewMode === "week"
      ? "Click a free space to book that desk for the day. Click a booking to change or cancel it."
      : "Click a free desk to book it for the day. Click a booking to change or cancel it.";
  if (viewMode === "week") return renderWeek();
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
  const icon = document.createElement("span");
  icon.className = "desk-icon";
  icon.textContent = desk === "Reception" ? "★" : "▦";
  label.appendChild(icon);
  label.appendChild(document.createTextNode(desk));
  return label;
}

function bookingChip(booking, withNote) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "desk-chip";
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

function openCreateModal(desk, dateStr) {
  editingBooking = null;
  $("#booking-modal-title").textContent = "Book a desk";
  $("#booking-submit").textContent = "Book desk";
  $("#edit-only").classList.add("hidden");
  $("#f-desk").value = desk;
  $("#f-date").value = dateStr;
  $("#f-name").value = localStorage.getItem("my-name") || "";
  $("#f-note").value = "";
  $("#f-changed-by").value = "";
  $("#f-reason").value = "";
  clearFormMessages();
  checkClash();
  $("#booking-modal").showModal();
}

function openEditModal(booking) {
  editingBooking = booking;
  $("#booking-modal-title").textContent = "Change desk booking";
  $("#booking-submit").textContent = "Save changes";
  $("#edit-only").classList.remove("hidden");
  $("#f-desk").value = booking.desk;
  $("#f-date").value = booking.date;
  $("#f-name").value = booking.bookedBy;
  $("#f-note").value = booking.note;
  $("#f-changed-by").value = localStorage.getItem("my-name") || "";
  $("#f-reason").value = "";
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

  if (!dateStr) return formError("Please pick a date.");
  if (isWeekend(parseDate(dateStr)))
    return formError("Desks can only be booked Monday to Friday.");
  if (!name) return formError("Please enter your name.");

  const payload = { desk, bookedBy: name, note, date: dateStr };
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
    } else {
      await store.create(payload);
      localStorage.setItem("my-name", name);
    }
    $("#booking-modal").close();
    currentDate = parseDate(dateStr);
    await render();
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
  const d = $("#m-details");
  d.innerHTML = "";
  const lines = [
    ["Desk", booking.desk],
    ["Day", fmtDayLong(parseDate(booking.date))],
    ["Booked by", booking.bookedBy],
  ];
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
  $("#cancel-error").classList.add("hidden");
  $("#cal-menu").classList.add("hidden");
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
  try {
    await store.cancel(managedBooking.id, name, reason);
    localStorage.setItem("my-name", name);
    $("#manage-modal").close();
    await render();
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
function downloadIcs(b) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Oliver & Co//Desk Bookings//EN",
    "BEGIN:VEVENT",
    `UID:${b.id}@oliverandco-desk-booking`,
    `DTSTART;VALUE=DATE:${ymd(b.date)}`,
    `DTEND;VALUE=DATE:${nextDayYmd(b.date)}`,
    `SUMMARY:${icsEscape(eventTitle(b))}`,
    `LOCATION:Hoole office, Oliver & Co`,
    `DESCRIPTION:${icsEscape(`Desk booked by ${b.bookedBy}${b.note ? " — " + b.note : ""}.`)}`,
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
    body: `Desk booked by ${b.bookedBy}${b.note ? " — " + b.note : ""}.`,
    startdt: `${b.date}T00:00:00`, enddt: `${b.date}T23:59:00`, allday: "true",
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${q}`;
}
function googleUrl(b) {
  const q = new URLSearchParams({
    action: "TEMPLATE", text: eventTitle(b), location: "Hoole office, Oliver & Co",
    details: `Desk booked by ${b.bookedBy}${b.note ? " — " + b.note : ""}.`,
    dates: `${ymd(b.date)}/${nextDayYmd(b.date)}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
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

  $("#prev-day").addEventListener("click", () => shiftDate(-1));
  $("#next-day").addEventListener("click", () => shiftDate(1));
  $("#view-day").addEventListener("click", () => setViewMode("day"));
  $("#view-week").addEventListener("click", () => setViewMode("week"));
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

  $("#notice-ok").addEventListener("click", () => $("#notice").classList.add("hidden"));
  $("#history-btn").addEventListener("click", openHistoryModal);

  $("#m-ics-btn").addEventListener("click", () => $("#cal-menu").classList.toggle("hidden"));
  $("#cal-outlook").addEventListener("click", () => window.open(outlookUrl(managedBooking), "_blank", "noopener"));
  $("#cal-google").addEventListener("click", () => window.open(googleUrl(managedBooking), "_blank", "noopener"));
  $("#cal-file").addEventListener("click", () => downloadIcs(managedBooking));

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
}

function shiftDate(delta) {
  currentDate.setDate(currentDate.getDate() + delta * (viewMode === "week" ? 7 : 1));
  render();
}
function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem("desk-view-mode", mode);
  render();
}

init();
