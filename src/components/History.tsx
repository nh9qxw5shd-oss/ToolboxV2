"use client";

// Fault history: every fault booked, open ones first, with its emails, return to service and Edit.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";
import { Badge, Card, Chips, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { Dialogs, MailChip, UndoBar, type DialogState } from "@/components/habd";
import { download } from "@/lib/download";
import { daysBetween, faultsCsv, fmt, historyRows, isOpen, locationOf, parseWall, typeOf, type HistoryFilter } from "@/lib/habd/faults";
import { assetById, useHabd } from "@/lib/habd/store";

const FILTERS: { value: Exclude<HistoryFilter, "all">; label: string; color?: string }[] = [
  { value: "open", label: "Out of use now", color: "var(--poor)" },
  { value: "closed", label: "Reinstated", color: "var(--good)" },
];

function When({ d, raw }: { d: Date | null; raw?: string }) {
  if (!d) return <span className="text-faint">{raw || "—"}</span>;
  const s = fmt(d);
  return (
    <span className="whitespace-nowrap">
      <b className="font-mono font-semibold">{s.slice(0, 10)}</b> <span className="font-mono text-dim">{s.slice(-5)}</span>
    </span>
  );
}

export default function History() {
  const params = useSearchParams();
  const { faults, mail, loaded } = useHabd();
  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [seenQ, setSeenQ] = useState(urlQ);
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    setQ(urlQ);
  }
  const [filter, setFilter] = useState<Exclude<HistoryFilter, "all"> | "">("");
  const [dialog, setDialog] = useState<DialogState>(null);

  if (!loaded) return <PageSkeleton kind="table" />;
  const list = historyRows(faults, assetById, filter || "all", q);
  const open = faults.filter(isOpen).length;

  return (
    <>
      <PageHeader
        eyebrow="HABD / WILD"
        title="Fault history"
        subtitle="Every fault booked on the detectors, out of use ones first. Edit corrects an FMS number, a time or a note; emails already sent are not sent again."
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => download("habd-wild-fault-history.csv", faultsCsv(faults, assetById), "text/csv")}>
              <Download size={14} /> Export CSV
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => download("faults-backup.json", JSON.stringify({ faults }, null, 2), "application/json")}>
              <Download size={14} /> Backup (JSON)
            </button>
          </>
        }
      />
      <UndoBar />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input className="input pl-9" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search FIN, FMS, location, notes…" aria-label="Search faults" />
        </div>
        <Chips options={FILTERS} value={filter} onChange={setFilter} allLabel="All" counts={{ "": faults.length, open, closed: faults.length - open }} />
      </div>
      <Card padded={false} subtitle={`${list.length} of ${faults.length} fault records`} title="Faults">
        {list.length ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>FIN</th>
                  <th>Equipment</th>
                  <th>FMS</th>
                  <th>Out from</th>
                  <th>Reinstated</th>
                  <th>Days</th>
                  <th>Emails</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((f) => {
                  const a = assetById(f.ID);
                  const L = locationOf(a, f);
                  const o = isOpen(f);
                  const from = parseWall(f["Failure Date"]);
                  const to = parseWall(f["Date in order"]);
                  return (
                    <tr key={f.FIN}>
                      <td>{o ? <Badge color="var(--poor)">Out of use</Badge> : <Badge color="var(--good)">Reinstated</Badge>}</td>
                      <td className="font-mono font-bold">{f.FIN}</td>
                      <td className="min-w-48">
                        <div className="font-semibold">{L.loc} — {L.line}</div>
                        <div className="text-xs text-dim">{typeOf(a ?? f)} · {[L.elr, L.miles].filter(Boolean).join(" ")}</div>
                      </td>
                      <td className="font-mono whitespace-nowrap">{f.FMS}</td>
                      <td><When d={from} raw={f["Failure Date"]} /></td>
                      <td>{o ? <span className="text-faint">—</span> : <When d={to} raw={f["Date in order"]} />}</td>
                      <td className="font-mono">{from ? daysBetween(from, to ?? new Date()) : ""}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <MailChip mail={mail} kind="A" fin={f.FIN} />
                          <MailChip mail={mail} kind="B" fin={f.FIN} />
                        </div>
                      </td>
                      <td className="min-w-48 max-w-80 text-xs whitespace-pre-wrap text-dim">{f.Notes}</td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {o && a && (
                            <button className="btn btn-primary btn-sm whitespace-nowrap" onClick={() => setDialog({ kind: "in", asset: a })}>
                              Return to service
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: "edit", fin: f.FIN })}>
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Search} title="No faults match" />
        )}
      </Card>
      <Dialogs state={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
