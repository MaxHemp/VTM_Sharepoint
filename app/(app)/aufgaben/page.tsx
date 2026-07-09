import {
  createTaskAction,
  deleteTaskAction,
  toggleTaskAction,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Task } from "@/lib/db";
import { formatDate, todayIso } from "@/lib/format";
import { PageHeader } from "@/components/page-header";

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
    <li className="flex items-start gap-4 px-6 py-4">
      <form action={toggleTaskAction}>
        <input type="hidden" name="id" value={task.id} />
        <button
          type="submit"
          aria-label={
            task.status === "done"
              ? "Als offen markieren"
              : "Als erledigt markieren"
          }
          className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border text-xs text-white transition-colors ${
            task.status === "done"
              ? "border-transparent"
              : "border-[var(--ink-soft)] bg-[var(--surface-default)] hover:border-[var(--accent)]"
          }`}
          style={
            task.status === "done"
              ? { background: "var(--gradient-electric)" }
              : undefined
          }
        >
          {task.status === "done" ? "✓" : ""}
        </button>
      </form>
      <div className="min-w-0 flex-1">
        <div
          className={`font-bold ${
            task.status === "done"
              ? "text-[var(--ink-soft)] line-through"
              : "text-[var(--ink)]"
          }`}
        >
          {task.title}
        </div>
        {task.description && (
          <p className="mt-0.5 max-w-[68ch] whitespace-pre-wrap text-sm text-[var(--ink)]">
            {task.description}
          </p>
        )}
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          {task.assignee ? `Zugewiesen an ${task.assignee}` : "Nicht zugewiesen"}
          {task.due_date && (
            <span
              className={overdue ? "font-bold text-red-700" : "vtm-mono"}
            >
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
            className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-red-700 hover:underline"
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
    <>
      <PageHeader
        label="Aufgaben"
        title="Gemeinsame Aufgabenliste"
        description="Aufgaben des Teams anlegen, zuweisen und abschließen."
      />

      <div className="mx-auto max-w-4xl px-8 py-10 lg:px-12">
        <form
          action={createTaskAction}
          className="vtm-card-raised grid gap-4 p-5 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <label htmlFor="task-title" className="mb-1 block text-sm font-bold">
              Neue Aufgabe
            </label>
            <input
              id="task-title"
              name="title"
              required
              placeholder="Was ist zu tun?"
              className="vtm-input"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="task-desc"
              className="mb-1 block text-xs text-[var(--ink-soft)]"
            >
              Beschreibung (optional)
            </label>
            <textarea
              id="task-desc"
              name="description"
              rows={2}
              className="vtm-input"
            />
          </div>
          <div>
            <label
              htmlFor="task-assignee"
              className="mb-1 block text-xs text-[var(--ink-soft)]"
            >
              Zuweisen an
            </label>
            <select
              id="task-assignee"
              name="assigned_to"
              defaultValue=""
              className="vtm-input"
            >
              <option value="">Niemanden</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="task-due"
              className="mb-1 block text-xs text-[var(--ink-soft)]"
            >
              Fällig am
            </label>
            <input id="task-due" type="date" name="due_date" className="vtm-input" />
          </div>
          <button
            type="submit"
            className="btn-primary sm:col-span-2 sm:justify-self-start"
          >
            Aufgabe anlegen
          </button>
        </form>

        <section className="mt-10">
          <h2 className="vtm-kicker accent-line mb-4">
            Offen ({open.length})
          </h2>
          <ul className="vtm-card divide-y divide-[var(--hairline)]">
            {open.length === 0 && (
              <li className="px-6 py-7 text-sm text-[var(--ink-soft)]">
                Keine offenen Aufgaben.
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
          <section className="mt-10">
            <h2 className="vtm-kicker accent-line mb-4">
              Erledigt ({done.length})
            </h2>
            <ul className="vtm-card divide-y divide-[var(--hairline)]">
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
    </>
  );
}
