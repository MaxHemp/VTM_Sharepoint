// Seitenkopf nach CI/CD V2.2: hell, Kicker mit Gold-Signaturpunkt,
// Headline in Cobalt-Tinte, kurze 2px-Akzentlinie — kein Flächen-Banner.
export function PageHeader({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-[var(--hairline)] px-8 pb-6 pt-8 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="vtm-kicker mb-2">{label}</div>
          <h1 className="font-display accent-line text-3xl font-bold leading-tight text-[var(--ink)]">
            {title}
          </h1>
          {description && (
            <p className="mt-3 max-w-xl text-sm text-[var(--ink-soft)]">
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}
