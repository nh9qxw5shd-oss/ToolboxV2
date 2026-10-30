"use client";

// Email log: every F3.21A / F3.21B and daily overview email and what happened to it, by day, newest
// first (habd_recent_notifications: counts only, no addresses).

import { useState } from "react";
import { ChevronRight, Mail, RefreshCw } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui";
import { fmt } from "@/lib/habd/faults";
import { loadMail, useHabd } from "@/lib/habd/store";
import type { Notification } from "@/lib/habd/data";

const KIND: Record<string, string> = { A: "F3.21A outage", B: "F3.21B reinstated", overview: "Daily overview" };
const COLOR: Record<string, string> = { sent: "var(--good)", failed: "var(--poor)", queued: "var(--moderate)", sending: "var(--moderate)" };

const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" });

function Group({ day, rows, first }: { day: string; rows: Notification[]; first: boolean }) {
  const [open, setOpen] = useState(first);
  const sent = rows.filter((n) => n.status === "sent").length;
  const failed = rows.filter((n) => n.status === "failed").length;
  return (
    <section className="card">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={15} className="text-faint transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
        <span className="text-sm font-bold">{day}</span>
        <span className="text-xs text-dim">
          {rows.length} email{rows.length === 1 ? "" : "s"} · {sent} sent
        </span>
        {failed > 0 && <Badge color="var(--poor)">{failed} failed</Badge>}
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-edge">
          <table className="tbl">
            <thead>
              <tr>
                <th>Queued</th>
                <th>Email</th>
                <th>FIN</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Recipients</th>
                <th>Subject / detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td className="font-mono whitespace-nowrap">{fmt(new Date(n.created_at)).slice(-5)}</td>
                  <td className="whitespace-nowrap">{KIND[n.kind] ?? n.kind}</td>
                  <td className="font-mono">{n.fin}</td>
                  <td>
                    <Badge color={COLOR[n.status] ?? "var(--text-faint)"}>
                      {n.status}
                      {n.is_test || n.mode === "test" ? " (test)" : ""}
                    </Badge>
                  </td>
                  <td className="font-mono whitespace-nowrap">{n.sent_at ? fmt(new Date(n.sent_at)) : ""}</td>
                  <td className="font-mono">{n.recipients || ""}</td>
                  <td className="min-w-64 text-xs text-dim">{n.error || n.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function EmailLog() {
  const { mail, loaded } = useHabd();
  const [busy, setBusy] = useState(false);
  if (!loaded) return <PageSkeleton kind="table" />;
  const days = new Map<string, Notification[]>();
  for (const n of mail) days.set(dayOf(n.created_at), [...(days.get(dayOf(n.created_at)) ?? []), n]);

  return (
    <>
      <PageHeader
        eyebrow="HABD / WILD"
        title="Email log"
        subtitle="Every F3.21A / F3.21B and 06:00 overview email, newest first, sent from habd.derbycontrol.co.uk. Addresses are not shown, only how many were sent to."
        actions={
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await loadMail();
              setBusy(false);
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />
      {days.size ? (
        <div className="space-y-3">
          {[...days.entries()].map(([day, rows], i) => (
            <Group key={day} day={day} rows={rows} first={i === 0} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={Mail} title="No emails yet" />
        </Card>
      )}
    </>
  );
}
