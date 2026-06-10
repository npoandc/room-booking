// Room booking app — minimalist front end for GitHub Pages.
// Storage: Supabase when configured in config.js, otherwise an
// in-browser demo store so the app can be tried before going live.

const ROOMS = [
  "Board Room",
  "Room 1",
  "Room 2",
  "Room 3",
  "David Owen Suite",
  "Hoole Meeting Room",
];

const OPEN_MIN = 8 * 60;    // 08:00
const CLOSE_MIN = 18 * 60;  // 18:00
const SLOT_MIN = 30;
const DAY_SPAN = CLOSE_MIN - OPEN_MIN;

// ── Storage layer ───────────────────────────────────────────────────

function normalize(row) {
  return {
    id: row.id,
    room: row.room,
    title: row.title,
    bookedBy: row.booked_by,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
  };
}

async function supabaseStore() {
  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
  );
  const client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  function rpc(name, args) {
    return client.rpc(name, args).then(({ data, error }) => {
      if (error) throw new Error(friendly(error.message));
      return data;
    });
  }

  // Strip the machine-readable prefix so users see only the message we raised.
  function friendly(msg) {
    return msg.replace(/^ROOM_TAKEN:\s*/, "");
  }

  return {
    live: true,
    async list(dayStart, dayEnd) {
      const { data, error } = await client
        .from("bookings")
        .select("*")
        .eq("status", "active")
        .gte("starts_at", dayStart.toISOString())
        .lt("starts_at", dayEnd.toISOString());
      if (error) throw new Error(error.message);
      return data.map(normalize);
    },
    create(b) {
      return rpc("create_booking", {
        p_room: b.room, p_title: b.title, p_booked_by: b.bookedBy,
        p_starts_at: b.start.toISOString(), p_ends_at: b.end.toISOString(),
      });
    },
    change(id, b, changedBy, reason) {
      return rpc("change_booking", {
        p_id: id, p_changed_by: changedBy, p_reason: reason,
        p_room: b.room, p_starts_at: b.start.toISOString(),
        p_ends_at: b.end.toISOString(), p_title: b.title,
      });
    },
    cancel(id, changedBy, reason) {
      return rpc("cancel_booking", {
        p_id: id, p_changed_by: changedBy, p_reason: reason,
      });
    },
    async history(id) {
      const { data, error } = await client
        .from("booking_changes")
        .select("*")
        .eq("booking_id", id)
        .order("changed_at", { ascending: true });
      if (error) return [];
      return data;
    },
  };
}

function demoStore() {
  const KEY = "room-bookings-demo";
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"bookings":[],"changes":[]}');
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));

  function overlaps(db, b, ignoreId) {
    return db.bookings.find(
      (x) =>
        x.status === "active" &&
        x.id !== ignoreId &&
        x.room === b.room &&
        new Date(x.starts_at) < b.end &&
        new Date(x.ends_at) > b.start
    );
  }

  return {
    live: false,
    async list(dayStart, dayEnd) {
      return load()
        .bookings.filter(
          (x) =>
            x.status === "active" &&
            new Date(x.starts_at) >= dayStart &&
            new Date(x.starts_at) < dayEnd
        )
        .map(normalize);
    },
    async create(b) {
      const db = load();
      const clash = overlaps(db, b, null);
      if (clash) throw new Error(takenMessage(clash));
      db.bookings.push({
        id: crypto.randomUUID(), room: b.room, title: b.title,
        booked_by: b.bookedBy, starts_at: b.start.toISOString(),
        ends_at: b.end.toISOString(), status: "active",
      });
      save(db);
    },
    async change(id, b, changedBy, reason) {
      const db = load();
      const row = db.bookings.find((x) => x.id === id && x.status === "active");
      if (!row) throw new Error("Booking not found (it may have been cancelled).");
      const clash = overlaps(db, b, id);
      if (clash) throw new Error(takenMessage(clash));
      db.changes.push({
        booking_id: id, action: "change", changed_by: changedBy, reason,
        old_room: row.room, old_starts_at: row.starts_at, old_ends_at: row.ends_at,
        new_room: b.room, new_starts_at: b.start.toISOString(),
        new_ends_at: b.end.toISOString(), changed_at: new Date().toISOString(),
      });
      Object.assign(row, {
        room: b.room, title: b.title,
        starts_at: b.start.toISOString(), ends_at: b.end.toISOString(),
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
        old_room: row.room, old_starts_at: row.starts_at, old_ends_at: row.ends_at,
        changed_at: new Date().toISOString(),
      });
      save(db);
    },
    async history(id) {
      return load().changes.filter((c) => c.booking_id === id);
    },
  };
}

function takenMessage(row) {
  const s = fmtTime(new Date(row.starts_at));
  const e = fmtTime(new Date(row.ends_at));
  return `${row.room} is already booked ${s}–${e} by ${row.booked_by} (${row.title}). Please pick another time or room.`;
}

// ── Helpers ─────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const fmtMin = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const minsOf = (d) => d.getHours() * 60 + d.getMinutes();

