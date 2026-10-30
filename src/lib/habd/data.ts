"use client";

// HABD / WILD reads and writes, as the signed-in Overseer person (lib/supabase.ts). The equipment is
// the Assets bucket's assets.json, the same file the habd-notify email function reads; the fault log
// is the latest row of fault_snapshots, and every change saves the whole log as a new row (the
// habd_on_snapshot trigger compares it with the one before and queues the F3.21A / F3.21B emails).

import { sb } from "@/lib/supabase";
import type { Asset, Fault } from "./faults";

export async function loadAssets(): Promise<Asset[]> {
  const { data, error } = await sb().storage.from("Assets").download("assets.json");
  if (error || !data) throw new Error(`The equipment list could not be read: ${error?.message ?? "no file"}`);
  const parsed = JSON.parse(await data.text()) as Asset[];
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("The equipment list is empty");
  return parsed.map((a) => ({ ...a, ID: String(a.ID) }));
}

export async function fetchLatest(): Promise<{ id: number | null; faults: Fault[] }> {
  const { data, error } = await sb().from("fault_snapshots").select("id, faults").order("id", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0] as { id: number; faults: unknown } | undefined;
  return { id: row?.id ?? null, faults: Array.isArray(row?.faults) ? (row.faults as Fault[]) : [] };
}

export async function saveSnapshot(faults: Fault[]): Promise<number> {
  const { data, error } = await sb().from("fault_snapshots").insert({ faults }).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: number }).id;
}

export interface Notification {
  id: number;
  kind: "A" | "B" | "overview";
  fin: string | null;
  status: string;
  mode: string | null;
  is_test: boolean;
  recipients: number;
  subject: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export async function recentNotifications(max = 200): Promise<Notification[]> {
  const { data, error } = await sb().rpc("habd_recent_notifications", { max_rows: max });
  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
}
