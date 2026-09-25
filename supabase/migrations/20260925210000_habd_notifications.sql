-- HABD/WILD notifications rebuild.
--
-- Outage (F3.21A) and reinstatement (F3.21B) emails used to be fired from whichever browser made
-- the change, to a single hard-coded inbox, via an unauthenticated edge function. They are now
-- detected in the database from the fault snapshots the dashboard already saves, queued in an
-- outbox, and sent by the habd-notify edge function to the distribution lists below.
--
--   fault_snapshots insert ──trigger──▶ habd_email_outbox (A / B, after a short grace period)
--   pg_cron every minute ──habd_tick()──▶ queues the daily overview; wakes habd-notify when
--                                          anything is due
--   habd-notify ──▶ re-checks the latest snapshot, renders the official PDF, sends via Resend

-- ---------------------------------------------------------------------------------------------
-- Settings (single row) and secrets

create table public.habd_settings (
  id boolean primary key default true check (id),
  -- disarmed: nothing sent (recorded as suppressed); test: test_recipients only, marked [TEST];
  -- armed: the distribution lists.
  mode text not null default 'test' check (mode in ('disarmed', 'test', 'armed')),
  from_addr text not null,
  reply_to text,
  test_recipients text[] not null default '{}',
  signed_by text, -- printed in the SIGNED box of issued forms; blank if null
  grace_minutes int not null default 2 check (grace_minutes between 0 and 60),
  overview_hour int not null default 6 check (overview_hour between 0 and 23), -- Europe/London
  function_url text not null,
  updated_at timestamptz not null default now()
);
comment on table public.habd_settings is 'HABD/WILD notifications: single-row settings (mode, sender, overview time).';

create table public.habd_secrets (
  key text primary key,
  value text not null
);
comment on table public.habd_secrets is 'HABD/WILD notifications: shared secret between pg_cron and habd-notify. RLS with no policies.';

insert into public.habd_secrets (key, value)
values ('function_secret', encode(extensions.gen_random_bytes(32), 'hex'));

-- ---------------------------------------------------------------------------------------------
-- Distribution lists

