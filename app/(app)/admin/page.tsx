import {
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
} from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { getDb, type User } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";

const FEHLER_TEXTE: Record<string, string> = {
  eingabe:
    "Bitte füllen Sie alle Felder aus. Das Passwort braucht mindestens 8 Zeichen.",
  email: "Diese E-Mail-Adresse wird bereits verwendet.",
  passwort: "Das neue Passwort braucht mindestens 8 Zeichen.",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const admin = await requireAdmin();
  const { fehler } = await searchParams;
  const users = getDb()
    .prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE")
    .all() as User[];

  return (
    <>
      <PageHeader
        label="Verwaltung"
        title="Team-Mitglieder"
        description="Zugänge anlegen, Passwörter zurücksetzen, Mitglieder entfernen."
      />

      <div className="mx-auto max-w-5xl px-8 py-10 lg:px-12">
        {fehler && FEHLER_TEXTE[fehler] && (
          <p
            role="alert"
            className="mb-6 rounded-md border-l-4 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {FEHLER_TEXTE[fehler]}
          </p>
        )}

        <section>
          <h2 className="vtm-label electric-underline mb-4">Neues Mitglied</h2>
          <form action={createUserAction} className="vtm-card grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <label htmlFor="u-name" className="mb-1 block text-xs text-[#8A9BB5]">
                Name
              </label>
              <input id="u-name" name="name" required className="vtm-input" />
            </div>
            <div>
              <label htmlFor="u-email" className="mb-1 block text-xs text-[#8A9BB5]">
                E-Mail
              </label>
              <input id="u-email" name="email" type="email" required className="vtm-input" />
            </div>
            <div>
              <label htmlFor="u-pass" className="mb-1 block text-xs text-[#8A9BB5]">
                Startpasswort (mind. 8 Zeichen)
              </label>
              <input
                id="u-pass"
                name="password"
                type="text"
                required
                minLength={8}
                className="vtm-input"
              />
            </div>
            <div>
              <label htmlFor="u-role" className="mb-1 block text-xs text-[#8A9BB5]">
                Rolle
              </label>
              <select id="u-role" name="role" defaultValue="member" className="vtm-input">
                <option value="member">Mitglied</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <button
              type="submit"
              className="btn-primary sm:col-span-2 sm:justify-self-start"
            >
              Mitglied anlegen
            </button>
          </form>
          <p className="mt-2 text-xs text-[#8A9BB5]">
            Teilen Sie das Startpasswort dem neuen Mitglied persönlich mit.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="vtm-label electric-underline mb-4">
            Mitglieder ({users.length})
          </h2>
          <div className="vtm-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8ECF2] bg-[#F5F7FA]">
                  <th className="vtm-label px-5 py-3.5 font-bold">Name</th>
                  <th className="vtm-label px-5 py-3.5 font-bold">E-Mail</th>
                  <th className="vtm-label px-5 py-3.5 font-bold">Rolle</th>
                  <th className="vtm-label px-5 py-3.5 font-bold">Seit</th>
                  <th className="vtm-label px-5 py-3.5 text-right font-bold">
                    Aktionen
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F7FA]">
                {users.map((u) => (
                  <tr key={u.id} className="align-top transition-colors hover:bg-[#F5F7FA]">
                    <td className="px-5 py-3.5 font-bold">
                      {u.name}
                      {u.id === admin.id && (
                        <span className="ml-2 rounded bg-[#E8ECF2] px-1.5 py-0.5 text-xs font-normal text-[#122952]">
                          Sie
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[#8A9BB5]">{u.email}</td>
                    <td className="px-5 py-3.5">
                      {u.role === "admin" ? (
                        <span
                          className="rounded px-2 py-0.5 text-xs font-bold text-white"
                          style={{
                            background:
                              "linear-gradient(135deg, #1F4EFF 0%, #4B75FF 100%)",
                          }}
                        >
                          Administrator
                        </span>
                      ) : (
                        <span className="rounded bg-[#E8ECF2] px-2 py-0.5 text-xs font-medium text-[#122952]">
                          Mitglied
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[#8A9BB5]">
                      {formatDateTime(u.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <form
                          action={resetPasswordAction}
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="id" value={u.id} />
                          <label htmlFor={`pw-${u.id}`} className="sr-only">
                            Neues Passwort für {u.name}
                          </label>
                          <input
                            id={`pw-${u.id}`}
                            name="password"
                            type="text"
                            minLength={8}
                            required
                            placeholder="Neues Passwort"
                            className="vtm-input !min-h-9 w-36 !px-2 !py-1 !text-xs"
                          />
                          <button
                            type="submit"
                            className="text-xs font-medium text-[#1F4EFF] underline-offset-2 hover:underline"
                          >
                            Setzen
                          </button>
                        </form>
                        {u.id !== admin.id && (
                          <form action={deleteUserAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <button
                              type="submit"
                              className="text-xs text-[#8A9BB5] underline-offset-2 hover:text-red-700 hover:underline"
                            >
                              Löschen
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
