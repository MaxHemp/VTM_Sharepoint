import { redirect } from "next/navigation";
import { loginAction } from "@/lib/actions";
import { getCurrentUser, hasAnyUser } from "@/lib/auth";
import { VtmLogo } from "@/components/logo";
import { TechIllustration } from "@/components/tech-illustration";

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
    <main className="flex min-h-screen flex-col">
      <div className="vtm-brandbar" aria-hidden />
      <div className="vtm-dotgrid relative flex flex-1 items-center justify-center overflow-hidden p-4">
        <div className="pointer-events-none absolute -left-10 top-12 opacity-60" aria-hidden>
          <TechIllustration size={220} />
        </div>
        <div className="pointer-events-none absolute -right-14 bottom-10 opacity-50" aria-hidden>
          <TechIllustration size={280} />
        </div>
        <div className="vtm-enter relative w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
              <VtmLogo size={60} />
            </div>
            <h1 className="font-display text-2xl font-bold text-[var(--ink)]">
              Teamportal
            </h1>
            <p className="font-display mt-2 text-sm font-medium italic text-[var(--ink-soft)]">
              „Technologie verstehen. Versicherung verändern.&ldquo;
            </p>
          </div>

          <div className="vtm-card p-8">
            <p className="mb-5 text-sm text-[var(--ink-soft)]">
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
                <label
                  className="mb-1 block text-sm font-bold"
                  htmlFor="password"
                >
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

          <p className="vtm-mono mt-6 text-center text-xs text-[var(--ink-soft)]">
            VersicherungsTech Media UG · Internes Portal
          </p>
        </div>
      </div>
      <div className="vtm-brandbar" aria-hidden />
    </main>
  );
}
