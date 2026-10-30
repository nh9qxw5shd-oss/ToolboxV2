// The pages, shared by the sidebar, the mobile menu and the palette.

import { FileText, History, LayoutGrid, Mail, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  desc: string;
  keywords: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Status board", short: "Board", icon: LayoutGrid, desc: "Every HABD and WILD site: in use or out of use, report a failure, return to service", keywords: "status board habd wild out of use return service" },
  { href: "/history", label: "Fault history", short: "History", icon: History, desc: "Every fault booked, reinstated or still open; correct details", keywords: "history faults fin fms edit" },
  { href: "/forms", label: "F3.21 forms", short: "Forms", icon: FileText, desc: "The official F3.21A / F3.21B filled in for a fault, to print or save", keywords: "forms f3.21a f3.21b print pdf nop" },
  { href: "/log", label: "Email log", short: "Emails", icon: Mail, desc: "Every F3.21A / F3.21B and daily overview email and what happened to it", keywords: "email log notifications sent" },
];

export function navFor(pathname: string): NavItem | undefined {
  return NAV.find((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(i.href + "/")));
}
