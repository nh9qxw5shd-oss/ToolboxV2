[README.md](https://github.com/user-attachments/files/23289638/README.md)
# HABD WILD EM — GitHub Pages Pack

This folder is structured for **GitHub Pages** hosting.

## Files
- `index.html` — your dashboard (served at `/`).
- `.nojekyll` — disables Jekyll processing so static files are served as-is.
- `404.html` — basic redirect back to `/` if someone hits a bad path.

## Deploy to GitHub Pages
1. Create a new public repository on GitHub (e.g., `habd-wild-em`).
2. Upload these files to the repo **root** (so `index.html` sits at the top level).
3. Go to **Settings → Pages**.
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `/ (root)`
   - Click **Save**.
4. Your site will appear at: `https://<your-username>.github.io/<repo-name>/`.

## Data persistence (GitHub Pages is static)
GitHub Pages **cannot** run serverless functions. For saving changes, use one of:
- **Supabase** (recommended): store your `{ assets, faults }` JSON in a table and call it via the JS client.
- **Cloudflare Workers/KV**: host the API endpoint separately and point the dashboard to it.
- **Any REST API** you control.

If your current dashboard sends `GET/PUT` to `/api/state`, update the JS to point to your chosen backend endpoint, e.g.:
```js
const API = 'https://your-worker-or-supabase-endpoint.example.com/api/state';
// GET
const state = await fetch(API).then(r=>r.json());
// PUT
await fetch(API, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(state) });
```

> Tip: If you want me to wire this to Supabase for you, share the anon key + URL and I'll hand back a drop-in HTML.

---

## Notifications (F3.21A / F3.21B and daily overview)

Emails are sent by the server, not the browser, from `alerts@habd.derbycontrol.co.uk` via Resend.

```
dashboard saves fault_snapshots ──trigger habd_on_snapshot──▶ habd_email_outbox
pg_cron every minute ──habd_tick()──▶ queues daily overview (06:00 London) + wakes habd-notify
habd-notify ──▶ re-checks latest snapshot ──▶ fills official blank F3.21A/B PDF ──▶ Resend
```

- **F3.21A** is queued when a new FIN appears in the fault log (booked).
- **F3.21B** is queued when a fault's *Date in order* becomes a complete date and time
  (`dd/mm/yyyy hh:mm`, as "Close now" stamps it). Partly typed values are ignored.
- Each form waits `grace_minutes` (default 2) and is re-checked before sending, so a typo corrected
  straight away is not advised. One A and one B per FIN, ever.
- PDFs are the official blanks (`Blank PDF F3.21A.pdf` / `F3.21B.pdf`, copied to the private
  `habd-forms` bucket) with the values written into their cells. Times are Europe/London.
- The **Notifications** tab shows every email, its status and any error.

Code: `supabase/functions/habd-notify/`, schema: `supabase/migrations/20260925210000_habd_notifications.sql`.

### Operating it (Supabase SQL editor)

```sql
-- Mode: 'disarmed' (nothing sent), 'test' (test_recipients only, [TEST] banner), 'armed' (live lists)
update habd_settings set mode = 'armed';

-- Distribution lists: 'forms' (F3.21A/B) and 'overview' (daily status)
insert into habd_recipients (list, email) values ('forms', 'someone@networkrail.co.uk');
update habd_recipients set active = false where lower(email) = lower('someone@networkrail.co.uk');

-- Other settings
update habd_settings set overview_hour = 6;                -- London hour for the daily overview
update habd_settings set signed_by = 'EMCC Route Control'; -- printed in SIGNED box (blank if null)
update habd_settings set reply_to = 'someone@networkrail.co.uk';

-- Send a test of any email to test_recipients
insert into habd_email_outbox (kind, fin, is_test) values ('A', '0065', true);
insert into habd_email_outbox (kind, is_test) values ('overview', true);

-- What went out
select id, kind, fin, status, mode, subject, error, sent_at from habd_email_outbox order by id desc limit 20;
```

Blank forms: if the official F3.21A/B are reissued, upload the new PDFs to the `habd-forms` bucket
under the same names and re-check the cell positions in `forms.ts` (measured in PDF points).
