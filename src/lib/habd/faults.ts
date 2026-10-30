// HABD / WILD rules: the equipment, its faults and every change the desk makes, as the dashboard has
// always applied them. Pure, so they are tested (faults.test.ts) and shared by the pages.
//
// The fault log is saved whole as a new row of fault_snapshots on every change; the server (the
// habd_on_snapshot trigger and the habd-notify function) reads exactly these fields:
//   "Failure Date"  = "YYYY-MM-DDTHH:MM"   (London wall-clock time)
//   "Date in order" = "dd/mm/yyyy HH:MM"   (London wall-clock time; blank = still out of use)
// so their shapes never change. Times are the desk's local time (a Control PC is on London time).

export interface Asset {
  ID: string;
  FIN?: string;
  "Controlling SB"?: string;
  Location?: string;
  Line?: string;
  Route?: string;
  ELR?: string;
  Mileage?: string;
  "Operational Status"?: string;
}

export interface Fault {
  FIN: string;
  ID: string;
  FMS?: string;
  "Failure Date"?: string;
  "Date in order"?: string;
  Notes?: string;
  "Controlling SB"?: string;
  Location?: string;
  Line?: string;
  Route?: string;
  ELR?: string;
  Mileage?: string;
}

/** A change refused: the message says why, and nothing is saved. */
export interface Abort {
  abort: string;
}

// Assets 30–32 are the Thurmaston WILD sites; their Line also carries "(WILD)".
const WILD_IDS = new Set(["30", "31", "32"]);
export const isWild = (a: Pick<Asset, "ID" | "Line"> | null | undefined) => !!a && (WILD_IDS.has(String(a.ID)) || /\bWILD\b/i.test(a.Line ?? ""));
export const typeOf = (a: Pick<Asset, "ID" | "Line"> | null | undefined) => (isWild(a) ? "WILD" : "HABD");
export const isOpen = (f: Fault) => String(f["Date in order"] ?? "").trim() === "";

const pad = (n: number) => String(n).padStart(2, "0");

/** A wall-clock time in either stored shape, as a local Date; null when it is neither. */
export function parseWall(s: string | null | undefined): Date | null {
  const v = String(s ?? "").trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  return null;
}

