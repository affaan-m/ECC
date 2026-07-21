// The Stewardly mark — a small inline version of the app icon (a shield
// cradling a sprout), used across page headers so the brand shows up
// consistently. `size` controls its dimensions.
export default function Logo({ size = 30, className = '' }) {
  return (
    <span className={`logo ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 512 512" width={size} height={size}>
        <defs>
          <linearGradient id="logoBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1fb08b" />
            <stop offset="1" stopColor="#0e6e57" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="120" fill="url(#logoBg)" />
        <path
          d="M256,96 L362,138 V252 C362,332 315,392 256,420 C197,392 150,332 150,252 V138 Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="250" y="228" width="12" height="112" rx="6" fill="#ffffff" />
        <ellipse cx="215" cy="262" rx="34" ry="18" fill="#ffffff" transform="rotate(-35 215 262)" />
        <ellipse cx="297" cy="230" rx="34" ry="18" fill="#cfe9df" transform="rotate(35 297 230)" />
        <circle cx="256" cy="348" r="15" fill="#0e6e57" stroke="#ffffff" strokeWidth="7" />
      </svg>
    </span>
  );
}

// A brand row (logo + wordmark) for page headers.
export function Brand({ children }) {
  return (
    <div className="brand">
      <Logo size={30} />
      <h1>{children}</h1>
    </div>
  );
}
