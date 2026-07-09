import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createFolderAction,
  deleteDocumentAction,
  deleteFolderAction,
  uploadDocumentAction,
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { getDb, type Doc, type Folder } from "@/lib/db";
import { formatDateTime, formatSize } from "@/lib/format";
import { IconFile, IconFolder } from "@/components/icons";
import { PageHeader } from "@/components/page-header";

type DocRow = Doc & { uploader: string | null };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ordner?: string }>;
}) {
  const user = await requireUser();
  const db = getDb();
  const { ordner } = await searchParams;
  const folderId = ordner ? Number(ordner) : null;

  let current: Folder | null = null;
  if (folderId !== null) {
    current =
      (db.prepare("SELECT * FROM folders WHERE id = ?").get(folderId) as
        | Folder
        | undefined) ?? null;
    if (!current) notFound();
  }

  // Breadcrumb path from root to the current folder
  const path: Folder[] = [];
  for (let f = current; f; ) {
    path.unshift(f);
    f = f.parent_id
      ? ((db.prepare("SELECT * FROM folders WHERE id = ?").get(f.parent_id) as
          | Folder
          | undefined) ?? null)
      : null;
  }

  const folders = db
    .prepare(
      folderId === null
        ? "SELECT * FROM folders WHERE parent_id IS NULL ORDER BY name COLLATE NOCASE"
        : "SELECT * FROM folders WHERE parent_id = ? ORDER BY name COLLATE NOCASE"
    )
    .all(...(folderId === null ? [] : [folderId])) as Folder[];

  const docs = db
    .prepare(
      `SELECT d.*, u.name AS uploader FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.folder_id ${folderId === null ? "IS NULL" : "= ?"}
       ORDER BY d.name COLLATE NOCASE`
    )
    .all(...(folderId === null ? [] : [folderId])) as DocRow[];

  return (
    <>
      <PageHeader
        label="Dokumente"
        title={current ? current.name : "Alle Dokumente"}
        description="Dateien des Teams hochladen, organisieren und teilen."
      />

      <div className="mx-auto max-w-6xl px-8 py-10 lg:px-12">
        <nav aria-label="Pfad" className="mb-6 text-sm text-[var(--ink-soft)]">
          <Link
            href="/dokumente"
            className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Alle Dokumente
          </Link>
          {path.map((f) => (
            <span key={f.id}>
              {" / "}
              <Link
                href={`/dokumente?ordner=${f.id}`}
                className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
              >
                {f.name}
              </Link>
            </span>
          ))}
        </nav>

        <div className="mb-8 flex flex-wrap items-stretch gap-4">
          <form
            action={uploadDocumentAction}
            className="vtm-card-raised flex flex-wrap items-center gap-3 p-4"
          >
            {folderId !== null && (
              <input type="hidden" name="folder_id" value={folderId} />
            )}
            <label htmlFor="upload-files" className="sr-only">
              Dateien auswählen
            </label>
            <input
              id="upload-files"
              type="file"
              name="files"
              multiple
              required
              className="text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--surface-default)] file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-[var(--ink)] file:ring-1 file:ring-[var(--hairline)]"
            />
            <button type="submit" className="btn-primary">
              Hochladen
            </button>
          </form>

          <form
            action={createFolderAction}
            className="vtm-card-raised flex items-center gap-3 p-4"
          >
            {folderId !== null && (
              <input type="hidden" name="parent_id" value={folderId} />
            )}
            <label htmlFor="new-folder" className="sr-only">
              Name des neuen Ordners
            </label>
            <input
              id="new-folder"
              name="name"
              required
              placeholder="Neuer Ordner"
              className="vtm-input w-44"
            />
            <button type="submit" className="btn-secondary">
              Anlegen
            </button>
          </form>
        </div>

        <div className="vtm-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--hairline)] bg-[var(--surface-raised)]">
                <th className="vtm-label px-5 py-3.5">Name</th>
                <th className="vtm-label px-5 py-3.5">Größe</th>
                <th className="vtm-label px-5 py-3.5">Hochgeladen von</th>
                <th className="vtm-label px-5 py-3.5">Datum</th>
                <th className="vtm-label px-5 py-3.5 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {folders.length === 0 && docs.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-[var(--ink-soft)]"
                  >
                    Dieser Ordner ist leer. Laden Sie eine Datei hoch oder
                    legen Sie einen Ordner an.
                  </td>
                </tr>
              )}
              {folders.map((f) => (
                <tr
                  key={`f-${f.id}`}
                  className="transition-colors hover:bg-[var(--surface-raised)]"
                >
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/dokumente?ordner=${f.id}`}
                      className="inline-flex min-h-6 items-center gap-2.5 font-bold text-[var(--ink)] hover:text-[var(--accent)]"
                    >
                      <IconFolder className="shrink-0 text-[var(--accent)]" />
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-[var(--ink-soft)]">–</td>
                  <td className="px-5 py-3.5 text-[var(--ink-soft)]">–</td>
                  <td className="vtm-mono px-5 py-3.5 text-[var(--ink-soft)]">
                    {formatDateTime(f.created_at)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {(user.role === "admin" || f.created_by === user.id) && (
                      <form action={deleteFolderAction} className="inline">
                        <input type="hidden" name="id" value={f.id} />
                        <button
                          type="submit"
                          className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-red-700 hover:underline"
                        >
                          Löschen
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {docs.map((d) => (
                <tr
                  key={`d-${d.id}`}
                  className="transition-colors hover:bg-[var(--surface-raised)]"
                >
                  <td className="px-5 py-3.5">
                    <a
                      href={`/api/dateien/${d.id}`}
                      className="inline-flex min-h-6 items-center gap-2.5 font-medium text-[var(--ink)] hover:text-[var(--accent)]"
                    >
                      <IconFile className="shrink-0 text-[var(--ink-soft)]" />
                      {d.name}
                    </a>
                  </td>
                  <td className="vtm-mono px-5 py-3.5 text-[var(--ink-soft)]">
                    {formatSize(d.size)}
                  </td>
                  <td className="px-5 py-3.5 text-[var(--ink-soft)]">
                    {d.uploader ?? "Unbekannt"}
                  </td>
                  <td className="vtm-mono px-5 py-3.5 text-[var(--ink-soft)]">
                    {formatDateTime(d.created_at)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <a
                      href={`/api/dateien/${d.id}`}
                      className="mr-4 text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      Herunterladen
                    </a>
                    {(user.role === "admin" || d.uploaded_by === user.id) && (
                      <form action={deleteDocumentAction} className="inline">
                        <input type="hidden" name="id" value={d.id} />
                        <button
                          type="submit"
                          className="text-xs text-[var(--ink-soft)] underline-offset-2 hover:text-red-700 hover:underline"
                        >
                          Löschen
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
