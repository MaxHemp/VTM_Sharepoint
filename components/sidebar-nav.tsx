"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconCalendar,
  IconCheck,
  IconFolder,
  IconHome,
  IconSettings,
} from "./icons";

const NAV = [
  { href: "/", label: "Start", icon: IconHome },
  { href: "/dokumente", label: "Dokumente", icon: IconFolder },
  { href: "/aufgaben", label: "Aufgaben", icon: IconCheck },
  { href: "/kalender", label: "Kalender", icon: IconCalendar },
];

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin
    ? [...NAV, { href: "/admin", label: "Verwaltung", icon: IconSettings }]
    : NAV;

  return (
    <nav className="relative flex-1 space-y-1 px-3" aria-label="Hauptnavigation">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "text-white shadow-[0_2px_10px_rgba(31,78,255,0.35)]"
                : "text-[#8A9BB5] hover:bg-white/5 hover:text-white"
            }`}
            style={
              active
                ? { background: "linear-gradient(135deg, #1F4EFF 0%, #4B75FF 100%)" }
                : undefined
            }
          >
            <item.icon className="shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
