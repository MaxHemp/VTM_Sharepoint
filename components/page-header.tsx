// Seitenkopf im Stil der VTM-Kapitel-Banner: Gradient-Fläche, ALL-CAPS-Label,
// weiße Headline, Electric-Akzentlinie am unteren Rand.
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
    <header className="vtm-banner px-8 py-8 lg:px-12">
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="vtm-label-light mb-2">{label}</div>
          <h1
            className="text-3xl font-black leading-tight text-white"
            style={{ fontFamily: "'Arial Narrow', Arial, sans-serif" }}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-xl text-sm font-light text-[#8A9BB5]">
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}
