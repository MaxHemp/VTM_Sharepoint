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
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold">Dokumente</h1>
      <nav className="mt-1 text-sm text-slate-500">
        <Link href="/dokumente" className="hover:text-blue-600">
          Alle Dokumente
        </Link>
        {path.map((f) => (
          <span key={f.id}>
            {" / "}
            <Link
              href={`/dokumente?ordner=${f.id}`}
              className="hover:text-blue-600"
            >
              {f.name}
            </Link>
          </span>
        ))}
      </nav>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form
          action={uploadDocumentAction}
          className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200"
        >
          {folderId !== null && (
            <input type="hidden" name="folder_id" value={folderId} />
          )}
          <input
            type="file"
            name="files"
            multiple
            required
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Hochladen
          </button>
        </form>

        <form
          action={createFolderAction}
          className="flex items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200"
        >
          {folderId !== null && (
            <input type="hidden" name="parent_id" value={folderId} />
          )}
          <input
            name="name"
            required
            placeholder="Neuer Ordner"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Anlegen
          </button>
        </form>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Größe</th>
              <th className="px-4 py-3">Hochgeladen von</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {folders.length === 0 && docs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Dieser Ordner ist leer. Lade eine Datei hoch oder lege einen
                  Ordner an.
                </td>
              </tr>
            )}
            {folders.map((f) => (
              <tr key={`f-${f.id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/dokumente?ordner=${f.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    📁 {f.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-400">–</td>
                <td className="px-4 py-3 text-slate-400">–</td>
                <td className="px-4 py-3 text-slate-500">
                  {formatDateTime(f.created_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  {(user.role === "admin" || f.created_by === user.id) && (
                    <form action={deleteFolderAction} className="inline">
                      <input type="hidden" name="id" value={f.id} />
                      <button
                        type="submit"
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Löschen
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {docs.map((d) => (
              <tr key={`d-${d.id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <a
                    href={`/api/dateien/${d.id}`}
                    className="font-medium text-slate-800 hover:text-blue-700 hover:underline"
                  >
                    📄 {d.name}
                  </a>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {formatSize(d.size)}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {d.uploader ?? "Unbekannt"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {formatDateTime(d.created_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={`/api/dateien/${d.id}`}
                    className="mr-3 text-xs text-blue-600 hover:underline"
                  >
                    Herunterladen
                  </a>
                  {(user.role === "admin" || d.uploaded_by === user.id) && (
                    <form action={deleteDocumentAction} className="inline">
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        className="text-xs text-slate-400 hover:text-red-600"
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
  );
}
