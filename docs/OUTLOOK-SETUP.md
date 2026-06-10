# Connecting the room booking app to Outlook

The booking app can mirror every booking into a shared Outlook calendar
(one-way: app → Outlook). A small job runs on GitHub every 15 minutes and
creates, updates, or removes calendar events to match the bookings.

Setting this up requires a **Microsoft 365 administrator**. If that's not you,
copy the "Request to IT" section at the bottom of this page into an email.

## What the admin needs to do (Microsoft Entra portal)

1. Go to <https://entra.microsoft.com> → **Identity → Applications →
   App registrations → New registration**.
   - Name: `Room Booking Sync`
   - Supported account types: *Accounts in this organizational directory only*
   - Redirect URI: leave blank → **Register**
2. On the app's **Overview** page, note the
   **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets → New client secret** → choose an expiry
   (set a reminder to renew it!) → copy the secret **Value** immediately.
4. **API permissions → Add a permission → Microsoft Graph →
   Application permissions → `Calendars.ReadWrite`** → Add, then click
   **Grant admin consent**.
5. *Strongly recommended:* limit the app to only the room-bookings mailbox with
   an [application access policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access),
   so it cannot touch any other calendar in the organisation:

   ```powershell
   New-DistributionGroup -Name "RoomBookingSyncAllowed" -Type Security
   Add-DistributionGroupMember -Identity "RoomBookingSyncAllowed" -Member roombookings@yourcompany.co.uk
   New-ApplicationAccessPolicy -AppId <CLIENT_ID> -PolicyScopeGroupId RoomBookingSyncAllowed@yourcompany.co.uk -AccessRight RestrictAccess
   ```

## What to add to GitHub

In the `room-booking` repository: **Settings → Secrets and variables →
Actions → New repository secret**, add each of:

| Secret name | Value |
|---|---|
| `MS_TENANT_ID` | Directory (tenant) ID from step 2 |
| `MS_CLIENT_ID` | Application (client) ID from step 2 |
| `MS_CLIENT_SECRET` | The secret value from step 3 |
| `OUTLOOK_MAILBOX` | The mailbox that owns the shared calendar, e.g. `roombookings@yourcompany.co.uk` |
| `OUTLOOK_CALENDAR_NAME` | *(optional)* the calendar's name inside that mailbox; leave out to use the mailbox's default calendar |
| `SUPABASE_URL` | Same project URL as in `config.js` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key (keep secret!) |

Then go to the repo's **Actions** tab → **Sync bookings to Outlook** →
**Run workflow** to test. The run's log will say how many bookings were synced.

## Notes

- The sync is one-way. Events added directly in Outlook are **not** seen by the
  booking app — the app is the source of truth, Outlook is the mirror.
- Cancelled bookings are removed from the calendar automatically.
- Until the secrets are added, the job runs and exits harmlessly with
  "not configured yet — skipping".

---

## Request to IT (copy and send)

> Hi,
>
> We're rolling out a simple room booking web app and would like bookings
> mirrored into our shared Outlook calendar. Could you please:
>
> 1. Register an app called **Room Booking Sync** in Microsoft Entra
>    (single tenant, no redirect URI).
> 2. Add the Microsoft Graph **application** permission
>    **Calendars.ReadWrite** and grant admin consent.
> 3. Create a client secret.
> 4. (Recommended) Restrict the app to only the room-bookings mailbox using a
>    `New-ApplicationAccessPolicy`.
> 5. Send me, securely: the **tenant ID**, **client ID**, **client secret**,
>    and the **email address of the mailbox** that owns the room calendar.
>
> The credentials will be stored as encrypted GitHub Actions secrets and used
> only to create/update events in that one calendar.
>
> Thanks!
