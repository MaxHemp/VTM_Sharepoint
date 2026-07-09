import { redirect } from "next/navigation";
import { loginAction } from "@/lib/actions";
import { getCurrentUser, hasAnyUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  if (!hasAnyUser()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const { fehler } = await searchParams;

  return (
    <main className="vtm-surface flex min-h-screen items-center justify-center p-4">
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg text-lg font-black text-white"
            style={{
              background: "linear-gradient(135deg, #1F4EFF 0%, #4B75FF 100%)",
              fontFamily: "'Arial Narrow', Arial, sans-serif",
              boxShadow: "0 0 32px rgba(31,78,255,0.45)",
            }}
          >
            VTM
          </div>
          <h1
            className="text-2xl font-black text-white"
            style={{ fontFamily: "'Arial Narrow', Arial, sans-serif" }}
          >
            Teamportal
          </h1>
          <p
            className="mt-2 text-sm font-light italic"
            style={{ color: "var(--gold)" }}
          >
            „Technologie verstehen. Versicherung verändern.&ldquo;
          </p>
        </div>

        <div className="vtm-card p-8">
          <p className="mb-5 text-sm text-[#8A9BB5]">
            Bitte melden Sie sich mit Ihrem Konto an.
          </p>

          {fehler && (
            <p
              role="alert"
              className="mb-4 rounded-md border-l-4 border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              E-Mail oder Passwort ist falsch.
            </p>
          )}

          <form action={loginAction} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-bold" htmlFor="email">
                E-Mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="vtm-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold" htmlFor="password">
                Passwort
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="vtm-input"
              />
            </div>
            <button type="submit" className="btn-primary w-full">
              Anmelden
            </button>
          </form>
        </div>

        <p className="relative mt-6 text-center text-xs text-[#8A9BB5]">
          VersicherungsTech Media UG · Internes Portal
        </p>
      </div>
    </main>
  );
}
