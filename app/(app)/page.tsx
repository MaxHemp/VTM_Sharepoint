import Link from "next/link";
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Announcement, type Event, type Task } from "@/lib/db";
import { formatDate, formatRelative, todayIso } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import {
  IconCalendar,
  IconCheck,
  IconFile,
  IconHome,
} from "@/components/icons";
import { EmptyState } from "@/components/tech-illustration";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";

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

  const counts = {
    members: (db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n,
    docs: (db.prepare("SELECT COUNT(*) n FROM documents").get() as { n: number }).n,
    openTasks: (
      db.prepare("SELECT COUNT(*) n FROM tasks WHERE status = 'open'").get() as {
        n: number;
      }
    ).n,
  };
  const nextEvent = upcoming[0] ?? null;

  const heute = new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <>
      <PageHeader
        label="Start"
        title={`Willkommen, ${user.name.split(" ")[0]}`}
        description="Neuigkeiten und ein Überblick über Ihr Team."
      >
        <div className="vtm-mono pb-1 text-sm text-[var(--ink-soft)]">
          {heute}
        </div>
      </PageHeader>

      <div className="vtm-dotgrid">
        <div className="vtm-enter mx-auto max-w-6xl px-8 py-10 lg:px-12">
          <div className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Team-Mitglieder"
              value={String(counts.members)}
              icon={<IconHome />}
            />
            <StatTile
              label="Dokumente"
              value={String(counts.docs)}
              icon={<IconFile />}
            />
            <StatTile
              label="Offene Aufgaben"
              value={String(counts.openTasks)}
              icon={<IconCheck />}
            />
            <StatTile
              label="Nächster Termin"
              value={
                nextEvent
                  ? formatDate(nextEvent.date).slice(0, 6) // „20.07."
                  : "–"
              }
              hint={nextEvent ? nextEvent.title : "Nichts geplant"}
              icon={<IconCalendar />}
            />
          </div>

          <div className="grid gap-10 lg:grid-cols-3">
            <section className="lg:col-span-2">
              <h2 className="vtm-kicker mb-4">News & Ankündigungen</h2>

              <form
                action={createAnnouncementAction}
                className="vtm-card-raised mb-8 p-5"
              >
                <div className="mb-3 flex items-center gap-3">
                  <Avatar name={user.name} size={34} />
                  <label htmlFor="news-title" className="text-sm font-bold">
                    Neuigkeit mit dem Team teilen
                  </label>
                </div>
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
                  <div className="vtm-card">
                    <EmptyState
                      title="Noch keine Ankündigungen"
                      hint="Teilen Sie oben die erste Neuigkeit — Ihr Team wird automatisch per E-Mail informiert."
                    />
                  </div>
                )}
                {announcements.map((a, index) => {
                  // Anker-Karte: Das neueste Stück ist das einzige
                  // Cobalt-Flächenelement der Seite (max. 1× pro Raster).
                  const anchor = index === 0;
                  return (
                    <article
                      key={a.id}
                      className={
                        anchor
                          ? "vtm-card-anchor vtm-lift p-6"
                          : "vtm-card vtm-lift p-6"
                      }
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3.5">
                          <Avatar name={a.author} size={40} />
                          <div>
                            {anchor && (
                              <span className="gold-badge mb-2">Aktuell</span>
                            )}
                            <h3 className="font-display text-lg font-bold leading-snug">
                              {a.title}
                            </h3>
                            <p
                              className={`vtm-mono mt-1 text-xs ${
                                anchor ? "opacity-70" : "text-[var(--ink-soft)]"
                              }`}
                            >
                              {a.author ?? "Unbekannt"} ·{" "}
                              {formatRelative(a.created_at)}
                            </p>
                          </div>
                        </div>
                        {(user.role === "admin" || a.created_by === user.id) && (
                          <form action={deleteAnnouncementAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <button
                              type="submit"
                              className={`min-h-6 text-xs underline-offset-2 hover:underline ${
                                anchor
                                  ? "opacity-70 hover:opacity-100"
                                  : "text-[var(--ink-soft)] hover:text-red-700"
                              }`}
                            >
                              Löschen
                            </button>
                          </form>
                        )}
                      </div>
                      {a.body && (
                        <p className="mt-4 max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed">
                          {a.body}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <div className="space-y-8">
              <section className="vtm-card p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="vtm-label">Nächste Termine</h2>
                  <Link
                    href="/kalender"
                    className="text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    Kalender →
                  </Link>
                </div>
                {upcoming.length === 0 ? (
                  <p className="text-sm text-[var(--ink-soft)]">
                    Keine anstehenden Termine.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {upcoming.map((e) => (
                      <li key={e.id} className="flex gap-3 text-sm">
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: "var(--gradient-electric)" }}
                          aria-hidden
                        />
                        <div>
                          <div className="font-bold">{e.title}</div>
                          <div className="vtm-mono text-xs text-[var(--ink-soft)]">
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
                    className="text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    Alle →
                  </Link>
                </div>
                {myTasks.length === 0 ? (
                  <p className="text-sm text-[var(--ink-soft)]">
                    Ihnen sind derzeit keine offenen Aufgaben zugewiesen.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {myTasks.map((t) => (
                      <li key={t.id} className="text-sm">
                        <div className="font-bold">{t.title}</div>
                        {t.due_date && (
                          <div className="vtm-mono text-xs text-[var(--ink-soft)]">
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
      </div>
    </>
  );
}