/** "dd/mm/yyyy HH:MM", the "Date in order" shape. */
export const fmt = (d: Date | null) => (d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
export const fmtShort = (d: Date | null) => (d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
/** "YYYY-MM-DDTHH:MM", the "Failure Date" shape and a datetime-local input's value. */
export const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Whole calendar days from a to b (never negative). */
export function daysBetween(a: Date | null, b: Date = new Date()): number | null {
  if (!a) return null;
  const x = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const y = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((y - x) / 86_400_000));
}

/** Where a fault is: the asset record wins; the fault's copy taken at booking is the fallback. */
export function locationOf(a: Asset | null | undefined, f?: Fault | null) {
  return {
    loc: a?.Location || f?.Location || "",
    line: a?.Line || f?.Line || "",
    elr: a?.ELR || f?.ELR || "",
    miles: a?.Mileage || f?.Mileage || "",
    route: a?.Route || f?.Route || "",
    box: a?.["Controlling SB"] || f?.["Controlling SB"] || "",
  };
}

const failedAt = (f: Fault) => parseWall(f["Failure Date"])?.getTime() || 0;

/** An asset's open faults, newest first. */
export function openFaultsFor(id: string, list: Fault[]): Fault[] {
  return list.filter((f) => String(f.ID) === String(id) && isOpen(f)).sort((x, y) => failedAt(y) - failedAt(x));
}

/** The next fault number: one past the highest, four digits. */
export function nextFIN(list: Fault[]): string {
  const nums = list.map((f) => parseInt(String(f.FIN || "").replace(/\D/g, ""), 10)).filter((n) => !Number.isNaN(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1).padStart(4, "0");
}

export interface StatusRow {
  a: Asset;
  open: Fault[];
}

export const statusRows = (assets: Asset[], faults: Fault[]): StatusRow[] => assets.map((a) => ({ a, open: openFaultsFor(a.ID, faults) }));

export function summary(rows: StatusRow[]) {
  const off = rows.filter((r) => r.open.length).length;
  const on = (l: StatusRow[]) => l.filter((r) => !r.open.length).length;
  const habd = rows.filter((r) => !isWild(r.a));
  const wild = rows.filter((r) => isWild(r.a));
  return { total: rows.length, off, on: rows.length - off, habdOn: on(habd), habd: habd.length, wildOn: on(wild), wild: wild.length };
}

export type BoardFilter = "all" | "off" | "on" | "habd" | "wild";

export function passFilter(r: StatusRow, filter: BoardFilter): boolean {
  switch (filter) {
    case "off":
      return r.open.length > 0;
    case "on":
      return r.open.length === 0;
    case "habd":
      return !isWild(r.a);
    case "wild":
      return isWild(r.a);
    default:
      return true;
  }
}

export function matchesBoard(r: StatusRow, q: string): boolean {
  if (!q) return true;
  const f = r.open[0];
  return [r.a.ID, r.a.Location, r.a.Line, r.a.ELR, r.a.Mileage, r.a.Route, r.a["Controlling SB"], typeOf(r.a), f?.FMS, f?.FIN, f?.Notes].some((v) => String(v || "").toLowerCase().includes(q.toLowerCase()));
}

/** The board's groups: by controlling signal box, out-of-use first within each. */
export function boardGroups(rows: StatusRow[], shown: StatusRow[]) {
  const groups = new Map<string, StatusRow[]>();
  for (const r of shown) {
    const k = r.a["Controlling SB"] || "Other";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()].map(([box, list]) => {
    const all = rows.filter((r) => (r.a["Controlling SB"] || "Other") === box);
    const off = all.filter((r) => r.open.length).length;
    return { box, total: all.length, off, rows: [...list.filter((r) => r.open.length), ...list.filter((r) => !r.open.length)] };
  });
}

export type HistoryFilter = "all" | "open" | "closed";

export function historyRows(faults: Fault[], byId: (id: string) => Asset | null, filter: HistoryFilter, q: string): Fault[] {
  const needle = q.trim().toLowerCase();
  return faults
    .filter((f) => filter === "all" || (filter === "open" ? isOpen(f) : !isOpen(f)))
    .filter((f) => {
      if (!needle) return true;
      const a = byId(f.ID);
      return [f.FIN, f.FMS, f.Notes, f.ID, a?.Location || f.Location, a?.Line || f.Line, a?.ELR || f.ELR, f["Failure Date"], f["Date in order"]].some((v) => String(v || "").toLowerCase().includes(needle));
    })
    .sort((x, y) => Number(isOpen(y)) - Number(isOpen(x)) || failedAt(y) - failedAt(x));
}

// ------------------------------------------------------------------ changes
// Each takes the latest saved list (a copy, changed in place) and returns its outcome, or an Abort
// when someone else's change got there first. The page re-reads the latest state before every change,
// so an out-of-date screen never overwrites someone else's update.

const FUTURE_SLACK = 5 * 60_000;

/** A reason the time cannot be used, or "". */
export function checkTime(d: Date | null, opts: { after?: Date | null; afterLabel?: string; now?: number } = {}): string {
  if (!d) return "Enter a date and time.";
  if (d.getTime() > (opts.now ?? Date.now()) + FUTURE_SLACK) return "This is in the future.";
  if (opts.after && d.getTime() < opts.after.getTime()) return `This is before ${opts.afterLabel ?? ""} (${fmt(opts.after)}).`;
  return "";
}

/** Report out of use: a new fault on the asset, newest first. */
export function reportOut(list: Fault[], a: Asset, p: { fms: string; failedAt: Date; notes: string }): { fin: string } | Abort {
  if (openFaultsFor(a.ID, list).length) return { abort: `${a.Location} ${a.Line} was already reported out of use by someone else. Nothing was saved.` };
  const fin = nextFIN(list);
  list.unshift({
    FIN: fin,
    ID: a.ID,
    "Controlling SB": a["Controlling SB"] || "",
    Location: a.Location || "",
    Line: a.Line || "",
    Route: a.Route || "",
    ELR: a.ELR || "",
    Mileage: a.Mileage || "",
    FMS: p.fms.trim(),
    "Failure Date": toInput(p.failedAt),
    "Date in order": "",
    Notes: p.notes.trim(),
  });
  return { fin };
}

/** Undo a report out of use (the fault is removed while it is still open). */
export function undoOut(list: Fault[], fin: string): { ok: true } | Abort {
  const i = list.findIndex((f) => f.FIN === fin && isOpen(f));
  if (i < 0) return { abort: "Couldn't undo — this fault has already been changed." };
  list.splice(i, 1);
  return { ok: true };
}

/** Return to service: every open fault on the asset gets the same "Date in order". */
export function returnToService(list: Fault[], a: Asset, at: Date): { closed: string[]; stamp: string } | Abort {
  const stamp = fmt(at);
  const closed: string[] = [];
  for (const f of list) {
    if (String(f.ID) === String(a.ID) && isOpen(f)) {
      f["Date in order"] = stamp;
      closed.push(f.FIN);
    }
  }
  if (!closed.length) return { abort: `${a.Location} ${a.Line} was already returned to service by someone else. Nothing was saved.` };
  return { closed, stamp };
}

/** Undo a return to service: the faults it closed open again, if no one has changed them since. */
export function undoIn(list: Fault[], closed: string[], stamp: string): { ok: true } | Abort {
  let n = 0;
  for (const f of list) {
    if (closed.includes(f.FIN) && f["Date in order"] === stamp) {
      f["Date in order"] = "";
      n++;
    }
  }
  return n ? { ok: true } : { abort: "Couldn't undo — this fault has already been changed." };
}

/** Correct a fault's FMS, times and notes; refused if its open/closed state changed meanwhile. */
export function editFault(list: Fault[], fin: string, wasOpen: boolean, upd: { fms: string; failedAt: Date; inOrderAt: Date | null; notes: string }): { ok: true } | Abort {
  const f = list.find((x) => x.FIN === fin);
  if (!f) return { abort: "This fault no longer exists." };
  if (isOpen(f) !== wasOpen) return { abort: "Someone has changed this fault's status in the meantime. Nothing was saved — please check and try again." };
  f.FMS = upd.fms.trim();
  f["Failure Date"] = toInput(upd.failedAt);
  f.Notes = upd.notes.trim();
  if (!wasOpen && upd.inOrderAt) f["Date in order"] = fmt(upd.inOrderAt);
  return { ok: true };
}

export const isAbort = (r: unknown): r is Abort => !!r && typeof r === "object" && "abort" in r;

// ------------------------------------------------------------------ exports (CSV)

const csvQ = (v: unknown) => `"${String(v ?? "").split('"').join('""')}"`;
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvQ).join(",")).join("\r\n");

