import {
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
} from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { getDb, type User } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

const FEHLER_TEXTE: Record<string, string> = {
  eingabe:
    "Bitte alle Felder ausfüllen. Das Passwort braucht mindestens 8 Zeichen.",
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
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Verwaltung</h1>
      <p className="mt-1 text-sm text-slate-500">
        Team-Mitglieder anlegen und verwalten.
      </p>

      {fehler && FEHLER_TEXTE[fehler] && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {FEHLER_TEXTE[fehler]}
        </p>
      )}

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Neues Mitglied</h2>
        <form
          action={createUserAction}
          className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2"
        >
          <input
            name="name"
            required
            placeholder="Name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <input
            name="email"
            type="email"
            required
            placeholder="E-Mail"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <input
            name="password"
            type="text"
            required
            minLength={8}
            placeholder="Startpasswort (mind. 8 Zeichen)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <select
            name="role"
            defaultValue="member"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="member">Mitglied</option>
            <option value="admin">Administrator</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:col-span-2 sm:justify-self-start"
          >
            Mitglied anlegen
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Teile das Startpasswort persönlich mit dem neuen Mitglied.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">
          Mitglieder{" "}
          <span className="text-sm text-slate-400">({users.length})</span>
        </h2>
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">E-Mail</th>
                <th className="px-4 py-3">Rolle</th>
                <th className="px-4 py-3">Seit</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    {u.name}
                    {u.id === admin.id && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        Du
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {u.role === "admin" ? "Administrator" : "Mitglied"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDateTime(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <form
                        action={resetPasswordAction}
                        className="flex items-center gap-1"
                      >
                        <input type="hidden" name="id" value={u.id} />
                        <input
                          name="password"
                          type="text"
                          minLength={8}
                          required
                          placeholder="Neues Passwort"
                          className="w-36 rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Setzen
                        </button>
                      </form>
                      {u.id !== admin.id && (
                        <form action={deleteUserAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-xs text-slate-400 hover:text-red-600"
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
  );
}
