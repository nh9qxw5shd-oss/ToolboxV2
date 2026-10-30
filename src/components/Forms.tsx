"use client";

// F3.21 forms: the official F3.21A (outage) or F3.21B (reinstatement) filled in for a fault, built in
// the browser from the blank forms in public/forms with the same cells as the emailed copies, to print
// or save. ?fin= and ?kind= pick the fault.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, ExternalLink, FileText } from "lucide-react";
import { Card, EmptyState, Field, PageHeader, PageSkeleton } from "@/components/ui";
import { useToast } from "@/components/uiFeedback";
import { useLocalStorage } from "@/lib/hooks";
import { download } from "@/lib/download";
import { buildFormA, buildFormB } from "@/lib/habd/forms";
import { fmt, isOpen, locationOf, parseWall, type Fault } from "@/lib/habd/faults";
import { assetById, useHabd } from "@/lib/habd/store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const BLANK = { A: `${BASE}/forms/F3.21A%20blank.pdf`, B: `${BASE}/forms/F3.21B%20blank.pdf` };

function label(f: Fault): string {
  const L = locationOf(assetById(f.ID), f);
  const from = parseWall(f["Failure Date"]);
  return `FIN ${f.FIN} · ${L.loc} ${L.line} · ${from ? fmt(from) : f["Failure Date"] || ""}${isOpen(f) ? " · out of use" : ""}`;
}

export default function Forms() {
  const params = useSearchParams();
  const toast = useToast();
  const { faults, loaded } = useHabd();
  const [kind, setKind] = useState<"A" | "B">(params.get("kind") === "B" ? "B" : "A");
  const [fin, setFin] = useState(params.get("fin") ?? "");
  const [signed, setSigned] = useLocalStorage("habd_form_signed", "Derby Control");
  const [url, setUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  // B is the reinstatement, so only reinstated faults have one. Newest outage (A) or reinstatement (B) first.
  const at = (f: Fault) => parseWall(f[kind === "A" ? "Failure Date" : "Date in order"])?.getTime() || 0;
  const choices = faults.filter((f) => kind === "A" || !isOpen(f)).sort((x, y) => at(y) - at(x));
  const fault = choices.find((f) => f.FIN === fin) ?? choices[0];

  useEffect(() => {
    if (!fault) return;
    let gone = false;
    let made: string | null = null;
    (async () => {
      try {
        const res = await fetch(BLANK[kind]);
        if (!res.ok) throw new Error(`the blank form could not be read (${res.status})`);
        const blank = new Uint8Array(await res.arrayBuffer());
        const input = { fault, asset: assetById(fault.ID), signedBy: signed };
        const out = kind === "A" ? await buildFormA(blank, input) : await buildFormB(blank, input);
        if (gone) return;
        made = URL.createObjectURL(new Blob([new Uint8Array(out)], { type: "application/pdf" }));
        setBytes(out);
        setUrl(made);
      } catch (e) {
        if (!gone) toast.error("Form not built", (e as Error).message);
      }
    })();
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the fault, form or signature changes
  }, [fault?.FIN, fault?.["Date in order"], fault?.FMS, kind, signed]);

  if (!loaded) return <PageSkeleton kind="form" />;
  const name = fault ? `F3.21${kind} FIN ${fault.FIN}.pdf` : "";

  return (
    <>
      <PageHeader eyebrow="HABD / WILD" title="F3.21 forms" subtitle="The official NOP F3.21A (outage) or F3.21B (reinstatement) filled in for a fault, as emailed to the distribution list. Print it or save it as a PDF." />
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-[12rem_1fr_14rem]">
          <Field label="Form">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "A" | "B")}>
              <option value="A">F3.21A – Outage</option>
              <option value="B">F3.21B – Reinstatement</option>
            </select>
          </Field>
          <Field label="Fault">
            <select className="input" value={fault?.FIN ?? ""} onChange={(e) => setFin(e.target.value)} disabled={!choices.length}>
              {choices.map((f) => (
                <option key={f.FIN} value={f.FIN}>
                  {label(f)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Signed">
            <input className="input" value={signed} onChange={(e) => setSigned(e.target.value)} />
          </Field>
        </div>
        {fault && url && bytes && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => download(name, bytes, "application/pdf")}>
              <Download size={15} /> Save PDF
            </button>
            <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Open to print
            </a>
          </div>
        )}
      </Card>
      {!fault ? (
        <Card>
          <EmptyState icon={FileText} title={kind === "B" ? "No reinstated faults yet" : "No faults booked"} />
        </Card>
      ) : url ? (
        <Card padded={false} title={name}>
          <iframe src={url} title={name} className="block h-[75vh] w-full rounded-b-[14px] bg-white" />
        </Card>
      ) : (
        <PageSkeleton kind="form" />
      )}
    </>
  );
}