function dateAt(dateStr, mins) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60);
}

function fmtDayLong(d) {
  return d.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// ── State ───────────────────────────────────────────────────────────

let store;
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let dayBookings = [];
let editingBooking = null; // set while the form is editing an existing booking
let managedBooking = null; // booking shown in the manage modal

// ── Rendering ───────────────────────────────────────────────────────

async function render() {
  $("#date-picker").value = toDateInput(currentDate);
  $("#day-heading").textContent = fmtDayLong(currentDate);

  const grid = $("#grid");
  if (isWeekend(currentDate)) {
    grid.innerHTML = "";
    $("#grid-wrap").classList.add("hidden");
    $("#closed-msg").classList.remove("hidden");
    return;
  }
  $("#grid-wrap").classList.remove("hidden");
  $("#closed-msg").classList.add("hidden");

  const dayStart = new Date(currentDate);
  const dayEnd = new Date(currentDate);
  dayEnd.setDate(dayEnd.getDate() + 1);
  try {
    dayBookings = await store.list(dayStart, dayEnd);
  } catch (err) {
    showBanner(`Could not load bookings: ${err.message}`);
    dayBookings = [];
  }

  grid.innerHTML = "";

  // Header row with hour labels
  const header = document.createElement("div");
  header.className = "grid-row";
  const corner = document.createElement("div");
  corner.className = "room-label";
  header.appendChild(corner);
  const timeHeader = document.createElement("div");
  timeHeader.className = "time-header";
  timeHeader.style.gridTemplateColumns = `repeat(${DAY_SPAN / 60}, 1fr)`;
  for (let m = OPEN_MIN; m < CLOSE_MIN; m += 60) {
    const span = document.createElement("span");
    span.textContent = fmtMin(m);
    timeHeader.appendChild(span);
  }
  header.appendChild(timeHeader);
  grid.appendChild(header);

  const now = new Date();
  const slotCount = DAY_SPAN / SLOT_MIN;

  for (const room of ROOMS) {
    const row = document.createElement("div");
    row.className = "grid-row";

    const label = document.createElement("div");
    label.className = "room-label";
    label.textContent = room;
    row.appendChild(label);

    const track = document.createElement("div");
    track.className = "track";
    track.style.gridTemplateColumns = `repeat(${slotCount}, 1fr)`;

    for (let i = 0; i < slotCount; i++) {
      const mins = OPEN_MIN + i * SLOT_MIN;
      const slot = document.createElement("div");
      slot.className = "slot" + (mins % 60 !== 0 ? " half" : "");
      const slotEnd = dateAt(toDateInput(currentDate), mins + SLOT_MIN);
      if (slotEnd <= now) {
        slot.classList.add("past");
      } else {
        slot.addEventListener("click", () => openCreateModal(room, mins));
      }
      track.appendChild(slot);
    }

    for (const b of dayBookings.filter((b) => b.room === room)) {
      const startM = Math.max(minsOf(b.start), OPEN_MIN);
      const endM = Math.min(minsOf(b.end) || CLOSE_MIN, CLOSE_MIN);
      const block = document.createElement("button");
      block.type = "button";
      block.className = "booking-block";
      block.style.left = `${((startM - OPEN_MIN) / DAY_SPAN) * 100}%`;
      block.style.width = `${((endM - startM) / DAY_SPAN) * 100}%`;
      block.innerHTML = `<span class="what"></span><span class="who"></span>`;
      block.querySelector(".what").textContent = b.title;
      block.querySelector(".who").textContent =
        `${fmtTime(b.start)}–${fmtTime(b.end)} · ${b.bookedBy}`;
      block.addEventListener("click", () => openManageModal(b));
      track.appendChild(block);
    }

    row.appendChild(track);
    grid.appendChild(row);
  }
}

function showBanner(text) {
  const el = $("#banner");
  el.textContent = text;
  el.classList.remove("hidden");
}

// ── Booking form (create + edit) ────────────────────────────────────

function fillTimeSelects() {
  const start = $("#f-start");
  const end = $("#f-end");
  for (let m = OPEN_MIN; m < CLOSE_MIN; m += SLOT_MIN) {
    start.add(new Option(fmtMin(m), m));
  }
  for (let m = OPEN_MIN + SLOT_MIN; m <= CLOSE_MIN; m += SLOT_MIN) {
    end.add(new Option(fmtMin(m), m));
  }
  const roomSel = $("#f-room");
  for (const r of ROOMS) roomSel.add(new Option(r, r));
}

function openCreateModal(room, startMin) {
  editingBooking = null;
  $("#booking-modal-title").textContent = "New booking";
  $("#booking-submit").textContent = "Book room";
  $("#edit-only").classList.add("hidden");
  $("#f-room").value = room;
  $("#f-date").value = toDateInput(currentDate);
  $("#f-start").value = startMin;
  $("#f-end").value = Math.min(startMin + 60, CLOSE_MIN);
  $("#f-title").value = "";
  $("#f-name").value = localStorage.getItem("my-name") || "";
  $("#f-changed-by").value = "";
  $("#f-reason").value = "";
  clearFormMessages();
  checkClash();
  $("#booking-modal").showModal();
}

function openEditModal(booking) {
  editingBooking = booking;
  $("#booking-modal-title").textContent = "Change booking";
  $("#booking-submit").textContent = "Save changes";
  $("#edit-only").classList.remove("hidden");
  $("#f-room").value = booking.room;
  $("#f-date").value = toDateInput(booking.start);
  $("#f-start").value = minsOf(booking.start);
  $("#f-end").value = minsOf(booking.end);
  $("#f-title").value = booking.title;
  $("#f-name").value = booking.bookedBy;
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

function formTimes() {
  const dateStr = $("#f-date").value;
  const startMin = Number($("#f-start").value);
  const endMin = Number($("#f-end").value);
  return {
    room: $("#f-room").value,
    start: dateAt(dateStr, startMin),
    end: dateAt(dateStr, endMin),
    dateStr, startMin, endMin,
  };
}

// Warn live about a clash. Only sees the currently-loaded day; the
// database constraint is the real guarantee on submit.
async function checkClash() {
  const f = formTimes();
  const warning = $("#clash-warning");
  if (!f.dateStr || f.endMin <= f.startMin) {
    warning.classList.add("hidden");
    return;
  }
  const sameDay = toDateInput(currentDate) === f.dateStr;
  let candidates = dayBookings;
  if (!sameDay) {
    const dayStart = dateAt(f.dateStr, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    try {
      candidates = await store.list(dayStart, dayEnd);
    } catch { candidates = []; }
  }
  const clash = candidates.find(
    (b) =>
      b.room === f.room &&
      b.id !== editingBooking?.id &&
      b.start < f.end &&
      b.end > f.start
  );
  if (clash) {
    warning.textContent = `⚠️ ${clash.room} is already booked ${fmtTime(clash.start)}–${fmtTime(clash.end)} by ${clash.bookedBy} (${clash.title}). Please pick another time or room.`;
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

  const f = formTimes();
  const title = $("#f-title").value.trim();
  const name = $("#f-name").value.trim();

  if (!f.dateStr) return formError("Please pick a date.");
  if (isWeekend(dateAt(f.dateStr, 0)))
    return formError("Rooms can only be booked Monday to Friday.");
  if (f.endMin <= f.startMin)
    return formError("The end time must be after the start time.");
  if (!title) return formError("Please enter a purpose for the booking.");
  if (!name) return formError("Please enter your name.");

  const payload = { room: f.room, title, bookedBy: name, start: f.start, end: f.end };

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
    currentDate = dateAt(f.dateStr, 0);
    await render();
  } catch (err) {
    formError(err.message);
  } finally {
    submitBtn.disabled = false;
  }
}

// ── Manage modal (view / change / cancel) ───────────────────────────

async function openManageModal(booking) {
  managedBooking = booking;
  $("#m-title").textContent = booking.title;
  const d = $("#m-details");
  d.innerHTML = "";
  const lines = [
    ["Room", booking.room],
    ["When", `${fmtDayLong(booking.start)}, ${fmtTime(booking.start)}–${fmtTime(booking.end)}`],
    ["Booked by", booking.bookedBy],
  ];
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
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
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
    errEl.textContent =
      "To cancel a booking you must say who is cancelling it and why.";
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
      "Demo mode — bookings are saved only in this browser. Connect Supabase (see README) to share bookings with the whole office."
    );
  }

  fillTimeSelects();

  $("#prev-day").addEventListener("click", () => shiftDay(-1));
  $("#next-day").addEventListener("click", () => shiftDay(1));
  $("#today-btn").addEventListener("click", () => {
    currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    render();
  });
  $("#date-picker").addEventListener("change", (e) => {
    if (!e.target.value) return;
    currentDate = dateAt(e.target.value, 0);
    render();
  });

  $("#booking-form").addEventListener("submit", submitBookingForm);
  for (const id of ["#f-room", "#f-date", "#f-start", "#f-end"]) {
    $(id).addEventListener("change", () => {
      // keep the end after the start
      const s = Number($("#f-start").value);
      if (Number($("#f-end").value) <= s) {
        $("#f-end").value = Math.min(s + SLOT_MIN, CLOSE_MIN);
      }
      checkClash();
    });
  }

  $("#m-change-btn").addEventListener("click", () => {
    $("#manage-modal").close();
    openEditModal(managedBooking);
  });
  $("#m-cancel-btn").addEventListener("click", () => {
    $("#cancel-form").classList.remove("hidden");
  });
  $("#c-back").addEventListener("click", () => {
    $("#cancel-form").classList.add("hidden");
  });
  $("#cancel-form").addEventListener("submit", submitCancelForm);

  for (const btn of document.querySelectorAll("[data-close]")) {
    btn.addEventListener("click", (e) => e.target.closest("dialog").close());
  }

  await render();
}

function shiftDay(delta) {
  currentDate.setDate(currentDate.getDate() + delta);
  render();
}

init();
