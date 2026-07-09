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
    <div className="flex min-h-screen">
      <aside className="vtm-surface flex w-64 shrink-0 flex-col">
        <div className="relative flex items-center gap-3 px-5 pb-6 pt-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white p-1 shadow-[0_0_20px_rgba(31,78,255,0.35)]">
            <VtmLogo size={32} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-white">
              Teamportal
            </div>
            <div className="vtm-label-light mt-0.5" style={{ fontSize: 9 }}>
              VersicherungsTech Magazin
            </div>
          </div>
        </div>

        <SidebarNav isAdmin={user.role === "admin"} />

        <div className="relative border-t border-white/10 px-5 py-5">
          <p
            className="mb-4 text-[13px] font-light italic leading-snug"
            style={{
              color: "var(--gold)",
              fontFamily: "'Arial Narrow', Arial, sans-serif",
            }}
          >
            „Technologie verstehen.
            <br />
            Versicherung verändern.&ldquo;
          </p>
          <div className="text-sm font-medium text-white">{user.name}</div>
          <div className="truncate text-xs text-[#8A9BB5]">{user.email}</div>
          <form action={logoutAction} className="mt-3">
            <button
              type="submit"
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:border-white/40 hover:text-white"
            >
              <IconLogout />
              Abmelden
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
