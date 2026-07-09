import Link from "next/link";
import { createEventAction, deleteEventAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Event } from "@/lib/db";
import { formatDate, todayIso } from "@/lib/format";

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
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Kalender</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/kalender?monat=${prev}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ← Zurück
          </Link>
          <span className="min-w-40 text-center text-sm font-semibold">
            {MONTH_NAMES[month]} {year}
          </span>
          <Link
            href={`/kalender?monat=${next}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Weiter →
          </Link>
          <Link
            href="/kalender"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Heute
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium uppercase text-slate-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
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
                className={`min-h-24 border-b border-r border-slate-100 p-1.5 ${
                  day === null ? "bg-slate-50" : ""
                }`}
              >
                {day !== null && (
                  <>
                    <div
                      className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        iso === today
                          ? "bg-blue-600 font-semibold text-white"
                          : "text-slate-600"
                      }`}
                    >
                      {day}
                    </div>
                    <div className="space-y-1">
                      {dayEvents.map((e) => (
                        <div
                          key={e.id}
                          title={`${e.title}${e.start_time ? ` (${e.start_time}${e.end_time ? `–${e.end_time}` : ""} Uhr)` : ""}${e.location ? ` @ ${e.location}` : ""}`}
                          className="truncate rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800"
                        >
                          {e.start_time && (
                            <span className="font-medium">{e.start_time} </span>
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

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Neuer Termin</h2>
          <form
            action={createEventAction}
            className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2"
          >
            <input
              name="title"
              required
              placeholder="Titel"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:col-span-2"
            />
            <div>
              <label className="mb-1 block text-xs text-slate-500">Datum</label>
              <input
                type="date"
                name="date"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-slate-500">Von</label>
                <input
                  type="time"
                  name="start_time"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-slate-500">Bis</label>
                <input
                  type="time"
                  name="end_time"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <input
              name="location"
              placeholder="Ort (optional)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:col-span-2"
            />
            <textarea
              name="description"
              rows={2}
              placeholder="Beschreibung (optional)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:col-span-2"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:col-span-2 sm:justify-self-start"
            >
              Termin speichern
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Termine im {MONTH_NAMES[month]}
          </h2>
          <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {events.length === 0 && (
              <li className="px-5 py-6 text-sm text-slate-500">
                Keine Termine in diesem Monat.
              </li>
            )}
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-3 px-5 py-3"
              >
                <div>
                  <div className="text-sm font-medium">{e.title}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(e.date)}
                    {e.start_time &&
                      ` · ${e.start_time}${e.end_time ? `–${e.end_time}` : ""} Uhr`}
                    {e.location && ` · ${e.location}`}
                  </div>
                  {e.description && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                      {e.description}
                    </p>
                  )}
                </div>
                {(user.role === "admin" || e.created_by === user.id) && (
                  <form action={deleteEventAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <button
                      type="submit"
                      className="text-xs text-slate-400 hover:text-red-600"
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
  );
}
