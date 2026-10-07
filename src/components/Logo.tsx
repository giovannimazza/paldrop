const BRAND = "#6366f1";

// "P" whose counter is cut out in the shape of a drop (fill-rule: evenodd).
const MARK =
  "M13 5h13a13 13 0 0 1 0 26h-7v12h-6z " +
  "M27 10.5c0 0 5.5 6.5 5.5 10a5.5 5.5 0 1 1-11 0C21.5 17 27 10.5 27 10.5z";

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
      <path d={MARK} fill={BRAND} fillRule="evenodd" />
    </svg>
  );
}
