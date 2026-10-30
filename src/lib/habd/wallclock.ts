// London wall-clock helpers for the F3.21 forms, as the habd-notify email function has them
// (supabase/functions/habd-notify/shared.ts): "now" always formatted through Europe/London, and a
// stored fault time reformatted, never converted.

export type Parts = { date: string; time: string };

export function londonNow(d = new Date()): Parts {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute}` };
}

// "2026-07-09T15:08", "2022-06-17 00:00:00" (legacy) or "25/09/2026 14:30".
export function parseWallClock(s: string | null | undefined): Parts | null {
  const v = String(s ?? "").trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return { date: `${m[3]}/${m[2]}/${m[1]}`, time: `${m[4]}:${m[5]}` };
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})$/);
  if (m) return { date: `${m[1]}/${m[2]}/${m[3]}`, time: `${m[4]}:${m[5]}` };
  return null;
}
