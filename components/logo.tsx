// VTM-Logo als Vektorgrafik: zwei C-Bögen mit Netzwerk-Knoten,
// nachgezeichnet nach der Markenvorlage im Electric-Blue-Gradient.
export function VtmLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1200 1200"
      fill="none"
      role="img"
      aria-label="VTM Logo"
    >
      <defs>
        <linearGradient id="vtmBlue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4B75FF" />
          <stop offset="0.55" stopColor="#1F4EFF" />
          <stop offset="1" stopColor="#122952" />
        </linearGradient>
        <linearGradient id="vtmSteel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E8ECF2" />
          <stop offset="1" stopColor="#8A9BB5" />
        </linearGradient>
      </defs>

      {/* Äußerer C-Bogen */}
      <path
        d="M 790 929 A 380 380 0 1 1 790 271"
        stroke="url(#vtmBlue)"
        strokeWidth="115"
        strokeLinecap="butt"
      />
      {/* Innerer Bogen */}
      <path
        d="M 415 745 A 235 235 0 1 1 780 455"
        stroke="url(#vtmBlue)"
        strokeWidth="95"
        strokeLinecap="butt"
      />

      {/* Verbindungslinien der Netzwerk-Knoten */}
      <g stroke="url(#vtmSteel)" strokeWidth="26">
        <line x1="645" y1="600" x2="845" y2="475" />
        <line x1="645" y1="600" x2="505" y2="735" />
        <line x1="645" y1="600" x2="835" y2="765" />
      </g>

      {/* Netzwerk-Knoten */}
      <g fill="url(#vtmBlue)" stroke="url(#vtmSteel)" strokeWidth="14">
        <circle cx="645" cy="600" r="64" />
        <circle cx="855" cy="470" r="58" />
        <circle cx="495" cy="740" r="48" />
        <circle cx="845" cy="770" r="58" />
      </g>
    </svg>
  );
}
