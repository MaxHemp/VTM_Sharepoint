/* eslint-disable @next/next/no-img-element */
// Original-VTM-Logo (aus der Markenvorlage, mit Transparenz aufbereitet).
// Quelle: public/vtm-logo.png — erzeugt aus "Logo (1).svg" im Repo-Root.
export function VtmLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/vtm-logo.png"
      alt="VTM Logo"
      width={size}
      height={size}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
