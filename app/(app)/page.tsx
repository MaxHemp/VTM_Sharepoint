import Link from "next/link";
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Announcement, type Event, type Task } from "@/lib/db";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";

type AnnouncementRow = Announcement & { author: string | null };

export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();

  const announcements = db
    .prepare(
      `SELECT a.*, u.name AS author FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
       ORDER BY a.created_at DESC LIMIT 20`
    )
    .all() as AnnouncementRow[];

  const upcoming = db
    .prepare(
      "SELECT * FROM events WHERE date >= ? ORDER BY date, start_time LIMIT 5"
    )
    .all(todayIso()) as Event[];

  const myTasks = db
    .prepare(
      "SELECT * FROM tasks WHERE status = 'open' AND assigned_to = ? ORDER BY due_date IS NULL, due_date LIMIT 5"
    )
    .all(user.id) as Task[];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold">
        Willkommen, {user.name.split(" ")[0]} 👋
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Neuigkeiten und ein Überblick über dein Team.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">News & Ankündigungen</h2>

          <form
            action={createAnnouncementAction}
            className="mb-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
          >
            <input
              name="title"
              required
              placeholder="Titel der Ankündigung"
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <textarea
              name="body"
              rows={3}
              placeholder="Was gibt es Neues?"
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Veröffentlichen
            </button>
          </form>

          <div className="space-y-4">
            {announcements.length === 0 && (
              <p className="rounded-xl bg-white p-6 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                Noch keine Ankündigungen. Schreib die erste!
              </p>
            )}
            {announcements.map((a) => (
              <article
                key={a.id}
                className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{a.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {a.author ?? "Unbekannt"} · {formatDateTime(a.created_at)}
                    </p>
                  </div>
                  {(user.role === "admin" || a.created_by === user.id) && (
                    <form action={deleteAnnouncementAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <button
                        type="submit"
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Löschen
                      </button>
                    </form>
                  )}
                </div>
                {a.body && (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                    {a.body}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>

        <div className="space-y-8">
          <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Nächste Termine</h2>
              <Link href="/kalender" className="text-xs text-blue-600">
                Kalender →
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-500">Keine anstehenden Termine.</p>
            ) : (
              <ul className="space-y-3">
                {upcoming.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="font-medium">{e.title}</div>
                    <div className="text-xs text-slate-500">
                      {formatDate(e.date)}
                      {e.start_time && ` · ${e.start_time} Uhr`}
                      {e.location && ` · ${e.location}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Meine offenen Aufgaben</h2>
              <Link href="/aufgaben" className="text-xs text-blue-600">
                Alle →
              </Link>
            </div>
            {myTasks.length === 0 ? (
              <p className="text-sm text-slate-500">
                Dir sind keine offenen Aufgaben zugewiesen. 🎉
              </p>
            ) : (
              <ul className="space-y-3">
                {myTasks.map((t) => (
                  <li key={t.id} className="text-sm">
                    <div className="font-medium">{t.title}</div>
                    {t.due_date && (
                      <div className="text-xs text-slate-500">
                        Fällig am {formatDate(t.due_date)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
