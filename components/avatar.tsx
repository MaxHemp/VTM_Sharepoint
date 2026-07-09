import { initials } from "@/lib/format";

// Initialen-Avatar im Electric-Gradient (kleines Akzentelement gemäß CI)
export function Avatar({
  name,
  size = 32,
}: {
  name: string | null;
  size?: number;
}) {
  const text = name ? initials(name) : "?";
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: "var(--gradient-electric)",
        fontFamily: "var(--font-display)",
        letterSpacing: "0.02em",
      }}
    >
      {text}
    </span>
  );
}
