-- HABD / WILD behind Overseer sign-in (30 Oct 2026), as every other mounted system (PotatOS docs 07
-- §4.13–4.14). Apply once the habd switch is on for the desk: from then on the fault log, the
-- equipment list and the email log answer only a signed-in person with HABD / WILD switched on, and
-- the old GitHub Pages page (anon key) can no longer read or write.
--
-- The emails are unaffected: habd_on_snapshot and habd_tick are SECURITY DEFINER and habd-notify uses
-- the service role.

-- Fault log: read and add only (a change is always a new snapshot). The public policies are retired
-- (switched off and renamed retired_*), not dropped.
select public.hub_rls_secure('{"fault_snapshots": {"ops": "SI", "read": ["habd"]}}');

-- Equipment list: the Assets bucket stops being public.
update storage.buckets set public = false where id = 'Assets';
create policy sec_assets_habd_select on storage.objects for select to authenticated
  using (bucket_id = 'Assets' and (select public.hub_can_any('{habd}'::text[])));

-- Email log: signed-in people with HABD / WILD on only.
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
  where (select public.hub_can_any('{habd}'::text[]))
  order by o.id desc
  limit least(greatest(max_rows, 1), 200)
$$;

revoke all on function public.habd_recent_notifications(int) from public, anon;
grant execute on function public.habd_recent_notifications(int) to authenticated;