create table public.habd_recipients (
  id bigserial primary key,
  list text not null check (list in ('forms', 'overview')),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index habd_recipients_list_email on public.habd_recipients (list, lower(email));
comment on table public.habd_recipients is 'HABD/WILD notifications: distribution lists. forms = F3.21A/B, overview = daily status.';

-- ---------------------------------------------------------------------------------------------
-- Outbox

create table public.habd_email_outbox (
  id bigserial primary key,
  kind text not null check (kind in ('A', 'B', 'overview')),
  fin text,
  snapshot_id bigint,
  -- One A and one B per FIN, one overview per day. Cancelled rows don't count, so a fault that
  -- disappears and comes back (e.g. an out-of-date browser tab saving over it) is still advised.
  dedupe_key text,
  is_test boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled', 'suppressed', 'skipped')),
  send_after timestamptz not null default now(),
  attempts int not null default 0,
  claimed_at timestamptz,
  mode text,
  to_emails text[],
  intended_emails text[],
  subject text,
  attachment text,
  resend_id text,
  error text,
  note text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (kind = 'overview' or fin is not null)
);
create unique index habd_email_outbox_dedupe on public.habd_email_outbox (dedupe_key) where status <> 'cancelled';
create index habd_email_outbox_due on public.habd_email_outbox (send_after) where status in ('queued', 'failed', 'sending');
comment on table public.habd_email_outbox is 'HABD/WILD notifications: every F3.21A/B and daily overview email, queued, sent or not, with the outcome.';

alter table public.habd_settings enable row level security;
alter table public.habd_secrets enable row level security;
alter table public.habd_recipients enable row level security;
alter table public.habd_email_outbox enable row level security;
-- No policies: only the service role (habd-notify) and the SECURITY DEFINER functions below
-- touch these tables. The dashboard reads the log through habd_recent_notifications().

-- ---------------------------------------------------------------------------------------------
-- Detection

-- A "Date in order" only counts as a reinstatement once it is a complete date and time. The
-- dashboard saves as people type, so "2", "25/09" etc. must not trigger an F3.21B.
create or replace function public.habd_is_wallclock(s text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    btrim(s) ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
    or btrim(s) ~ '^\d{2}/\d{2}/\d{4}[ T]\d{2}:\d{2}$',
    false)
$$;

create or replace function public.habd_on_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev jsonb;
  grace int;
  f jsonb;
  pf jsonb;
  fin_ text;
begin
  select s.faults into prev
  from public.fault_snapshots s
  where s.id < new.id
  order by s.id desc
  limit 1;

  if prev is null or jsonb_typeof(prev) <> 'array' or jsonb_typeof(new.faults) <> 'array' then
    return new;
  end if;

  select coalesce(max(grace_minutes), 2) into grace from public.habd_settings;

  for f in select value from jsonb_array_elements(new.faults) loop
    fin_ := nullif(btrim(f ->> 'FIN'), '');
    continue when fin_ is null;

    select e.value into pf from jsonb_array_elements(prev) e where e.value ->> 'FIN' = fin_ limit 1;

    if pf is null and coalesce(btrim(f ->> 'Date in order'), '') = '' then
      -- Newly booked fault → F3.21A
      insert into public.habd_email_outbox (kind, fin, snapshot_id, dedupe_key, send_after)
      values ('A', fin_, new.id, 'A:' || fin_, now() + make_interval(mins => grace))
      on conflict (dedupe_key) where status <> 'cancelled' do nothing;
    elsif pf is not null
      and public.habd_is_wallclock(f ->> 'Date in order')
      and not public.habd_is_wallclock(pf ->> 'Date in order') then
      -- Fault closed with a complete date/time → F3.21B
      insert into public.habd_email_outbox (kind, fin, snapshot_id, dedupe_key, send_after)
      values ('B', fin_, new.id, 'B:' || fin_, now() + make_interval(mins => grace))
      on conflict (dedupe_key) where status <> 'cancelled' do nothing;
    end if;
  end loop;

  return new;
exception when others then
  -- Never block the dashboard from saving.
  raise warning 'habd_on_snapshot: %', sqlerrm;
  return new;
end;
$$;

create trigger habd_on_snapshot
after insert on public.fault_snapshots
for each row execute function public.habd_on_snapshot();

-- ---------------------------------------------------------------------------------------------
-- Scheduler: every minute. Queues the daily overview at overview_hour (London time, so it
-- doesn't drift with BST) and wakes habd-notify only when something is due.

create or replace function public.habd_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.habd_settings;
  local_now timestamp := now() at time zone 'Europe/London';
  secret text;
begin
  select * into s from public.habd_settings limit 1;
  if s is null then
    return;
  end if;

  if extract(hour from local_now)::int = s.overview_hour then
    insert into public.habd_email_outbox (kind, dedupe_key)
    values ('overview', 'overview:' || to_char(local_now, 'YYYY-MM-DD'))
    on conflict (dedupe_key) where status <> 'cancelled' do nothing;
  end if;

  if exists (
    select 1 from public.habd_email_outbox o
    where (o.status in ('queued', 'failed') and o.attempts < 3 and o.send_after <= now())
       or (o.status = 'sending' and o.attempts < 3 and o.claimed_at < now() - interval '10 minutes')
  ) then
    select value into secret from public.habd_secrets where key = 'function_secret';
    perform net.http_post(
      url := s.function_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-habd-secret', secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Read-only log for the dashboard (anon). Addresses are not exposed, only counts.

create or replace function public.habd_recent_notifications(max_rows int default 50)
returns table (
  id bigint,
  kind text,
  fin text,
  status text,
  mode text,
  is_test boolean,
  recipients int,
  subject text,
  error text,
  created_at timestamptz,
  sent_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.kind, o.fin, o.status, o.mode, o.is_test, coalesce(cardinality(o.to_emails), 0),
         o.subject, o.error, o.created_at, o.sent_at
  from public.habd_email_outbox o
  order by o.id desc
  limit least(greatest(max_rows, 1), 200)
$$;

revoke all on function public.habd_on_snapshot() from public, anon, authenticated;
revoke all on function public.habd_tick() from public, anon, authenticated;
revoke all on function public.habd_recent_notifications(int) from public;
grant execute on function public.habd_recent_notifications(int) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Private bucket for the official blank forms (Blank PDF F3.21A.pdf / F3.21B.pdf)

insert into storage.buckets (id, name, public)
values ('habd-forms', 'habd-forms', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Initial configuration. Starts in TEST mode: everything goes to test_recipients only.

insert into public.habd_settings (mode, from_addr, reply_to, test_recipients, function_url)
values (
  'test',
  'HABD/WILD EM <alerts@habd.derbycontrol.co.uk>',
  'bradley.garner@networkrail.co.uk',
  array['bradley.garner@networkrail.co.uk'],
  'https://ungtmfwxqawkdiflmora.supabase.co/functions/v1/habd-notify'
);

insert into public.habd_recipients (list, email)
select l.list, e.email
from (values ('forms'), ('overview')) as l(list)
cross join (values
  ('Nick.Taylor@networkrail.co.uk'),
  ('Neil.Teather@networkrail.co.uk'),
  ('Gary.Lilliman@networkrail.co.uk'),
  ('Daniel.Smith5@networkrail.co.uk'),
  ('Christopher.Myers@networkrail.co.uk'),
  ('Chris.Hodson@networkrail.co.uk'),
  ('Dominic.Jofirisi@networkrail.co.uk'),
  ('Steven.DOLBY@networkrail.co.uk'),
  ('Andrew.Sneesby@networkrail.co.uk'),
  ('Paul.Heron@networkrail.co.uk'),
  ('Grant.Hobbs@networkrail.co.uk'),
  ('generic-NCC@networkrail.co.uk'),
  ('Control.derby@networkrail.co.uk')
) as e(email);

select cron.schedule('habd-notify-tick', '* * * * *', 'select public.habd_tick()');
