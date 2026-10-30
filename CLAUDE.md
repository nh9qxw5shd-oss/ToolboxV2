# HABD / WILD (ToolboxV2)

Next.js App Router, React 19, TypeScript strict, Tailwind v4, Supabase ("Mini Project Hub", anon key
with the signed-in Overseer person's session). The HABD / WILD detector board; see README.md.

## Working here
- Checks before any push: `npm run lint`, `npm run type-check`, `npm test` (`node --test`, so
  relative imports inside `src/lib` carry the `.ts` suffix), `npm run build`.
- Rules live in `src/lib/habd/faults.ts` (board, history, the changes and their refusals, CSV) and
  `forms.ts` (F3.21A / F3.21B cells), pure and tested. Keep the fault fields and their shapes: the
  `habd_on_snapshot` trigger and the `habd-notify` function read them (a complete `"Date in order"`
  is what sends an F3.21B). `forms.ts` matches `supabase/functions/habd-notify/forms.ts`; change both.
- Every change goes through `commit` (`src/lib/habd/store.ts`): re-read the latest snapshot, apply,
  insert a new row. Never update or delete a `fault_snapshots` row.
- Emails stay on the server (`supabase/`): the trigger queues, `habd_tick` (pg_cron) wakes
  `habd-notify`, which sends with the service role. The page only reads the log
  (`habd_recent_notifications`).
- Hand-built URLs (the blank forms) carry `process.env.NEXT_PUBLIC_BASE_PATH`.
- Mounted on the Derby Control hub (PotatOS) at `overseer.derbycontrol.co.uk/habd`; `basePath` is
  `/habd` (`next.config.ts`) on the standalone hostname too. Browser storage keys are prefixed `habd_`.
- Overseer is the only way in: the Vercel project has no domain and is reached only through
  `overseer.derbycontrol.co.uk/habd` (PotatOS docs/09 §4.6). The last redirect in `next.config` sends a page
  load without Overseer's `x-overseer-hop` marker to the same address on Overseer. Do not add a domain.

## Design language
Autumn Hub house style (`nh9qxw5shd-oss/autumn-hub`, `web/src/`): the stylesheet, `ui.tsx` and
`uiFeedback.tsx` are copied by hand; keep them in step. Network Rail orange brand mark. Mobile
width 390 px with no horizontal scroll.

Writing and commits: no model names or identifiers in code, README, commit messages or PR text.
