# HABD / WILD

Derby Control's board for the East Midlands hot axle box (HABD) and wheel impact load (WILD, Thurmaston)
detectors: which are in use, reporting one out of use or back in use, the fault history, the official
NOP F3.21A / F3.21B for any fault, and the log of the emails that go with them.

Next.js App Router, TypeScript strict, Tailwind v4, Autumn Hub house style. Supabase "Mini Project Hub".
Mounted on Overseer at `https://overseer.derbycontrol.co.uk/habd`; sign-in and the HABD switch are
needed. `index.html` at the root only sends the old GitHub Pages address to Overseer (Next does not
serve it).

## Pages
- **Status board** (`/`): every site by controlling signal box, out of use first. Report out of use (FMS,
  time, notes) and Return to service, each with 90 seconds to undo; CSV export. `?q=` and `?box=` narrow it.
- **Fault history** (`/history`): every fault, its emails and Edit (FMS, times, notes); CSV and JSON backup.
- **F3.21 forms** (`/forms`): the official form filled in for a fault, built in the browser from
  `public/forms` with the same cells as the emailed copy, to save or print.
- **Email log** (`/log`): every F3.21A / F3.21B and 06:00 overview email by day (counts, no addresses).

## Data
- Equipment: `assets.json` in the `Assets` storage bucket (also read by `habd-notify`).
- Fault log: the latest row of `fault_snapshots`. Every change re-reads the latest row, applies itself
  and inserts the whole log as a new row, so an out-of-date screen never overwrites someone else. The
  field shapes are fixed by the server: `"Failure Date"` `YYYY-MM-DDTHH:MM`, `"Date in order"`
  `dd/mm/yyyy HH:MM` (blank = out of use), London wall-clock time.
- Rules are pure and tested: `src/lib/habd/faults.ts`, `forms.ts` (`npm test`).

## Working here
`npm run lint`, `npm run type-check`, `npm test`, `npm run build` before any push. `basePath` is `/habd`;
the root and `/index.html` redirect there and a page load without Overseer's marker goes to Overseer.

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
- PDFs are the official blanks (`public/forms/F3.21A blank.pdf` / `F3.21B blank.pdf`, copied to the
  private `habd-forms` bucket) with the values written into their cells. Times are Europe/London.
- The **Email log** page shows every email, its status and any error.

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
under the same names and re-check the cell positions in `supabase/functions/habd-notify/forms.ts` and `src/lib/habd/forms.ts`
(the page's print copy), and replace the copies in `public/forms` (measured in PDF points).
