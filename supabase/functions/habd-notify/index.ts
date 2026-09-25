// habd-notify — sends HABD/WILD F3.21A / F3.21B forms and the daily overview.
//
// Woken by public.habd_tick() (pg_cron, every minute) whenever habd_email_outbox has something
// due. Authenticated by the x-habd-secret header, which must match habd_secrets.function_secret;
// nothing else can make it send, and recipients only ever come from habd_recipients.
//
// Per row: re-checks the latest fault snapshot (so a fault corrected or closed within the grace
// period isn't mis-advised), fills the official blank form, and sends through Resend from the
// habd.derbycontrol.co.uk domain.
//
// POST {}                          drain the outbox (what cron does)
// POST {"preview":"A","fin":"0055"} return the rendered PDF without sending (A, B or overview → HTML)
//
// Deployed with verify_jwt = false (custom secret auth above).

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { buildFormA, buildFormB } from "./forms.ts";
import { buildOverview, statusOf } from "./overview.ts";
import { Asset, esc, Fault, isWild, locationOf, parseWallClock, toBase64 } from "./shared.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAX_ATTEMPTS = 3;

type Mode = "disarmed" | "test" | "armed";

interface Settings {
  mode: Mode;
  from_addr: string;
  reply_to: string | null;
  test_recipients: string[];
  signed_by: string | null;
}

interface OutboxRow {
  id: number;
  kind: "A" | "B" | "overview";
  fin: string | null;
  is_test: boolean;
  status: string;
  attempts: number;
}

type Email = { subject: string; html: string; text: string; attachment: { filename: string; content: Uint8Array | string } };

// ---------------------------------------------------------------------------------------------
// Data

async function latestFaults(admin: SupabaseClient): Promise<Fault[]> {
  const { data, error } = await admin.from("fault_snapshots").select("faults").order("id", { ascending: false }).limit(1);
  if (error) throw new Error(`fault_snapshots: ${error.message}`);
  const faults = data?.[0]?.faults;
  return Array.isArray(faults) ? faults : [];
}

async function loadAssets(admin: SupabaseClient): Promise<Asset[]> {
  const { data, error } = await admin.storage.from("Assets").download("assets.json");
  if (error) throw new Error(`assets.json: ${error.message}`);
  const parsed = JSON.parse(await data.text());
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("assets.json is empty");
  return parsed;
}

const blanks = new Map<string, Uint8Array>();
async function blankForm(admin: SupabaseClient, kind: "A" | "B"): Promise<Uint8Array> {
  const name = `Blank PDF F3.21${kind}.pdf`;
  if (!blanks.has(name)) {
    const { data, error } = await admin.storage.from("habd-forms").download(name);
    if (error) throw new Error(`habd-forms/${name}: ${error.message}`);
    blanks.set(name, new Uint8Array(await data.arrayBuffer()));
  }
  return blanks.get(name)!;
}

// ---------------------------------------------------------------------------------------------
// Emails

function formEmail(kind: "A" | "B", fault: Fault, asset: Asset | null, pdf: Uint8Array, banner: string | null, replyTo: string | null): Email {
  const loc = locationOf(asset, fault);
  const system = isWild(asset) ? "WILD" : "HABD";
  const where = [loc.location, loc.line].filter(Boolean).join(" ");
  const from = parseWallClock(fault["Failure Date"]);
  const back = parseWallClock(fault["Date in order"]);
  const outage = kind === "A";

  const subject = outage
    ? `${system} F3.21A – OUT OF USE – ${where} – FMS ${fault.FMS ?? ""} (FIN ${fault.FIN})`
    : `${system} F3.21B – REINSTATED – ${where} – FMS ${fault.FMS ?? ""} (FIN ${fault.FIN})`;
  const heading = outage ? `${system} out of use — advice of system outage` : `${system} reinstated — advice of system reinstatement`;
  const intro = outage
    ? `The ${system} at ${where} has been reported out of use. The completed NOP F3.21A is attached.`
    : `The ${system} at ${where} has been reinstated. The completed NOP F3.21B is attached.`;

  const rows: [string, string][] = [
    ["Location", loc.location],
    ["Line", loc.line],
    ["ELR / mileage", [loc.elr, loc.mileage].filter(Boolean).join(" ")],
    ["Route", loc.route],
    ["Controlling SB", loc.box],
    ["FMS ref", fault.FMS ?? ""],
    ["FIN", fault.FIN],
    ["Out of use from", from ? `${from.time} ${from.date}` : ""],
    ...(outage ? [] : ([["Reinstated", back ? `${back.time} ${back.date}` : ""]] as [string, string][])),
    ["Notes", fault.Notes ?? ""],
  ].filter(([, v]) => String(v).trim() !== "") as [string, string][];

  const accent = outage ? "#b91c1c" : "#15803d";
  const bannerHtml = banner
    ? `<div style="margin:0 0 16px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;font-size:12px;color:#92400e;white-space:pre-line">${esc(banner)}</div>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f6f8;font-family:Segoe UI,Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f6f8;padding:20px 0"><tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e3e6eb;border-radius:8px">
<tr><td style="padding:16px 22px;border-bottom:3px solid ${accent}"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#566170">NOP F3.21${kind} · HABD / WILD · East Midlands</div>
<div style="font-size:18px;font-weight:700;color:#151a21;margin-top:2px">${esc(heading)}</div></td></tr>
<tr><td style="padding:18px 22px">${bannerHtml}<p style="margin:0 0 12px;font-size:14px;color:#151a21">${esc(intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 12px 5px 0;color:#566170;font-size:13px;vertical-align:top;white-space:nowrap;width:1%">${esc(k)}</td><td style="padding:5px 0;font-size:13px;color:#151a21">${esc(v)}</td></tr>`,
    )
    .join("")}</table>