export function statusCsv(rows: StatusRow[], now = new Date()): string {
  const head = ["ID", "Type", "Controlling SB", "Location", "Line", "Route", "ELR", "Mileage", "Status", "FIN", "FMS", "Out of use since", "Days out", "Notes"];
  return csv([
    head,
    ...rows.map(({ a, open }) => {
      const f = open[0];
      const since = f ? parseWall(f["Failure Date"]) : null;
      return [a.ID, typeOf(a), a["Controlling SB"], a.Location, a.Line, a.Route, a.ELR, a.Mileage, f ? "Out of use" : "In use", f?.FIN, f?.FMS, since ? fmt(since) : "", f ? daysBetween(since, now) : "", f?.Notes];
    }),
  ]);
}

export function faultsCsv(faults: Fault[], byId: (id: string) => Asset | null): string {
  const head = ["FIN", "ID", "Type", "Controlling SB", "Location", "Line", "Route", "ELR", "Mileage", "FMS", "Out of use from", "Reinstated", "Status", "Notes"];
  return csv([
    head,
    ...faults.map((f) => {
      const a = byId(f.ID);
      const L = locationOf(a, f);
      return [f.FIN, f.ID, typeOf(a || f), L.box, L.loc, L.line, L.route, L.elr, L.miles, f.FMS, fmt(parseWall(f["Failure Date"])) || f["Failure Date"], fmt(parseWall(f["Date in order"])) || f["Date in order"], isOpen(f) ? "Out of use" : "Reinstated", f.Notes];
    }),
  ]);
}
