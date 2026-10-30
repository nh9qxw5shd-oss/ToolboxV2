"use client";

// The board's and the history's shared pieces: the email chips, the three dialogs (report out of use,
// return to service, correct a fault) and the undo bar. Every change goes through store.commit, which
// re-reads the latest log first; the server emails F3.21A / F3.21B about two minutes after a change,
// so an undo inside 90 seconds stops the email.

import { useEffect, useState, useSyncExternalStore } from "react";
import { CircleAlert, Mail, RotateCcw } from "lucide-react";
import { Badge, Drawer, Field } from "@/components/ui";
import { useToast } from "@/components/uiFeedback";
import { useNow } from "@/lib/hooks";
import { checkTime, editFault, fmt, fmtShort, isAbort, isOpen, locationOf, openFaultsFor, parseWall, reportOut, returnToService, toInput, typeOf, undoIn, undoOut, type Asset, type Fault } from "@/lib/habd/faults";
import { assetById, commit, holdRefresh, mailFor, useHabd } from "@/lib/habd/store";
import type { Notification } from "@/lib/habd/data";

const UNDO_MS = 90_000;
const FUTURE_SLACK = 5 * 60_000;

// ------------------------------------------------------------------ email chips

const MAIL_TEXT: Record<string, [string, string]> = {
  sent: ["var(--good)", "sent"],
  queued: ["var(--moderate)", "sending shortly"],
  sending: ["var(--moderate)", "sending"],
  failed: ["var(--poor)", "failed – retrying"],
  cancelled: ["var(--text-faint)", "cancelled (undone)"],
  suppressed: ["var(--text-faint)", "not sent (email off)"],
  skipped: ["var(--text-faint)", "skipped"],
};

export function MailChip({ mail, kind, fin }: { mail: Notification[]; kind: "A" | "B"; fin: string }) {
  const n = mailFor(mail, kind, fin);
  if (!n) return null;
  const [color, text] = MAIL_TEXT[n.status] ?? ["var(--text-faint)", n.status];
  const when = n.sent_at ? fmtShort(new Date(n.sent_at)) : "";
  return (
    <Badge color={color}>
      <span className="inline-flex items-center gap-1" title={n.error || n.subject || ""}>
        <Mail size={11} /> {kind === "A" ? "F3.21A" : "F3.21B"} {text} {n.status === "sent" ? when : ""}
      </span>
    </Badge>
  );
}

// ------------------------------------------------------------------ undo bar

type Undo = { text: string; until: number; run: () => Promise<void> } | null;
let undo: Undo = null;
const undoSubs = new Set<() => void>();
const setUndo = (u: Undo) => {
  undo = u;
  undoSubs.forEach((f) => f());
};

export function UndoBar() {
  const u = useSyncExternalStore(
    (f) => {
      undoSubs.add(f);
      return () => undoSubs.delete(f);
    },
    () => undo,
    () => null,
  );
  const now = useNow(1000).getTime();
  const [busy, setBusy] = useState(false);
  if (!u || now > u.until) return null;
  return (
    <div className="card fade-up mb-4 flex flex-wrap items-center gap-3 px-4 py-3" role="status" style={{ borderLeft: "3px solid var(--accent)" }}>
      <span className="min-w-0 flex-1 text-sm">{u.text}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await u.run();
          setBusy(false);
          setUndo(null);
        }}
      >
        <RotateCcw size={13} /> Undo ({Math.ceil((u.until - now) / 1000)} s)
      </button>
    </div>
  );
}

const undoUntil = () => Date.now() + UNDO_MS;
const emailAt = () => fmtShort(new Date(Date.now() + 120_000)).slice(-5);

// ------------------------------------------------------------------ dialogs

export type DialogState = { kind: "out"; asset: Asset } | { kind: "in"; asset: Asset } | { kind: "edit"; fin: string } | null;

