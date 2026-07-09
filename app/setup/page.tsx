import { redirect } from "next/navigation";
import { setupAction } from "@/lib/actions";
import { hasAnyUser } from "@/lib/auth";
import { VtmLogo } from "@/components/logo";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  if (hasAnyUser()) redirect("/login");
  const { fehler } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col">
      <div className="vtm-brandbar" aria-hidden />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
              <VtmLogo size={60} />
            </div>
            <h1 className="font-display text-2xl font-bold text-[var(--ink)]">
              Ersteinrichtung
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Legen Sie das erste Administrator-Konto für Ihr Team an.
            </p>
          </div>

          <div className="vtm-card p-8">
            {fehler && (
              <p
                role="alert"
                className="mb-4 rounded-md border-l-4 border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                Bitte füllen Sie alle Felder aus. Das Passwort braucht
                mindestens 8 Zeichen.
              </p>
            )}

            <form action={setupAction} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-bold" htmlFor="name">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  className="vtm-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-bold" htmlFor="email">
                  E-Mail
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="vtm-input"
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-sm font-bold"
                  htmlFor="password"
                >
                  Passwort (mind. 8 Zeichen)
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="vtm-input"
                />
              </div>
              <button type="submit" className="btn-primary w-full">
                Konto anlegen & starten
              </button>
            </form>
          </div>
        </div>
      </div>
      <div className="vtm-brandbar" aria-hidden />
    </main>
  );
}
