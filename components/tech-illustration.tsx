// Geometrische Tech-Illustration gemäß CI-Bildsprache: Orbits, Nodes,
// präzise Linien — Systemfarben, dezent, für leere Zustände und Login.
export function TechIllustration({ size = 160 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      aria-hidden
    >
      <circle cx="80" cy="80" r="64" stroke="var(--accent)" strokeWidth="0.8" opacity="0.25" />
      <circle cx="80" cy="80" r="44" stroke="var(--accent)" strokeWidth="0.8" opacity="0.35" />
      <circle cx="80" cy="80" r="24" stroke="var(--vtm-gold-end)" strokeWidth="0.9" opacity="0.4" />
      <line x1="16" y1="80" x2="144" y2="80" stroke="var(--accent)" strokeWidth="0.6" opacity="0.2" />
      <line x1="80" y1="16" x2="80" y2="144" stroke="var(--accent)" strokeWidth="0.6" opacity="0.2" />
      <circle cx="80" cy="80" r="5" fill="var(--accent)" opacity="0.85" />
      <circle cx="80" cy="36" r="3.5" fill="var(--accent)" opacity="0.6" />
      <circle cx="124" cy="80" r="3.5" fill="var(--vtm-gold-end)" opacity="0.7" />
      <circle cx="49" cy="111" r="3.5" fill="var(--accent)" opacity="0.6" />
      <line x1="80" y1="80" x2="80" y2="36" stroke="var(--accent)" strokeWidth="1" opacity="0.35" />
      <line x1="80" y1="80" x2="124" y2="80" stroke="var(--vtm-gold-end)" strokeWidth="1" opacity="0.4" />
      <line x1="80" y1="80" x2="49" y2="111" stroke="var(--accent)" strokeWidth="1" opacity="0.35" />
    </svg>
  );
}

// Leerer Zustand: Illustration + Botschaft + optionale Handlung
export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <TechIllustration size={120} />
      <p className="mt-4 font-medium text-[var(--ink)]">{title}</p>
      {hint && (
        <p className="mt-1 max-w-sm text-sm text-[var(--ink-soft)]">{hint}</p>
      )}
    </div>
  );
}
