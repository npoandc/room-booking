// Mirrors room bookings from Supabase into a shared Outlook calendar
// via the Microsoft Graph API. Runs on GitHub Actions (see
// .github/workflows/outlook-sync.yml). One-way: app → Outlook.
//
// Required repository secrets (Settings → Secrets and variables → Actions):
//   SUPABASE_URL              e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY Supabase Settings → API → service_role key
//   MS_TENANT_ID              from the Entra app registration
//   MS_CLIENT_ID              from the Entra app registration
//   MS_CLIENT_SECRET          from the Entra app registration
//   OUTLOOK_MAILBOX           mailbox that owns the shared calendar,
//                             e.g. roombookings@yourcompany.co.uk
// Optional:
//   OUTLOOK_CALENDAR_NAME     calendar name inside that mailbox; if unset,
//                             the mailbox's default calendar is used.
//
// Setup instructions for IT: see docs/OUTLOOK-SETUP.md

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MS_TENANT_ID,
  MS_CLIENT_ID,
  MS_CLIENT_SECRET,
  OUTLOOK_MAILBOX,
  OUTLOOK_CALENDAR_NAME,
} = process.env;

if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET || !OUTLOOK_MAILBOX) {
  console.log("Outlook sync is not configured yet (Microsoft secrets missing) — skipping.");
  process.exit(0);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets are missing.");
  process.exit(1);
}

const sbHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...sbHeaders, ...options.headers },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function getGraphToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body }
  );
  if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const token = await getGraphToken();
const graphBase = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(OUTLOOK_MAILBOX)}`;

async function graph(path, options = {}) {
  const res = await fetch(`${graphBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (res.status === 404 && options.method === "DELETE") return null; // already gone
  if (!res.ok) throw new Error(`Graph ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Resolve which calendar to write into.
let eventsPath = "/calendar/events"; // mailbox default calendar
if (OUTLOOK_CALENDAR_NAME) {
  const { value } = await graph(
    `/calendars?$filter=name eq '${OUTLOOK_CALENDAR_NAME.replace(/'/g, "''")}'`
  );
  if (!value?.length) {
    throw new Error(`Calendar "${OUTLOOK_CALENDAR_NAME}" was not found in ${OUTLOOK_MAILBOX}.`);
  }
  eventsPath = `/calendars/${value[0].id}/events`;
}

function toEvent(b) {
  return {
    subject: `${b.room}: ${b.title} (${b.booked_by})`,
    location: { displayName: b.room },
    start: { dateTime: b.starts_at.replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: b.ends_at.replace(/Z$/, ""), timeZone: "UTC" },
    body: {
      contentType: "text",
      content: `Booked by ${b.booked_by} via the room booking app.\nBooking ID: ${b.id}`,
    },
  };
}

const pending = await sb("bookings?needs_sync=eq.true&order=created_at.asc");
console.log(`${pending.length} booking(s) to sync.`);

let synced = 0;
for (const b of pending) {
  try {
    let eventId = b.outlook_event_id;
    if (b.status === "cancelled") {
      if (eventId) await graph(`${eventsPath}/${eventId}`, { method: "DELETE" });
      eventId = null;
    } else if (eventId) {
      await graph(`${eventsPath}/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify(toEvent(b)),
      });
    } else {
      const created = await graph(eventsPath, {
        method: "POST",
        body: JSON.stringify(toEvent(b)),
      });
      eventId = created.id;
    }
    await sb(`bookings?id=eq.${b.id}`, {
      method: "PATCH",
      body: JSON.stringify({ needs_sync: false, outlook_event_id: eventId }),
      headers: { Prefer: "return=minimal" },
    });
    synced++;
  } catch (err) {
    console.error(`Failed to sync booking ${b.id}: ${err.message}`);
  }
}

console.log(`Synced ${synced}/${pending.length}.`);
if (synced < pending.length) process.exit(1);
