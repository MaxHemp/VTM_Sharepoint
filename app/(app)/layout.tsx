import Link from "next/link";
import { logoutAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";

// Auth checks must run on every request — never prerender these pages.
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Start", icon: "🏠" },
  { href: "/dokumente", label: "Dokumente", icon: "📁" },
  { href: "/aufgaben", label: "Aufgaben", icon: "✅" },
  { href: "/kalender", label: "Kalender", icon: "📅" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">
            V
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              VTM Teamportal
            </div>
            <div className="text-xs text-slate-500">Internes Portal</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          ))}
          {user.role === "admin" && (
            <Link
              href="/admin"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <span aria-hidden>⚙️</span>
              Verwaltung
            </Link>
          )}
        </nav>

        <div className="border-t border-slate-200 px-5 py-4">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-slate-500">{user.email}</div>
          <form action={logoutAction} className="mt-3">
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Abmelden
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
