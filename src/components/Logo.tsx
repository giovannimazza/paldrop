export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Paldrop"
    >
      <defs>
        <linearGradient id="paldrop-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path
        d="M24 3c0 0 14 16.5 14 26a14 14 0 1 1-28 0C10 19.5 24 3 24 3z"
        fill="url(#paldrop-gradient)"
      />
      <path
        d="M18 30a6.5 6.5 0 0 0 6.5 6.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}
