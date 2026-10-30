"use client";

// The status board: every HABD and WILD site by controlling signal box, out-of-use sites first, with
// report out of use / return to service on each card. ?q= and ?box= (the palette and the sidebar's
// signal boxes) narrow it.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, CircleX, Download, Search, X } from "lucide-react";
import { Badge, Card, Chips, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { Dialogs, MailChip, UndoBar, type DialogState } from "@/components/habd";
import { download } from "@/lib/download";
import { boardGroups, daysBetween, fmt, locationOf, matchesBoard, parseWall, passFilter, statusCsv, statusRows, summary, typeOf, type BoardFilter, type StatusRow } from "@/lib/habd/faults";
import { useHabd } from "@/lib/habd/store";

const FILTERS: { value: Exclude<BoardFilter, "all">; label: string; color?: string }[] = [
  { value: "off", label: "Out of use", color: "var(--poor)" },
  { value: "on", label: "In use", color: "var(--good)" },
  { value: "habd", label: "HABD" },
  { value: "wild", label: "WILD" },
];

function SiteCard({ r, onDialog }: { r: StatusRow; onDialog: (d: DialogState) => void }) {
  const { mail } = useHabd();
  const { a, open } = r;
  const f = open[0];
  const L = locationOf(a, f);
  const since = f ? parseWall(f["Failure Date"]) : null;
  const off = !!f;
  return (
    <article className="card flex flex-col gap-3 p-4" style={{ borderLeft: `3px solid ${off ? "var(--poor)" : "var(--good)"}` }} aria-label={`${L.loc} ${L.line} ${off ? "out of use" : "in use"}`}>
      <div className="flex items-center justify-between gap-2">
        <Badge color={off ? "var(--poor)" : "var(--good)"}>{off ? <><CircleX size={12} /> Out of use</> : <><CircleCheck size={12} /> In use</>}</Badge>
        <span className="font-mono text-[11px] font-semibold text-faint">{typeOf(a)} · ID {a.ID}</span>
      </div>
      <div>
        <h3 className="text-[15px] font-bold leading-tight">{L.loc}</h3>
        <div className="text-sm text-dim">{L.line}</div>
        <div className="mt-0.5 text-xs text-faint">{[L.elr, L.miles].filter(Boolean).join(" ")}{L.route ? ` · ${L.route}` : ""}</div>
      </div>
      {off && (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <div><dt className="text-faint">Out since</dt><dd className="font-mono font-semibold">{since ? fmt(since) : f["Failure Date"] || "—"}</dd></div>
            <div><dt className="text-faint">Days out</dt><dd className="font-mono font-semibold">{daysBetween(since) ?? "—"}</dd></div>
            <div><dt className="text-faint">FMS</dt><dd className="font-mono font-semibold">{f.FMS || "—"}</dd></div>
            <div><dt className="text-faint">FIN</dt><dd className="font-mono font-semibold">{f.FIN}</dd></div>
          </dl>
          {f.Notes && <p className="whitespace-pre-wrap rounded-md bg-sunken px-2.5 py-1.5 text-xs text-dim">{f.Notes}</p>}
          {open.length > 1 && <p className="text-xs text-poor">{open.length} open faults on this site: returning it to service closes all of them.</p>}
          <div><MailChip mail={mail} kind="A" fin={f.FIN} /></div>
        </>
      )}
      <div className="mt-auto">
        {off ? (
          <button className="btn btn-primary w-full" onClick={() => onDialog({ kind: "in", asset: a })}>
            <CircleCheck size={15} /> Return to service
          </button>
        ) : (
          <button className="btn btn-ghost w-full border border-edge" onClick={() => onDialog({ kind: "out", asset: a })}>
            Report out of use
          </button>
        )}
      </div>
    </article>
  );
}

export default function Board() {
  const params = useSearchParams();
  const router = useRouter();
  const { assets, faults, loaded, error } = useHabd();
  const urlQ = params.get("q") ?? "";
  const box = params.get("box") ?? "";
  const [q, setQ] = useState(urlQ);
  const [seenQ, setSeenQ] = useState(urlQ);
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    setQ(urlQ);
  }
  const [filter, setFilter] = useState<Exclude<BoardFilter, "all"> | "">("");
  const [dialog, setDialog] = useState<DialogState>(null);

  if (!loaded) return <PageSkeleton kind="cards" />;
  if (!assets.length) return <EmptyState title="The equipment list could not be read" hint={error ?? "Try again in a moment."} />;

  const rows = statusRows(assets, faults);
  const s = summary(rows);
  const inBox = box ? rows.filter((r) => (r.a["Controlling SB"] || "Other") === box) : rows;
  const shown = inBox.filter((r) => passFilter(r, filter || "all") && matchesBoard(r, q.trim()));
  const groups = boardGroups(rows, shown);
  const pick = (v: Exclude<BoardFilter, "all">) => setFilter((f) => (f === v ? "" : v));

  return (
    <>
      <PageHeader
        eyebrow="HABD / WILD"
        title="Status board"
        subtitle="Hot axle box and wheel impact load detectors on the East Midlands. Report a failure or a reinstatement here; the F3.21A / F3.21B is emailed to the distribution list automatically."
        actions={
          <button className="btn btn-ghost btn-sm" onClick={() => download("habd-wild-status.csv", statusCsv(rows), "text/csv")}>
            <Download size={14} /> Export CSV
          </button>
        }
      />
      <UndoBar />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: "on" as const, label: "In use", value: s.on, sub: `of ${s.total} sites`, color: "var(--good)" },
          { k: "off" as const, label: "Out of use", value: s.off, sub: s.off ? "need returning to service" : "none", color: s.off ? "var(--poor)" : undefined },
          { k: "habd" as const, label: "HABD in use", value: `${s.habdOn} / ${s.habd}`, sub: "hot axle box detectors" },
          { k: "wild" as const, label: "WILD in use", value: `${s.wildOn} / ${s.wild}`, sub: "wheel impact load (Thurmaston)" },
        ].map((x) => (
          <button key={x.k} type="button" className="card card-link block px-4 py-3 text-left" aria-pressed={filter === x.k} onClick={() => pick(x.k)} style={filter === x.k ? { borderColor: "var(--accent)" } : undefined}>
            <div className="lbl mb-0">{x.label}</div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight tnum" style={x.color ? { color: x.color } : undefined}>{x.value}</div>
            <div className="mt-0.5 text-xs text-dim">{x.sub}</div>
          </button>
        ))}
      </div>

      <details className="card mb-5 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">How to record equipment going out of use or coming back into use</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-dim">
          <li><b className="text-ink">Failed or disconnected:</b> find it below and press <b className="text-ink">Report out of use</b>. Enter the FMS reference and the time it failed. An <b className="text-ink">F3.21A</b> is emailed to the distribution list automatically.</li>
          <li><b className="text-ink">Back in use:</b> find the red card and press <b className="text-ink">Return to service</b>. Check the time it was reinstated. An <b className="text-ink">F3.21B</b> is emailed automatically.</li>
          <li>Made a mistake? Press <b className="text-ink">Undo</b> on the bar that appears. You have 90 seconds, and nothing is emailed until two minutes after you save.</li>
          <li>Need to correct an FMS number or note later? Use <b className="text-ink">Fault history → Edit</b>. Emails already sent are not sent again.</li>
        </ol>
      </details>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input className="input pl-9" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search location, line, ELR, FMS…" aria-label="Search equipment" />
        </div>
        <Chips options={FILTERS} value={filter} onChange={setFilter} allLabel="All" />
        {box && (
          <button className="chip" aria-pressed onClick={() => router.push("/")}>
            {box} <X size={12} />
          </button>
        )}
      </div>

      {groups.length ? (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.box}>
              <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-sm font-bold tracking-wide">
                {g.box}
                <span className="font-normal text-dim">· {g.total - g.off} of {g.total} in use</span>
                {g.off ? <Badge color="var(--poor)">{g.off} out</Badge> : <Badge color="var(--good)">all in use</Badge>}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {g.rows.map((r) => (
                  <SiteCard key={r.a.ID} r={r} onDialog={setDialog} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={Search} title="Nothing matches this search or filter" />
        </Card>
      )}
      <Dialogs state={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
