# Room Bookings

A simple, minimalist web app for booking the office meeting rooms:
**Board Room, Room 1, Room 2, Room 3, David Owen Suite, Hoole Meeting Room**.

- Bookable **Monday–Friday, 8:00 am – 6:00 pm**, in 30-minute slots
- **Double-booking is impossible** — the app warns you as you pick a time, and the
  database enforces it even if two people click "Book" at the same moment
- **Changing or cancelling a booking requires a name and a reason**, recorded in a
  permanent change history visible on each booking
- Optional one-way mirror into a shared **Outlook calendar** (see below)

No installs needed — anyone with the link can use it from any browser.

---

## Going live (one-time setup, ~15 minutes)

### 1. Put it on GitHub

Create an empty repository called `room-booking` at <https://github.com/new>
(public is fine — there are no secrets in the code), then from this folder run:

```sh
git remote add origin https://github.com/YOUR-USERNAME/room-booking.git
git push -u origin main
```

### 2. Create the bookings database (free)

1. Sign up at <https://supabase.com> and create a new project
   (any name, e.g. `room-booking`; choose a region near you, e.g. London).
2. In the project, open **SQL Editor → New query**, paste the entire contents of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Go to **Settings → API** and copy two values into [`config.js`](config.js):
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
4. Commit and push:

   ```sh
   git add config.js
   git commit -m "Connect Supabase"
   git push
   ```

> The anon key is designed to be public. It can only *read* bookings and call the
> three booking functions — all the rules (office hours, clash prevention, the
> who/why audit trail) are enforced inside the database itself.

### 3. Turn on the web link

In the GitHub repo: **Settings → Pages → Source: Deploy from a branch →
Branch: `main` / `/ (root)` → Save**.

A minute later your booking system is live at:

```
https://YOUR-USERNAME.github.io/room-booking/
```

Share that link with the office. Until step 2 is done the site runs in
**demo mode** (bookings saved only in your own browser) so you can try it first.

### 4. (Optional) Mirror bookings into Outlook

Bookings can be pushed automatically into your shared Outlook calendar every
15 minutes so people still see them there. This needs a Microsoft 365 admin —
hand them [`docs/OUTLOOK-SETUP.md`](docs/OUTLOOK-SETUP.md), which contains
step-by-step instructions and a ready-to-send request for IT.
Until it's configured the sync job simply does nothing, so there's no rush.

---

## How it works

| Piece | Where | Job |
|---|---|---|
| Room booking (`index.html`, `app.js`, `styles.css`) | GitHub Pages | The room booking interface |
| Desk booking (`desks.html`, `desks.js`) | GitHub Pages | Full-day desk booking for the Hoole office |
| Bookings database | Supabase (free tier) | Stores bookings + change history, enforces all rules |
| Outlook sync (`scripts/outlook-sync.mjs`) | GitHub Actions | Mirrors room bookings into the shared calendar |

The desk page lives at `…/room-booking/desks.html` and is linked from the room
page (and back). Its database tables come from
[`supabase/desks-schema.sql`](supabase/desks-schema.sql) — run that once in the
Supabase SQL editor, the same way as the main schema.

Changing the rooms, hours, or time-slot size: edit the constants at the top of
[`app.js`](app.js) and the matching room list / hours in
[`supabase/schema.sql`](supabase/schema.sql) (re-run the
`validate_booking` function definition in the SQL editor after editing).

**Note on the sync schedule:** GitHub pauses scheduled workflows in repos with
no activity for 60 days. Any commit re-enables it, or run it manually from the
**Actions** tab.
