"use client";

// Application shell (Autumn Hub kit): sidebar with the pages and the signal boxes' status, a top bar
// with search, the out-of-use count, the save state, the London clock and the theme toggle. The hub
// hides the sidebar and the duplicated controls by the selectors in PotatOS 09 §4.2, so those stay as
// the kit has them.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, X } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useHydrated, useLocalStorage, useNow } from "@/lib/hooks";
import { NAV, navFor } from "@/lib/nav";
import { statusRows, summary } from "@/lib/habd/faults";
import { useHabd, useHabdPolling } from "@/lib/habd/store";
import { CommandPalette, openPalette } from "@/components/CommandPalette";

// A detector head over a rail in Network Rail orange (same mark as the favicon, src/app/icon.svg).
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <g fill="none" stroke="#F26522" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 25h24" />
        <path d="M8 25v-3M24 25v-3" />
        <rect x="11" y="9" width="10" height="8" rx="2" />
        <path d="M16 17v5M13 5l3 3 3-3" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------- sidebar

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const { assets, faults, loaded } = useHabd();
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const rows = statusRows(assets, faults);
  const boxes = [...new Set(assets.map((a) => a["Controlling SB"] || "Other"))];

  useLayoutEffect(() => {
    const list = listRef.current;
    const ind = indicatorRef.current;
    if (!list || !ind) return;
    const active = list.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) {
      ind.style.opacity = "0";
      return;
    }
    const lr = list.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    ind.style.opacity = "1";
    ind.style.transform = `translateY(${ar.top - lr.top + 6}px)`;
    ind.style.height = `${ar.height - 12}px`;
  }, [path]);

  return (
    <div ref={listRef} className="relative">
      <span ref={indicatorRef} className="nav-indicator" style={{ top: 0, opacity: 0 }} />
      <div className="nav-group-label">HABD / WILD</div>
      {NAV.map((i) => {
        const current = i.href === "/" ? path === "/" : path === i.href || path.startsWith(i.href + "/");
        return (
          <Link key={i.href} href={i.href} className="nav-item" aria-current={current ? "page" : undefined} title={i.desc} onClick={onNavigate}>
            <i.icon size={17} strokeWidth={2.1} />
            <span className="nav-label">{i.label}</span>
          </Link>
        );
      })}
      {loaded && boxes.length > 0 && (
        <>
          <div className="nav-group-label">Signal boxes</div>
          {boxes.map((b) => {
            const inBox = rows.filter((r) => (r.a["Controlling SB"] || "Other") === b);
            const off = inBox.filter((r) => r.open.length).length;
            return (
              <Link key={b} href={`/?box=${encodeURIComponent(b)}`} className="nav-item" onClick={onNavigate} title={`${inBox.length - off} of ${inBox.length} in use`}>
                <span className="dot" style={{ color: off ? "var(--poor)" : "var(--good)" }} />
                <span className="nav-label flex flex-1 items-baseline justify-between gap-2">
                  <span>{b}</span>
                  <span className="font-mono text-[11px] text-faint">{off ? `${off} out` : inBox.length}</span>
                </span>
              </Link>
            );
          })}
        </>
      )}
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className="sidebar hidden lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
        <BrandMark />
        <span className="nav-label leading-tight">
          <span className="block text-[15px] font-extrabold tracking-tight">HABD / WILD</span>
          <span className="block text-[11px] font-semibold text-faint">East Midlands detectors</span>
        </span>
      </Link>
      <div className="flex-1 overflow-y-auto pb-4">
        <SidebarNav />
      </div>
      <div className="border-t border-edge p-2">
        <button className="nav-item w-[calc(100%-1rem)] text-faint" onClick={onToggle} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          <span className="nav-label text-xs">Collapse</span>
        </button>
      </div>
    </aside>
  );
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="backdrop lg:hidden" onMouseDown={onClose}>
      <div className="sheet flex h-full w-72 max-w-[85vw] flex-col border-r border-edge bg-sunken" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4">
          <span className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-[15px] font-extrabold">HABD / WILD</span>
          </span>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pb-6">
          <SidebarNav onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- topbar

/** The board in one chip: how much is out of use, and whether this screen is saved and current. */
function StatusChip() {
  const { assets, faults, loaded, sync, syncAt, error } = useHabd();
  const hydrated = useHydrated();
  if (!hydrated || !loaded) return null;
  const s = summary(statusRows(assets, faults));
  const at = syncAt ? new Date(syncAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  const color = sync === "error" ? "var(--poor)" : s.off ? "var(--moderate)" : "var(--good)";
  const text = sync === "error" ? "Can't reach the server" : sync === "saving" ? "Saving…" : s.off ? `${s.off} out of use` : "All in use";
  return (
    <span className="chip !cursor-default max-w-[44vw] truncate" title={error ?? `${s.on} of ${s.total} in use · up to date ${at}`}>
      <span className="dot" style={{ color }} />
      {text}
    </span>
  );
}

function Clock() {
  const now = useNow(15000);
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const hhmm = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  const day = now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Europe/London" });
  return (
    <span className="hidden items-baseline gap-1.5 text-sm md:inline-flex" title="Europe/London">
      <span className="font-mono text-base font-semibold tabular-nums">{hhmm}</span>
      <span className="text-xs text-dim">{day}</span>
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const light = theme === "light";
  return (
    <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label={light ? "Switch to dark theme" : "Switch to light theme"} title={light ? "Switch to dark theme" : "Switch to light theme"}>
      <span key={theme} className="pop inline-flex">
        {light ? <Moon size={17} /> : <Sun size={17} />}
      </span>
    </button>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  const here = navFor(path);
  return (
    <header className="topbar glass flex items-center gap-2 px-3 sm:px-4">
      <button className="btn btn-ghost btn-icon lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={18} />
      </button>
      <Link href="/" className="flex items-center gap-2 lg:hidden">
        <BrandMark size={22} />
        <span className="text-sm font-extrabold">{here?.short ?? "HABD"}</span>
      </Link>
      <button className="btn btn-ghost ml-1 hidden min-w-[220px] justify-start gap-2 border border-edge bg-sunken text-dim sm:flex" onClick={() => openPalette()} title="Find a site, a FIN or a page">
        <Search size={15} />
        <span className="flex-1 text-left text-xs font-medium">Find a site, FIN or page…</span>
        <span className="flex gap-0.5">
          <kbd className="kbd">Ctrl</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <button className="btn btn-ghost btn-icon sm:hidden" onClick={() => openPalette()} aria-label="Search">
        <Search size={18} />
      </button>
      <div className="flex-1" />
      <StatusChip />
      <Clock />
      <ThemeToggle />
    </header>
  );
}

// ------------------------------------------------------------------ shell

export default function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorage("habd_nav_collapsed", false);
  const [menuOpen, setMenuOpen] = useState(false);
  useHabdPolling();
  return (
    <div className="app-shell" data-collapsed={collapsed ? "true" : "false"}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 flex-col">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main className="content flex-1">{children}</main>
        <footer className="content !py-4 text-xs text-faint">HABD / WILD · Derby Control · East Midlands Route · F3.21A / F3.21B are emailed to the distribution list automatically, about two minutes after each change</footer>
      </div>
      <CommandPalette />
    </div>
  );
}