function AssetBox({ a, f }: { a: Asset | null; f?: Fault }) {
  const L = locationOf(a, f);
  return (
    <div className="mb-4 rounded-lg border border-edge bg-sunken p-3">
      <div className="font-bold">
        {L.loc} — {L.line}
      </div>
      <div className="text-xs text-dim">
        {typeOf(a ?? (f as Fault))} · {[L.elr, L.miles].filter(Boolean).join(" ")} · {L.route} · {L.box} · ID {a?.ID ?? f?.ID}
      </div>
    </div>
  );
}

export function Dialogs({ state, onClose }: { state: DialogState; onClose: () => void }) {
  useEffect(() => {
    if (!state) return;
    holdRefresh(true);
    return () => holdRefresh(false);
  }, [state]);
  if (!state) return null;
  if (state.kind === "out") return <OutDialog asset={state.asset} onClose={onClose} />;
  if (state.kind === "in") return <InDialog asset={state.asset} onClose={onClose} />;
  return <EditDialog fin={state.fin} onClose={onClose} />;
}

function DateTime({ value, onChange, min }: { value: string; onChange: (v: string) => void; min?: string }) {
  const now = useNow(30_000);
  return <input type="datetime-local" className="input" value={value} max={toInput(new Date(now.getTime() + FUTURE_SLACK))} min={min} onChange={(e) => onChange(e.target.value)} />;
}

const Err = ({ msg }: { msg: string }) => (msg ? <p className="mt-1 flex items-center gap-1 text-xs text-poor"><CircleAlert size={12} /> {msg}</p> : null);

function OutDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const toast = useToast();
  const [fms, setFms] = useState("");
  const [time, setTime] = useState(() => toInput(new Date()));
  const [notes, setNotes] = useState("");
  const [errs, setErrs] = useState({ fms: "", time: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    const d = parseWall(time);
    const e = { fms: fms.trim() ? "" : "Enter the FMS fault number.", time: checkTime(d) };
    setErrs(e);
    if (e.fms || e.time || !d) return;
    setBusy(true);
    const r = await commit((list) => reportOut(list, asset, { fms, failedAt: d, notes }));
    setBusy(false);
    if (isAbort(r)) return void toast.error("Not saved", r.abort);
    onClose();
    toast.success(`${asset.Location} ${asset.Line} is out of use`, `FIN ${r.fin}. F3.21A is emailed at about ${emailAt()}.`);
    setUndo({
      text: `${asset.Location} ${asset.Line} reported out of use (FIN ${r.fin}). F3.21A goes at about ${emailAt()}.`,
      until: undoUntil(),
      run: async () => {
        const u = await commit((list) => undoOut(list, r.fin));
        if (isAbort(u)) toast.error("Not undone", u.abort);
        else toast.success("Undone", `${asset.Location} ${asset.Line} is back in use and no F3.21A will be sent.`);
      },
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Report out of use"
      subtitle="An F3.21A is emailed to the distribution list about two minutes after you save."
      width="max-w-lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={busy} onClick={save}>Report out of use</button>
        </>
      }
    >
      <AssetBox a={asset} />
      <div className="space-y-3">
        <Field label="FMS fault number" required>
          <input className="input font-mono" value={fms} onChange={(e) => setFms(e.target.value)} autoFocus placeholder="e.g. 1234567" />
          <Err msg={errs.fms} />
        </Field>
        <Field label="Failed at" required hint="When it went out of use (London time).">
          <DateTime value={time} onChange={setTime} />
          <Err msg={errs.time} />
        </Field>
        <Field label="Notes">
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason, who reported it, anything the next shift needs" />
        </Field>
      </div>
    </Drawer>
  );
}

function InDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const toast = useToast();
  const { faults } = useHabd();
  const open = openFaultsFor(asset.ID, faults);
  const since = open.map((x) => parseWall(x["Failure Date"])).filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  const [time, setTime] = useState(() => toInput(new Date()));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const d = parseWall(time);
    const e = checkTime(d, { after: since, afterLabel: "it went out of use" });
    setErr(e);
    if (e || !d) return;
    setBusy(true);
    const r = await commit((list) => returnToService(list, asset, d));
    setBusy(false);
    if (isAbort(r)) return void toast.error("Not saved", r.abort);
    onClose();
    toast.success(`${asset.Location} ${asset.Line} is back in use`, `F3.21B is emailed at about ${emailAt()}.`);
    setUndo({
      text: `${asset.Location} ${asset.Line} returned to service. F3.21B goes at about ${emailAt()}.`,
      until: undoUntil(),
      run: async () => {
        const u = await commit((list) => undoIn(list, r.closed, r.stamp));
        if (isAbort(u)) toast.error("Not undone", u.abort);
        else toast.success("Undone", `${asset.Location} ${asset.Line} is out of use again and no F3.21B will be sent.`);
      },
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Return to service"
      subtitle="An F3.21B is emailed to the distribution list about two minutes after you save."
      width="max-w-lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>Return to service</button>
        </>
      }
    >
      <AssetBox a={asset} f={open[0]} />
      <p className="mb-3 text-sm text-dim">
        Out of use since <b className="text-ink">{since ? fmt(since) : "—"}</b> · FMS <b className="text-ink">{open.map((x) => x.FMS).filter(Boolean).join(", ") || "—"}</b> · FIN <b className="text-ink">{open.map((x) => x.FIN).join(", ")}</b>
        {open.length > 1 && <span className="mt-1 block text-poor">{open.length} open faults on this site: returning it to service closes all of them.</span>}
      </p>
      <Field label="Back in use at" required hint="When it was reinstated (London time).">
        <DateTime value={time} onChange={setTime} min={since ? toInput(since) : undefined} />
        <Err msg={err} />
      </Field>
    </Drawer>
  );
}

