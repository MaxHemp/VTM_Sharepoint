"use client";

import { useRef, useState } from "react";

// Drag-&-Drop-Uploadfläche: Dateien hineinziehen oder klicken zum Auswählen.
// Fällt ohne JavaScript auf ein normales Dateifeld mit Button zurück.
export function UploadZone({
  action,
  folderId,
}: {
  action: (formData: FormData) => Promise<void>;
  folderId: number | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  function submitFiles(files: FileList | null) {
    if (!files || files.length === 0 || !inputRef.current) return;
    inputRef.current.files = files;
    setBusy(true);
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={action}
      className={`vtm-card flex min-h-28 flex-1 cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed p-5 text-center transition-colors ${
        dragging
          ? "border-[var(--accent)] bg-[rgba(31,78,255,0.05)]"
          : "border-[var(--hairline)] hover:border-[var(--accent)]"
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        submitFiles(e.dataTransfer.files);
      }}
    >
      {folderId !== null && (
        <input type="hidden" name="folder_id" value={folderId} />
      )}
      <input
        ref={inputRef}
        type="file"
        name="files"
        multiple
        className="sr-only"
        aria-label="Dateien auswählen"
        onChange={(e) => submitFiles(e.currentTarget.files)}
      />
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]" aria-hidden>
        <path d="M12 15V4m0 0 4 4m-4-4L8 8M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
      </svg>
      <span className="text-sm font-medium text-[var(--ink)]">
        {busy ? "Wird hochgeladen …" : "Dateien hierher ziehen"}
      </span>
      <span className="text-xs text-[var(--ink-soft)]">
        oder klicken zum Auswählen
      </span>
    </form>
  );
}
