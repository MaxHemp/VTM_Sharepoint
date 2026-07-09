// Kennzahlen-Kachel: Beschriftung + Wert (+ optionaler Kontext).
// Werte in IBM Plex Mono gemäß CI/CD V2.2 („Kennzahlen"), Text in Texttönen.
export function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="vtm-card vtm-lift flex items-start gap-4 p-5">
      {icon && (
        <span
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[var(--accent)]"
          style={{ background: "rgba(31, 78, 255, 0.08)" }}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--ink-soft)]">
          {label}
        </div>
        <div
          className="mt-0.5 truncate text-[26px] font-medium leading-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {value}
        </div>
        {hint && (
          <div className="mt-0.5 truncate text-xs text-[var(--ink-soft)]">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
