import Link from "next/link";
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Announcement, type Event, type Task } from "@/lib/db";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/page-header";

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
    <>
      <PageHeader
        label="Start — Teamportal"
        title={`Willkommen, ${user.name.split(" ")[0]}`}
        description="Neuigkeiten und ein Überblick über Ihr Team."
      />

      <div className="mx-auto max-w-6xl px-8 py-10 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <h2 className="vtm-label mb-4">News & Ankündigungen</h2>

            <form
              action={createAnnouncementAction}
              className="vtm-card mb-8 p-5"
            >
              <label htmlFor="news-title" className="mb-1 block text-sm font-bold">
                Neue Ankündigung
              </label>
              <input
                id="news-title"
                name="title"
                required
                placeholder="Titel"
                className="vtm-input mb-3"
              />
              <textarea
                name="body"
                rows={3}
                placeholder="Was gibt es Neues?"
                aria-label="Inhalt der Ankündigung"
                className="vtm-input mb-4"
              />
              <button type="submit" className="btn-primary">
                Veröffentlichen
              </button>
            </form>

            <div className="space-y-4">
              {announcements.length === 0 && (
                <p className="vtm-card p-6 text-sm text-[#8A9BB5]">
                  Noch keine Ankündigungen. Schreiben Sie die erste.
                </p>
              )}
              {announcements.map((a, index) => (
                <article key={a.id} className="vtm-card p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      {index === 0 && (
                        <span className="gold-badge mb-2">Aktuell</span>
                      )}
                      <h3
                        className="text-lg font-bold"
                        style={{ fontFamily: "'Arial Narrow', Arial, sans-serif" }}
                      >
                        {a.title}
                      </h3>
                      <p className="mt-0.5 text-xs text-[#8A9BB5]">
                        {a.author ?? "Unbekannt"} · {formatDateTime(a.created_at)}
                      </p>
                    </div>
                    {(user.role === "admin" || a.created_by === user.id) && (
                      <form action={deleteAnnouncementAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button
                          type="submit"
                          className="min-h-6 text-xs text-[#8A9BB5] underline-offset-2 hover:text-red-700 hover:underline"
                        >
                          Löschen
                        </button>
                      </form>
                    )}
                  </div>
                  {a.body && (
                    <p className="mt-3 max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed">
                      {a.body}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <div className="space-y-8">
            <section className="vtm-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="vtm-label">Nächste Termine</h2>
                <Link
                  href="/kalender"
                  className="text-xs font-medium text-[#1F4EFF] underline-offset-2 hover:underline"
                >
                  Kalender →
                </Link>
              </div>
              {upcoming.length === 0 ? (
                <p className="text-sm text-[#8A9BB5]">
                  Keine anstehenden Termine.
                </p>
              ) : (
                <ul className="space-y-4">
                  {upcoming.map((e) => (
                    <li key={e.id} className="flex gap-3 text-sm">
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            "linear-gradient(135deg, #1F4EFF 0%, #4B75FF 100%)",
                        }}
                        aria-hidden
                      />
                      <div>
                        <div className="font-bold">{e.title}</div>
                        <div className="text-xs text-[#8A9BB5]">
                          {formatDate(e.date)}
                          {e.start_time && ` · ${e.start_time} Uhr`}
                          {e.location && ` · ${e.location}`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="vtm-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="vtm-label">Meine offenen Aufgaben</h2>
                <Link
                  href="/aufgaben"
                  className="text-xs font-medium text-[#1F4EFF] underline-offset-2 hover:underline"
                >
                  Alle →
                </Link>
              </div>
              {myTasks.length === 0 ? (
                <p className="text-sm text-[#8A9BB5]">
                  Ihnen sind derzeit keine offenen Aufgaben zugewiesen.
                </p>
              ) : (
                <ul className="space-y-4">
                  {myTasks.map((t) => (
                    <li key={t.id} className="text-sm">
                      <div className="font-bold">{t.title}</div>
                      {t.due_date && (
                        <div className="text-xs text-[#8A9BB5]">
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
    </>
  );
}
