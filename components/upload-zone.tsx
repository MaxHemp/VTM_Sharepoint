"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Drag-&-Drop-Uploadfläche für Dateien UND ganze Ordner.
// Ordnerstrukturen werden mitsamt Unterordnern im Portal nachgebaut.

type Entry = { file: File; relPath: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function collectDropped(items: DataTransferItemList): Promise<Entry[]> {
  const out: Entry[] = [];

  async function walk(entry: any, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, relPath: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries liefert höchstens 100 Einträge pro Aufruf
      let batch: any[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) {
          await walk(child, prefix + entry.name + "/");
        }
      } while (batch.length > 0);
    }
  }

  const entries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = (items[i] as any).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  for (const entry of entries) await walk(entry, "");
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function UploadZone({
  action,
  folderId,
}: {
  action: (formData: FormData) => Promise<void>;
  folderId: number | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(entries: Entry[]) {
    if (entries.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      if (folderId !== null) formData.append("folder_id", String(folderId));
      for (const e of entries) {
        formData.append("files", e.file);
        formData.append("paths", e.relPath);
      }
      await action(formData);
      router.refresh();
    } catch {
      setError(
        "Der Upload ist fehlgeschlagen. Bitte versuchen Sie es erneut — bei sehr großen Dateien (über 500 MB) teilen Sie den Upload bitte auf."
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (dirRef.current) dirRef.current.value = "";
    }
  }

  function fromInput(files: FileList | null) {
    if (!files) return;
    const entries: Entry[] = Array.from(files).map((file) => ({
      file,
      // Bei Ordner-Auswahl liefert der Browser den relativen Pfad mit
      relPath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name,
    }));
    void upload(entries);
  }

  return (
    <div className="flex min-w-64 flex-1 flex-col gap-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Dateien oder Ordner hochladen"
        className={`vtm-card flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed p-5 text-center transition-colors ${
          dragging
            ? "border-[var(--accent)] bg-[rgba(31,78,255,0.05)]"
            : "border-[var(--hairline)] hover:border-[var(--accent)]"
        }`}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void collectDropped(e.dataTransfer.items).then(upload);
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--accent)]"
          aria-hidden
        >
          <path d="M12 15V4m0 0 4 4m-4-4L8 8M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
        </svg>
        <span className="text-sm font-medium text-[var(--ink)]">
          {busy ? "Wird hochgeladen …" : "Dateien oder Ordner hierher ziehen"}
        </span>
        <span className="text-xs text-[var(--ink-soft)]">
          oder unten auswählen — Unterordner werden übernommen
        </span>
      </div>

      <div className="flex gap-4 px-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline disabled:opacity-50"
        >
          Dateien auswählen
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => dirRef.current?.click()}
          className="text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline disabled:opacity-50"
        >
          Ordner auswählen
        </button>
      </div>

      {error && (
        <p role="alert" className="px-1 text-xs text-red-700">
          {error}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Dateien auswählen"
        onChange={(e) => fromInput(e.currentTarget.files)}
      />
      <input
        ref={dirRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Ordner auswählen"
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(e) => fromInput(e.currentTarget.files)}
      />
    </div>
  );
}