${outage ? `<p style="margin:14px 0 0;font-size:13px;color:#151a21">Please apply your company maintenance instructions for vehicles that use this route. A reinstatement advice (F3.21B) will follow when the equipment is back in use.</p>` : ""}
</td></tr>
<tr><td style="padding:12px 22px;border-top:1px solid #eef0f3;font-size:11px;color:#8a94a3">Sent automatically by the HABD/WILD EM tracker.${replyTo ? ` Replies go to ${esc(replyTo)}.` : ""}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [banner ?? "", heading, "", intro, "", ...rows.map(([k, v]) => `${k}: ${v}`)].filter((l, i) => i > 0 || l).join("\n");
  const safe = (s: string) => s.replace(/[^\w\- &().]+/g, " ").replace(/\s+/g, " ").trim();
  const filename = `F3.21${kind} FIN ${fault.FIN} ${safe(where)}.pdf`;
  return { subject, html, text, attachment: { filename, content: pdf } };
}

// ---------------------------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Resend rejects line breaks in subjects; fault fields can contain them.
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 250);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: secret } = await admin.from("habd_secrets").select("value").eq("key", "function_secret").maybeSingle();
  if (!secret?.value || req.headers.get("x-habd-secret") !== secret.value) return json({ error: "unauthorized" }, 401);

  const { data: cfg, error: cfgErr } = await admin.from("habd_settings").select("*").limit(1).maybeSingle();
  if (cfgErr || !cfg) return json({ error: "settings unavailable" }, 500);
  const settings = cfg as Settings;
  const body = await req.json().catch(() => ({}));

  // Preview: render without sending or touching the outbox.
  if (body?.preview) {
    const [assets, faults] = await Promise.all([loadAssets(admin), latestFaults(admin)]);
    if (body.preview === "overview") {
      const o = buildOverview(statusOf(assets, faults), { replyTo: settings.reply_to });
      return new Response(o.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const kind = body.preview === "B" ? "B" : "A";
    const fault = faults.find((f) => f.FIN === String(body.fin));
    if (!fault) return json({ error: `FIN ${body.fin} not in latest snapshot` }, 404);
    const asset = assets.find((a) => String(a.ID) === String(fault.ID)) ?? null;
    const build = kind === "A" ? buildFormA : buildFormB;
    const pdf = await build(await blankForm(admin, kind), { fault, asset, signedBy: settings.signed_by });
    return new Response(new Blob([pdf as BlobPart], { type: "application/pdf" }));
  }

  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: due, error: dueErr } = await admin
    .from("habd_email_outbox")
    .select("*")
    .lt("attempts", MAX_ATTEMPTS)
    .or(`and(status.in.(queued,failed),send_after.lte.${nowIso}),and(status.eq.sending,claimed_at.lt.${staleIso})`)
    .order("id")
    .limit(20);
  if (dueErr) return json({ error: dueErr.message }, 500);

  let assets: Asset[] | null = null;
  let faults: Fault[] | null = null;
  const results: { id: number; status: string; error?: string }[] = [];

  for (const candidate of (due ?? []) as OutboxRow[]) {
    // Claim: only one invocation may move a row to "sending".
    const { data: claimed } = await admin
      .from("habd_email_outbox")
      .update({ status: "sending", attempts: candidate.attempts + 1, claimed_at: new Date().toISOString() })
      .eq("id", candidate.id)
      .eq("status", candidate.status)
      .eq("attempts", candidate.attempts)
      .select("*")
      .maybeSingle();
    if (!claimed) continue;
    const row = claimed as OutboxRow;
    const finish = async (patch: Record<string, unknown>) => {
      await admin.from("habd_email_outbox").update(patch).eq("id", row.id);
      results.push({ id: row.id, status: String(patch.status), error: patch.error as string | undefined });
    };

    try {
      assets ??= await loadAssets(admin);
      faults ??= await latestFaults(admin);
      const list = row.kind === "overview" ? "overview" : "forms";
      const { data: rec } = await admin.from("habd_recipients").select("email").eq("list", list).eq("active", true).order("id");
      const intended = [...new Set(((rec ?? []) as { email: string }[]).map((r) => r.email.trim()).filter(Boolean))];
      const mode: Mode = row.is_test ? "test" : settings.mode;

      let email: Email;
      if (row.kind === "overview") {
        const banner = mode === "test" ? testBanner(row, intended) : null;
        const o = buildOverview(statusOf(assets, faults), { banner, replyTo: settings.reply_to });
        const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
        email = { subject: o.subject, html: o.html, text: o.text, attachment: { filename: `HABD-WILD status ${stamp}.csv`, content: o.csv } };
      } else {
        const fault = faults.find((f) => f.FIN === row.fin);
        // Re-check against the latest snapshot: the change may have been corrected in the grace period.
        const stillValid = !!fault && (row.kind === "A" || parseWallClock(fault["Date in order"]) !== null);
        if (!stillValid) {
          await finish({ status: "cancelled", note: fault ? "Date in order no longer complete" : "FIN no longer in the fault log" });
          continue;
        }
        const asset = assets.find((a) => String(a.ID) === String(fault!.ID)) ?? null;
        const build = row.kind === "A" ? buildFormA : buildFormB;
        const pdf = await build(await blankForm(admin, row.kind), { fault: fault!, asset, signedBy: settings.signed_by });
        email = formEmail(row.kind, fault!, asset, pdf, mode === "test" ? testBanner(row, intended) : null, settings.reply_to);
      }

      if (!row.is_test && mode === "disarmed") {
        await finish({ status: "suppressed", mode, intended_emails: intended, subject: oneLine(email.subject), note: "Email switched off (disarmed)" });
        continue;
      }
      const to = mode === "armed" ? intended : (settings.test_recipients ?? []).filter(Boolean);
      if (to.length === 0) {
        await finish({
          status: "failed",
          mode,
          intended_emails: intended,
          attempts: MAX_ATTEMPTS,
          error: mode === "armed" ? "No active recipients on the distribution list" : "No test recipients set",
        });
        continue;
      }
      if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

      const subject = oneLine((mode === "test" ? "[TEST] " : "") + email.subject);
      const content = typeof email.attachment.content === "string"
        ? toBase64(new TextEncoder().encode(email.attachment.content))
        : toBase64(email.attachment.content);
      const send = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `habd-notify-${row.id}-${row.attempts}`,
        },
        body: JSON.stringify({
          from: settings.from_addr,
          to,
          reply_to: settings.reply_to || undefined,
          subject,
          html: email.html,
          text: email.text,
          attachments: [{ filename: email.attachment.filename, content }],
          tags: [
            { name: "app", value: "habd_wild" },
            { name: "kind", value: row.kind },
          ],
        }),
      });
      const out = await send.json().catch(() => ({}));
      if (!send.ok) throw new Error(`Resend ${send.status}: ${out?.message ?? JSON.stringify(out)}`);
      await finish({
        status: "sent",
        mode,
        to_emails: to,
        intended_emails: intended,
        subject,
        attachment: email.attachment.filename,
        resend_id: out?.id ?? null,
        error: null,
        sent_at: new Date().toISOString(),
      });
    } catch (e) {
      // Back off 2, 4 minutes between the three attempts.
      await finish({
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        send_after: new Date(Date.now() + 2 * row.attempts * 60_000).toISOString(),
      });
    }
  }
  return json({ ok: true, processed: results.length, results });
});

function testBanner(row: OutboxRow, intended: string[]): string {
  return `TEST${row.is_test ? " SEND" : " MODE"} — not sent to the distribution list.\nLive recipients (${intended.length}): ${
    intended.length ? intended.join(", ") : "none on the list yet"
  }`;
}
