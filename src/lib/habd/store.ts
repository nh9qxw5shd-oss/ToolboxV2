"use client";

// The equipment, the fault log and the email log, shared by every page and the shell. Read on
// opening, every 30 seconds and on focus (never while a dialog is open, so a form is not swept away),
// and after every change. A change re-reads the latest saved log, applies itself to it and saves a new
// snapshot, so an out-of-date screen never overwrites someone else's update.

import { useEffect, useSyncExternalStore } from "react";
import { fetchLatest, loadAssets, recentNotifications, saveSnapshot, type Notification } from "./data";
import { isAbort, type Abort, type Asset, type Fault } from "./faults";

export type SyncState = "loading" | "ok" | "saving" | "error";

export interface HabdState {
  assets: Asset[];
  faults: Fault[];
  snapId: number | null;
  mail: Notification[];
  loaded: boolean;
  sync: SyncState;
  syncAt: number | null;
  error: string | null;
  /** The log changed under this screen since it was last read (someone else's change). */
  changedElsewhere: number;
}

let state: HabdState = { assets: [], faults: [], snapId: null, mail: [], loaded: false, sync: "loading", syncAt: null, error: null, changedElsewhere: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<HabdState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const useHabd = () => useSyncExternalStore(subscribe, () => state, () => state);
export const assetById = (id: string) => state.assets.find((a) => a.ID === String(id)) ?? null;

let busy = false;
let dialogs = 0;
/** A dialog is open: hold the background refresh. */
export function holdRefresh(on: boolean): void {
  dialogs = Math.max(0, dialogs + (on ? 1 : -1));
}

export async function loadMail(): Promise<void> {
  try {
    set({ mail: await recentNotifications() });
  } catch {
    /* the log is informational; the board still works */
  }
}

export async function refresh(): Promise<void> {
  try {
    const [assets, latest] = await Promise.all([state.assets.length ? Promise.resolve(state.assets) : loadAssets(), fetchLatest()]);
    const changed = state.snapId !== null && latest.id !== state.snapId;
    set({ assets, faults: latest.faults, snapId: latest.id, loaded: true, sync: "ok", syncAt: Date.now(), error: null, changedElsewhere: changed ? state.changedElsewhere + 1 : state.changedElsewhere });
    void loadMail();
  } catch (e) {
    set({ loaded: true, sync: "error", error: (e as Error).message });
  }
}

/** Apply a change to the latest saved log and save it. Returns the change's outcome or its Abort. */
export async function commit<T extends object>(mutate: (faults: Fault[]) => T | Abort): Promise<T | Abort> {
  if (busy) return { abort: "Another change is still saving." };
  busy = true;
  set({ sync: "saving" });
  try {
    const latest = await fetchLatest();
    const faults = structuredClone(latest.faults);
    const result = mutate(faults);
    if (isAbort(result)) {
      set({ faults: latest.faults, snapId: latest.id, sync: "ok", syncAt: Date.now() });
      return result;
    }
    const id = await saveSnapshot(faults);
    set({ faults, snapId: id, sync: "ok", syncAt: Date.now(), error: null });
    setTimeout(() => void loadMail(), 2500);
    return result;
  } catch (e) {
    set({ sync: "error", error: (e as Error).message });
    return { abort: `Not saved: ${(e as Error).message}. Nothing has been emailed. Please try again.` };
  } finally {
    busy = false;
  }
}

export function useHabdPolling(): void {
  useEffect(() => {
    void refresh();
    const tick = () => {
      if (!busy && !dialogs && !document.hidden) void refresh();
    };
    const id = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, []);
}

/** The latest email of a kind for a FIN (tests left out), for the chips on the cards. */
export function mailFor(mail: Notification[], kind: "A" | "B", fin: string): Notification | undefined {
  return mail.find((n) => n.kind === kind && n.fin === fin && !n.is_test);
}
