// The Compass mark — a small inline version of the app icon, used across page
// headers so the brand shows up consistently. `size` controls its dimensions.
export default function Logo({ size = 30, className = '' }) {
  return (
    <span className={`logo ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 512 512" width={size} height={size}>
        <defs>
          <linearGradient id="logoBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a7fb0" />
            <stop offset="1" stopColor="#1f5f8b" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="120" fill="url(#logoBg)" />
        <circle cx="256" cy="256" r="150" fill="none" stroke="#ffffff" strokeWidth="20" />
        <polygon points="256,128 300,300 256,272 212,300" fill="#ffffff" />
        <polygon points="256,384 212,212 256,240 300,212" fill="#cfe6f4" />
        <circle cx="256" cy="256" r="18" fill="#1f5f8b" stroke="#ffffff" strokeWidth="8" />
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
