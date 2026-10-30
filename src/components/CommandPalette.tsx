"use client";

// Command palette (Ctrl/Cmd + K): jump to a section, find a point set (opens its area and
// highlights it), jump to a MOM area, add or edit a point.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, CornerDownLeft, History, LucideIcon, Search } from "lucide-react";
import { useHotkey } from "@/lib/hooks";
import { NAV } from "@/lib/nav";
import { isOpen, locationOf, statusRows, typeOf } from "@/lib/habd/faults";
import { useHabd } from "@/lib/habd/store";

const OPEN_EVENT = "habd:palette";
export function openPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

interface Entry {
  id: string;
  group: string;
  title: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

function score(e: Entry, q: string): number {
  const hay = `${e.title} ${e.hint ?? ""} ${e.keywords ?? ""}`.toLowerCase();
  if (!q) return 1;
  let s = 0;
  for (const t of q.split(/\s+/).filter(Boolean)) {
    if (e.title.toLowerCase().startsWith(t)) s += 3;
    else if (e.title.toLowerCase().includes(t)) s += 2;
    else if (hay.includes(t)) s += 1;
    else return 0;
  }
  return s;
}

export function CommandPalette() {
  const router = useRouter();
  const { assets, faults } = useHabd();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);

  function show() {
    setQ("");
    setCursor(0);
    setOpen(true);
  }

  useHotkey("mod+k", () => (open ? setOpen(false) : show()), { inInputs: true });
  useHotkey("escape", () => setOpen(false), { inInputs: true });

  useEffect(() => {
    const on = () => show();
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = NAV.map((n) => ({ id: `p-${n.href}`, group: "Pages", title: n.label, hint: n.desc, icon: n.icon, keywords: n.keywords, run: () => router.push(n.href) }));
    const sites: Entry[] = statusRows(assets, faults).map(({ a, open }) => ({
      id: `s-${a.ID}`,
      group: "Sites",
      title: `${a.Location} — ${a.Line}`,
      hint: `${typeOf(a)} · ${a["Controlling SB"] ?? ""} · ${open.length ? `OUT OF USE (FIN ${open[0].FIN})` : "in use"}`,
      icon: open.length ? CircleAlert : CircleCheck,
      keywords: `${a.ID} ${a.ELR ?? ""} ${a.Mileage ?? ""} ${a.Route ?? ""}`,
      run: () => router.push(`/?q=${encodeURIComponent(a.Location ?? "")}`),
    }));
    const fins: Entry[] = faults.slice(0, 300).map((f) => {
      const L = locationOf(assets.find((a) => a.ID === String(f.ID)), f);
      return { id: `f-${f.FIN}`, group: "Faults", title: `FIN ${f.FIN} · ${L.loc} ${L.line}`, hint: `${isOpen(f) ? "Out of use" : "Reinstated"}${f.FMS ? ` · FMS ${f.FMS}` : ""}`, icon: History, keywords: `${f.FMS ?? ""} ${f.Notes ?? ""}`, run: () => router.push(`/history?q=${encodeURIComponent(f.FIN)}`) };
    });
    return [...pages, ...sites, ...fins];
  }, [assets, faults, router]);

  const needle = q.trim().toLowerCase();
  const results = useMemo(
    () =>
      (needle
        ? entries
            .map((e) => ({ e, s: score(e, needle) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => x.e)
        : entries.filter((e) => e.group !== "Faults")
      ).slice(0, 18),
    [needle, entries],
  );

  const resultsKey = `${needle}|${results.length}`;
  const [seenKey, setSeenKey] = useState(resultsKey);
  if (seenKey !== resultsKey) {
    setSeenKey(resultsKey);
    setCursor(0);
  }

  function go(e: Entry) {
    setOpen(false);
    e.run();
  }

  if (!open) return null;

  const groups: { name: string; entries: Entry[] }[] = [];
  for (const e of results) {
    const g = groups.find((x) => x.name === e.group);
    if (g) g.entries.push(e);
    else groups.push({ name: e.group, entries: [e] });
  }
  let idx = -1;

  return (
    <div className="backdrop flex items-start justify-center px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-modal aria-label="Command palette" className="card scale-in w-full max-w-xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-edge px-3">
          <Search size={16} className="text-faint" />
          <input
            autoFocus
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            placeholder="Section, point number, location or area…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(results.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[cursor]) go(results[cursor]);
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-dim">Nothing matches “{q}”.</p>}
          {groups.map((g) => (
            <div key={g.name} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">{g.name}</div>
              {g.entries.map((e) => {
                idx += 1;
                const i = idx;
                const active = i === cursor;
                return (
                  <button
                    key={e.id}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${active ? "text-ink" : "text-dim hover:bg-hover hover:text-ink"}`}
                    style={active ? { background: "var(--accent-soft)" } : undefined}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(e)}
                  >
                    <e.icon size={16} className={active ? "text-accent" : "text-faint"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{e.title}</span>
                      {e.hint && <span className="block truncate text-xs text-faint">{e.hint}</span>}
                    </span>
                    {active ? <CornerDownLeft size={14} className="text-faint" /> : <ArrowRight size={14} className="opacity-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-edge px-3 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd> open
          </span>
          <span className="ml-auto">Points appear as you type</span>
        </div>
      </div>
    </div>
  );
}
