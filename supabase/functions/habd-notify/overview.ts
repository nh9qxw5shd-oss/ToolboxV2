// Daily overview email: every asset and its status, with full detail for anything out of use.
// Table-based, inline-styled HTML so it renders properly in Outlook desktop.

import { Asset, daysSince, esc, Fault, isOpen, isWild, locationOf, londonNow, parseWallClock } from "./shared.ts";

export type AssetStatus = {
  asset: Asset;
  wild: boolean;
  fault: Fault | null; // newest open fault, if the asset is out of use
};

// Same rule the dashboard uses: an asset is defective while it has any open fault; the newest
// open fault (by Failure Date) is the one reported.
export function statusOf(assets: Asset[], faults: Fault[]): AssetStatus[] {
  const sortKey = (f: Fault) => {
    const p = parseWallClock(f["Failure Date"]);
    return p ? p.date.split("/").reverse().join("") + p.time : "";
  };
  return assets.map((asset) => {
    const open = faults.filter((f) => String(f.ID) === String(asset.ID) && isOpen(f));
    open.sort((x, y) => sortKey(y).localeCompare(sortKey(x)));
    return { asset, wild: isWild(asset), fault: open[0] ?? null };
  });
}

const C = {
  ink: "#151a21",
  muted: "#566170",
  faint: "#8a94a3",
  line: "#e3e6eb",
  bg: "#f5f6f8",
  brand: "#005172", // NOP form border blue
  slab: "#3a9fbe", // NOP form label blue
  ok: "#15803d",
  okBg: "#dcfce7",
  bad: "#b91c1c",
  badBg: "#fee2e2",
};

const pill = (bad: boolean) =>
  bad
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${C.badBg};color:${C.bad};font-size:11px;font-weight:700">OUT OF USE</span>`
    : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${C.okBg};color:${C.ok};font-size:11px;font-weight:700">IN USE</span>`;

function tile(label: string, value: string, colour: string) {
  return `<td width="33%" style="padding:0 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${C.line};border-radius:6px"><tr><td style="padding:10px 12px">
<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${esc(label)}</div>
<div style="font-size:24px;font-weight:700;color:${colour};margin-top:2px">${esc(value)}</div></td></tr></table></td>`;
}

function offlineCard(s: AssetStatus) {
  const f = s.fault!;
  const loc = locationOf(s.asset, f);
  const since = parseWallClock(f["Failure Date"]);
  const days = daysSince(f["Failure Date"]);
  const sub = [s.wild ? "WILD" : "HABD", `Asset ${s.asset.ID}`, [loc.elr, loc.mileage].filter(Boolean).join(" "), loc.route, loc.box]
    .filter(Boolean)
    .join(" · ");
  const facts: [string, string][] = [
    ["FIN", f.FIN],
    ["FMS ref", f.FMS ?? ""],
    ["Out of use since", since ? `${since.date} ${since.time}` : String(f["Failure Date"] ?? "")],
    ["Days out", days == null ? "" : String(days)],
  ];
  const fact = ([k, v]: [string, string]) =>
    `<td width="25%" style="padding:4px 8px 0 0;vertical-align:top"><div style="font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:${C.muted}">${esc(k)}</div><div style="font-size:13px;font-weight:600;color:${C.ink}">${esc(v || "—")}</div></td>`;
  const notes = String(f.Notes ?? "").trim();
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 10px;border:1px solid ${C.line};border-left:4px solid ${C.bad};border-radius:6px">
<tr><td style="padding:10px 14px 0"><span style="font-size:15px;font-weight:700;color:${C.ink}">${esc(loc.location)}</span><span style="font-size:14px;color:${C.ink}">&nbsp;·&nbsp;${esc(loc.line)}</span>
<div style="font-size:12px;color:${C.muted};margin-top:1px">${esc(sub)}</div></td></tr>
<tr><td style="padding:4px 14px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${facts.map(fact).join("")}</tr></table>${
    notes ? `<div style="margin-top:8px;font-size:12px;color:${C.ink}"><span style="color:${C.muted}">Notes:</span> ${esc(notes)}</div>` : ""
  }</td></tr></table>`;
}

function assetTable(list: AssetStatus[]) {
  const th = (h: string, align = "left") =>
    `<th align="${align}" style="padding:6px 8px;background:#f1f3f6;color:${C.muted};font-size:11px;font-weight:600;border-bottom:1px solid ${C.line}">${h}</th>`;
  const td = (v: string, extra = "") => `<td style="padding:6px 8px;border-bottom:1px solid #eef0f3;font-size:12px;color:${C.ink};${extra}">${v}</td>`;
  const body = list
    .map((s) => {
      const loc = locationOf(s.asset, s.fault);
      const bad = !!s.fault;
      return `<tr${bad ? ` style="background:#fff7f7"` : ""}>${td(esc(s.asset.ID), "color:" + C.muted)}${td(`<b>${esc(loc.location)}</b>`)}${td(esc(loc.line))}${td(
        esc([loc.elr, loc.mileage].filter(Boolean).join(" ")),
        "white-space:nowrap",
      )}${td(s.wild ? "WILD" : "HABD")}${td(pill(bad), "white-space:nowrap")}</tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid ${C.line}">