function EditDialog({ fin, onClose }: { fin: string; onClose: () => void }) {
  const toast = useToast();
  const { faults } = useHabd();
  const f0 = faults.find((x) => x.FIN === fin);
  const wasOpen = f0 ? isOpen(f0) : true;
  const [fms, setFms] = useState(f0?.FMS ?? "");
  const [from, setFrom] = useState(() => {
    const d = parseWall(f0?.["Failure Date"]);
    return d ? toInput(d) : "";
  });
  const [to, setTo] = useState(() => {
    const d = parseWall(f0?.["Date in order"]);
    return d ? toInput(d) : "";
  });
  const [notes, setNotes] = useState(f0?.Notes ?? "");
  const [errs, setErrs] = useState({ fms: "", from: "", to: "" });
  const [busy, setBusy] = useState(false);
  if (!f0) return null;

  async function save() {
    const d1 = parseWall(from);
    const d2 = wasOpen ? null : parseWall(to);
    const e = { fms: fms.trim() ? "" : "The FMS reference can't be blank.", from: checkTime(d1), to: wasOpen ? "" : checkTime(d2, { after: d1, afterLabel: "it went out of use" }) };
    setErrs(e);
    if (e.fms || e.from || e.to || !d1) return;
    setBusy(true);
    const r = await commit((list) => editFault(list, fin, wasOpen, { fms, failedAt: d1, inOrderAt: d2, notes }));
    setBusy(false);
    if (isAbort(r)) return void toast.error("Not saved", r.abort);
    onClose();
    toast.success(`FIN ${fin} corrected`, "Emails already sent are not sent again.");
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Correct fault details"
      subtitle={`FIN ${fin} · ${wasOpen ? "out of use" : "reinstated"}`}
      width="max-w-lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>Save correction</button>
        </>
      }
    >
      <AssetBox a={assetById(f0.ID)} f={f0} />
      <div className="space-y-3">
        <Field label="FMS fault number" required>
          <input className="input font-mono" value={fms} onChange={(e) => setFms(e.target.value)} />
          <Err msg={errs.fms} />
        </Field>
        <Field label="Out of use from" required>
          <DateTime value={from} onChange={setFrom} />
          <Err msg={errs.from} />
        </Field>
        {!wasOpen && (
          <Field label="Reinstated" required>
            <DateTime value={to} onChange={setTo} />
            <Err msg={errs.to} />
          </Field>
        )}
        <Field label="Notes">
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
