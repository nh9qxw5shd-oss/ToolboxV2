// Shared types and helpers for habd-notify. Pure functions only — no I/O — so they can be
// exercised locally with `deno run` against the real blank forms.

export type Asset = {
  ID: string;
  "Controlling SB"?: string;
  Location?: string;
  Line?: string;
  Route?: string;
  ELR?: string;
  Mileage?: string;
};

export type Fault = {
  FIN: string;
  ID: string;
  FMS?: string;
  "Failure Date"?: string;
  "Date in order"?: string;
  Notes?: string;
  Location?: string;
  Line?: string;
  Route?: string;
  ELR?: string;
  Mileage?: string;
  "Controlling SB"?: string;
};

export type Parts = { date: string; time: string };

// Assets 30–32 are the Thurmaston WILD sites; their Line also carries "(WILD)".
const WILD_IDS = new Set(["30", "31", "32"]);
export function isWild(a: Asset | null | undefined): boolean {
  if (!a) return false;
  return WILD_IDS.has(String(a.ID)) || /\bWILD\b/i.test(a.Line ?? "");
}

export const isOpen = (f: Fault) => String(f["Date in order"] ?? "").trim() === "";

// "Now" as London wall-clock time. Edge functions run in UTC, which put every form sent
// during BST an hour behind; always format through Europe/London.
export function londonNow(d = new Date()): Parts {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute}` };
}

// Fault timestamps are London wall-clock strings typed or stamped by the dashboard, in one of:
//   "2026-07-09T15:08"  (datetime-local, Failure Date)
//   "2022-06-17 00:00:00" (legacy seed data)
//   "25/09/2026 14:30"  (Close now / typed Date in order)
// They are reformatted, never time-zone converted.
export function parseWallClock(s: string | null | undefined): Parts | null {
  const v = String(s ?? "").trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return { date: `${m[3]}/${m[2]}/${m[1]}`, time: `${m[4]}:${m[5]}` };
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})$/);
  if (m) return { date: `${m[1]}/${m[2]}/${m[3]}`, time: `${m[4]}:${m[5]}` };
  return null;
}

// Whole days between a wall-clock fault time and now (London), for the overview.
export function daysSince(s: string | null | undefined, now = new Date()): number | null {
  const p = parseWallClock(s);
  if (!p) return null;
  const [dd, mm, yyyy] = p.date.split("/").map(Number);
  const n = londonNow(now).date.split("/").map(Number);
  const a = Date.UTC(yyyy, mm - 1, dd);
  const b = Date.UTC(n[2], n[1] - 1, n[0]);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// The asset record is authoritative for location details; the fault row carries a copy
// taken at booking time as a fallback.
export function locationOf(a: Asset | null | undefined, f: Fault | null | undefined) {
  const pick = (k: keyof Asset & keyof Fault) => String(a?.[k] || f?.[k] || "");
  return {
    route: pick("Route"),
    elr: pick("ELR"),
    location: pick("Location"),
    line: pick("Line"),
    mileage: pick("Mileage"),
    box: pick("Controlling SB"),
  };
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
