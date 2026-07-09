import Link from "next/link";
import { createEventAction, deleteEventAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Event } from "@/lib/db";
import { formatDate, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/page-header";

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  const user = await requireUser();
  const db = getDb();

  const today = todayIso();
  const { monat } = await searchParams;
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7)) - 1;
  if (monat && /^\d{4}-\d{2}$/.test(monat)) {
    year = Number(monat.slice(0, 4));
    month = Number(monat.slice(5, 7)) - 1;
  }

  const prev = month === 0 ? monthKey(year - 1, 11) : monthKey(year, month - 1);
  const next = month === 11 ? monthKey(year + 1, 0) : monthKey(year, month + 1);

  const events = db
    .prepare(
      "SELECT * FROM events WHERE date LIKE ? ORDER BY date, start_time"
    )
    .all(`${monthKey(year, month)}-%`) as Event[];

  const byDay = new Map<string, Event[]>();
  for (const e of events) {
    const list = byDay.get(e.date) ?? [];
    list.push(e);
    byDay.set(e.date, list);
  }

  // Monday-based calendar grid
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <>
      <PageHeader
        label="Kalender"
        title={`${MONTH_NAMES[month]} ${year}`}
        description="Gemeinsame Termine des Teams im Überblick."
      >
        <div className="relative flex items-center gap-2">
          <Link href={`/kalender?monat=${prev}`} className="btn-secondary !min-h-10 !border-white/40 !px-4 !py-1.5 !text-white hover:!border-transparent">
            ← Zurück
          </Link>
          <Link href="/kalender" className="btn-secondary !min-h-10 !border-white/40 !px-4 !py-1.5 !text-white hover:!border-transparent">
            Heute
          </Link>
          <Link href={`/kalender?monat=${next}`} className="btn-secondary !min-h-10 !border-white/40 !px-4 !py-1.5 !text-white hover:!border-transparent">
            Weiter →
          </Link>
        </div>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-8 py-10 lg:px-12">
        <div className="vtm-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[#E8ECF2] bg-[#F5F7FA] text-center">
            {WEEKDAYS.map((d) => (
              <div key={d} className="vtm-label py-2.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const iso =
                day === null
                  ? null
                  : `${monthKey(year, month)}-${String(day).padStart(2, "0")}`;
              const dayEvents = iso ? (byDay.get(iso) ?? []) : [];
              return (
                <div
                  key={i}
                  className={`min-h-24 border-b border-r border-[#F5F7FA] p-1.5 ${
                    day === null ? "bg-[#F5F7FA]" : "bg-white"
                  }`}
                >
                  {day !== null && (
                    <>
                      <div
                        className={`mb-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-xs ${
                          iso === today ? "font-bold text-white" : "text-[#122952]"
                        }`}
                        style={
                          iso === today
                            ? {
                                background:
                                  "linear-gradient(135deg, #1F4EFF 0%, #4B75FF 100%)",
                              }
                            : undefined
                        }
                      >
                        {day}
                      </div>
                      <div className="space-y-1">
                        {dayEvents.map((e) => (
                          <div
                            key={e.id}
                            title={`${e.title}${e.start_time ? ` (${e.start_time}${e.end_time ? `–${e.end_time}` : ""} Uhr)` : ""}${e.location ? ` @ ${e.location}` : ""}`}
                            className="truncate rounded border-l-2 border-[#1F4EFF] bg-[#F5F7FA] px-1.5 py-0.5 text-xs text-[#122952]"
                          >
                            {e.start_time && (
                              <span className="font-bold">{e.start_time} </span>
                            )}
                            {e.title}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <section>
            <h2 className="vtm-label electric-underline mb-4">Neuer Termin</h2>
            <form action={createEventAction} className="vtm-card grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="ev-title" className="mb-1 block text-sm font-bold">
                  Titel
                </label>
                <input id="ev-title" name="title" required className="vtm-input" />
              </div>
              <div>
                <label htmlFor="ev-date" className="mb-1 block text-xs text-[#8A9BB5]">
                  Datum
                </label>
                <input id="ev-date" type="date" name="date" required className="vtm-input" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label htmlFor="ev-start" className="mb-1 block text-xs text-[#8A9BB5]">
                    Von
                  </label>
                  <input id="ev-start" type="time" name="start_time" className="vtm-input" />
                </div>
                <div className="flex-1">
                  <label htmlFor="ev-end" className="mb-1 block text-xs text-[#8A9BB5]">
                    Bis
                  </label>
                  <input id="ev-end" type="time" name="end_time" className="vtm-input" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ev-loc" className="mb-1 block text-xs text-[#8A9BB5]">
                  Ort (optional)
                </label>
                <input id="ev-loc" name="location" className="vtm-input" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ev-desc" className="mb-1 block text-xs text-[#8A9BB5]">
                  Beschreibung (optional)
                </label>
                <textarea id="ev-desc" name="description" rows={2} className="vtm-input" />
              </div>
              <button
                type="submit"
                className="btn-primary sm:col-span-2 sm:justify-self-start"
              >
                Termin speichern
              </button>
            </form>
          </section>

          <section>
            <h2 className="vtm-label electric-underline mb-4">
              Termine im {MONTH_NAMES[month]}
            </h2>
            <ul className="vtm-card divide-y divide-[#F5F7FA]">
              {events.length === 0 && (
                <li className="px-6 py-7 text-sm text-[#8A9BB5]">
                  Keine Termine in diesem Monat.
                </li>
              )}
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start justify-between gap-4 px-6 py-4"
                >
                  <div>
                    <div className="text-sm font-bold">{e.title}</div>
                    <div className="text-xs text-[#8A9BB5]">
                      {formatDate(e.date)}
                      {e.start_time &&
                        ` · ${e.start_time}${e.end_time ? `–${e.end_time}` : ""} Uhr`}
                      {e.location && ` · ${e.location}`}
                    </div>
                    {e.description && (
                      <p className="mt-1 max-w-[60ch] whitespace-pre-wrap text-xs text-[#122952]">
                        {e.description}
                      </p>
                    )}
                  </div>
                  {(user.role === "admin" || e.created_by === user.id) && (
                    <form action={deleteEventAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <button
                        type="submit"
                        className="text-xs text-[#8A9BB5] underline-offset-2 hover:text-red-700 hover:underline"
                      >
                        Löschen
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