<tr>${th("ID")}${th("Location")}${th("Line")}${th("ELR / mileage")}${th("Type")}${th("Status")}</tr>${body}</table>`;
}

export function buildOverview(statuses: AssetStatus[], opts: { banner?: string | null; replyTo?: string | null; now?: Date } = {}) {
  const now = londonNow(opts.now);
  const offline = statuses.filter((s) => s.fault);
  offline.sort((a, b) => (daysSince(b.fault!["Failure Date"]) ?? 0) - (daysSince(a.fault!["Failure Date"]) ?? 0));
  const total = statuses.length;
  const habd = statuses.filter((s) => !s.wild);
  const wild = statuses.filter((s) => s.wild);
  const inUse = (l: AssetStatus[]) => l.filter((s) => !s.fault).length;

  // Group the full list by controlling signal box, in first-seen order (the asset list is
  // already ordered geographically).
  const groups = new Map<string, AssetStatus[]>();
  for (const s of statuses) {
    const key = String(s.asset["Controlling SB"] || "Other");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const subject = offline.length
    ? `HABD/WILD daily status ${now.date}: ${offline.length} out of use`
    : `HABD/WILD daily status ${now.date}: all ${total} in use`;

  const bannerHtml = opts.banner
    ? `<div style="margin:0 0 16px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e;white-space:pre-line">${esc(opts.banner)}</div>`
    : "";

  const offlineHtml = offline.length
    ? offline.map(offlineCard).join("")
    : `<p style="margin:0;font-size:13px;color:${C.ok}">All HABD and WILD equipment is in use.</p>`;

  const groupsHtml = [...groups.entries()]
    .map(
      ([box, list]) =>
        `<h3 style="margin:18px 0 6px;font-size:13px;color:${C.ink}">${esc(box)} <span style="font-weight:400;color:${C.muted}">· ${inUse(list)} of ${list.length} in use</span></h3>${assetTable(list)}`,
    )
    .join("");

  const section = (t: string) =>
    `<h2 style="margin:22px 0 10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${C.brand}">${esc(t)}</h2>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg};font-family:Segoe UI,Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.bg};padding:20px 0"><tr><td align="center">
<table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;background:#ffffff;border:1px solid ${C.line};border-radius:8px">
<tr><td style="padding:16px 22px;border-bottom:3px solid ${C.brand}">
<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">HABD / WILD · East Midlands</div>
<div style="font-size:19px;font-weight:700;color:${C.ink};margin-top:2px">Daily equipment status</div>
<div style="font-size:12px;color:${C.muted};margin-top:2px">As at ${esc(now.time)} ${esc(now.date)}</div></td></tr>
<tr><td style="padding:18px 18px 4px">${bannerHtml}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
${tile("In use", `${total - offline.length} / ${total}`, C.ok)}
${tile("Out of use", String(offline.length), offline.length ? C.bad : C.ok)}
${tile("HABD · WILD in use", `${inUse(habd)}/${habd.length} · ${inUse(wild)}/${wild.length}`, C.ink)}
</tr></table></td></tr>
<tr><td style="padding:0 22px 18px">
${section(`Out of use (${offline.length})`)}${offlineHtml}
${section(`All equipment (${total})`)}${groupsHtml}
</td></tr>
<tr><td style="padding:12px 22px;border-top:1px solid #eef0f3;font-size:11px;color:${C.faint}">Sent automatically by the HABD/WILD EM tracker. A CSV of all equipment is attached.${
    opts.replyTo ? ` Replies go to ${esc(opts.replyTo)}.` : ""
  }</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    opts.banner ?? "",
    `HABD / WILD daily equipment status, as at ${now.time} ${now.date}`,
    `In use: ${total - offline.length} of ${total}. Out of use: ${offline.length}.`,
    "",
    "OUT OF USE",
    ...(offline.length
      ? offline.map((s) => {
          const f = s.fault!;
          const loc = locationOf(s.asset, f);
          const since = parseWallClock(f["Failure Date"]);
          return `- ${loc.location} ${loc.line} (${loc.elr} ${loc.mileage}), ${s.wild ? "WILD" : "HABD"}, FIN ${f.FIN}, FMS ${f.FMS ?? ""}, since ${
            since ? `${since.date} ${since.time}` : ""
          } (${daysSince(f["Failure Date"]) ?? "?"} days)${f.Notes ? ` — ${f.Notes}` : ""}`;
        })
      : ["None"]),
  ]
    .filter((l, i) => i > 0 || l)
    .join("\n");

  return { subject, html, text, csv: toCsv(statuses) };
}

export function toCsv(statuses: AssetStatus[]): string {
  const head = ["ID", "Type", "Controlling SB", "Location", "Line", "Route", "ELR", "Mileage", "Status", "FIN", "FMS", "Out of use since", "Days out", "Notes"];
  const q = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = statuses.map((s) => {
    const loc = locationOf(s.asset, s.fault);
    const f = s.fault;
    const since = f ? parseWallClock(f["Failure Date"]) : null;
    return [
      s.asset.ID,
      s.wild ? "WILD" : "HABD",
      loc.box,
      loc.location,
      loc.line,
      loc.route,
      loc.elr,
      loc.mileage,
      f ? "Out of use" : "In use",
      f?.FIN ?? "",
      f?.FMS ?? "",
      since ? `${since.date} ${since.time}` : "",
      f ? (daysSince(f["Failure Date"]) ?? "") : "",
      f?.Notes ?? "",
    ].map(q).join(",");
  });
  return [head.map(q).join(","), ...rows].join("\r\n") + "\r\n";
}
