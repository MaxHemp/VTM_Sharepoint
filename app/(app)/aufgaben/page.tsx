import {
  createTaskAction,
  deleteTaskAction,
  toggleTaskAction,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Task } from "@/lib/db";
import { formatDate, todayIso } from "@/lib/format";

type TaskRow = Task & { assignee: string | null; creator: string | null };

function TaskItem({
  task,
  canDelete,
}: {
  task: TaskRow;
  canDelete: boolean;
}) {
  const overdue =
    task.status === "open" && task.due_date !== null && task.due_date < todayIso();

  return (
    <li className="flex items-start gap-3 px-5 py-4">
      <form action={toggleTaskAction}>
        <input type="hidden" name="id" value={task.id} />
        <button
          type="submit"
          aria-label={
            task.status === "done"
              ? "Als offen markieren"
              : "Als erledigt markieren"
          }
          className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border text-xs ${
            task.status === "done"
              ? "border-green-600 bg-green-600 text-white"
              : "border-slate-300 bg-white text-transparent hover:border-blue-500"
          }`}
        >
          ✓
        </button>
      </form>
      <div className="min-w-0 flex-1">
        <div
          className={`font-medium ${
            task.status === "done" ? "text-slate-400 line-through" : ""
          }`}
        >
          {task.title}
        </div>
        {task.description && (
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">
            {task.description}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          {task.assignee ? `Zugewiesen an ${task.assignee}` : "Nicht zugewiesen"}
          {task.due_date && (
            <span className={overdue ? "font-medium text-red-600" : ""}>
              {" "}
              · fällig am {formatDate(task.due_date)}
              {overdue && " (überfällig)"}
            </span>
          )}
          {task.creator && ` · erstellt von ${task.creator}`}
        </p>
      </div>
      {canDelete && (
        <form action={deleteTaskAction}>
          <input type="hidden" name="id" value={task.id} />
          <button
            type="submit"
            className="text-xs text-slate-400 hover:text-red-600"
          >
            Löschen
          </button>
        </form>
      )}
    </li>
  );
}

export default async function TasksPage() {
  const user = await requireUser();
  const db = getDb();

  const tasks = db
    .prepare(
      `SELECT t.*, a.name AS assignee, c.name AS creator FROM tasks t
       LEFT JOIN users a ON a.id = t.assigned_to
       LEFT JOIN users c ON c.id = t.created_by
       ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.created_at DESC`
    )
    .all() as TaskRow[];

  const users = db
    .prepare("SELECT id, name FROM users ORDER BY name COLLATE NOCASE")
    .all() as { id: number; name: string }[];

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Aufgaben</h1>
      <p className="mt-1 text-sm text-slate-500">
        Gemeinsame Aufgabenliste des Teams.
      </p>

      <form
        action={createTaskAction}
        className="mt-6 grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2"
      >
        <input
          name="title"
          required
          placeholder="Neue Aufgabe"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:col-span-2"
        />
        <textarea
          name="description"
          rows={2}
          placeholder="Beschreibung (optional)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:col-span-2"
        />
        <select
          name="assigned_to"
          defaultValue=""
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">Niemandem zuweisen</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="due_date"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:col-span-2 sm:justify-self-start"
        >
          Aufgabe anlegen
        </button>
      </form>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">
          Offen <span className="text-sm text-slate-400">({open.length})</span>
        </h2>
        <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {open.length === 0 && (
            <li className="px-5 py-6 text-sm text-slate-500">
              Keine offenen Aufgaben. 🎉
            </li>
          )}
          {open.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              canDelete={user.role === "admin" || t.created_by === user.id}
            />
          ))}
        </ul>
      </section>

      {done.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">
            Erledigt{" "}
            <span className="text-sm text-slate-400">({done.length})</span>
          </h2>
          <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {done.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                canDelete={user.role === "admin" || t.created_by === user.id}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
