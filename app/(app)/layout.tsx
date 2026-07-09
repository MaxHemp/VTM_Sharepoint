import { logoutAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { IconLogout } from "@/components/icons";
import { VtmLogo } from "@/components/logo";
import { SidebarNav } from "@/components/sidebar-nav";

// Auth checks must run on every request — never prerender these pages.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col">
      <div className="vtm-brandbar" aria-hidden />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--surface-default)]">
          <div className="flex items-center gap-3 px-5 pb-6 pt-6">
            <VtmLogo size={40} />
            <div>
              <div className="font-display text-sm font-bold leading-tight text-[var(--ink)]">
                Teamportal
              </div>
              <div
                className="vtm-label mt-0.5"
                style={{ fontSize: 9, letterSpacing: "0.14em" }}
              >
                VersicherungsTech Magazin
              </div>
            </div>
          </div>

          <SidebarNav isAdmin={user.role === "admin"} />

          <div className="border-t border-[var(--hairline)] px-5 py-5">
            <p className="font-display mb-4 text-[13px] font-medium italic leading-snug text-[var(--ink-soft)]">
              „Technologie verstehen.
              <br />
              Versicherung verändern.&ldquo;
            </p>
            <div className="text-sm font-medium text-[var(--ink)]">
              {user.name}
            </div>
            <div className="truncate text-xs text-[var(--ink-soft)]">
              {user.email}
            </div>
            <form action={logoutAction} className="mt-3">
              <button
                type="submit"
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--hairline)] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <IconLogout />
                Abmelden
              </button>
            </form>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <div className="vtm-brandbar" aria-hidden />
    </div>
  );
}
