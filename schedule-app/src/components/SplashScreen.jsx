// A brief launch splash: the app icon (fixed black/gold/ivory brand colors,
// not theme-adaptive — the mark is a badge, not a silhouette) that fades to
// reveal the app underneath.
export default function SplashScreen({ fadingOut }) {
  return (
    <div className={`splash${fadingOut ? ' splash--out' : ''}`} aria-hidden="true">
      <svg className="splash-mark" viewBox="0 0 512 512" width="120" height="120">
        <defs>
          <linearGradient id="splashGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e0c15a" />
            <stop offset="1" stopColor="#a9822a" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="112" fill="#111113" />
        <path
          fill="#f2efe7"
          d="M124,388 L124,258 A132,132 0 0 1 388,258 L388,388 L324,388 L324,258 A68,68 0 0 0 188,258 L188,388 Z"
        />
        <path
          fill="url(#splashGold)"
          d="M206.5,135.6 A132,132 0 0 1 305.5,135.6 L281.5,195.0 A68,68 0 0 0 230.5,195.0 Z"
        />
        <g stroke="#111113" strokeWidth="7" strokeLinecap="round">
          <line x1="230.5" y1="195.0" x2="206.5" y2="135.6" />
          <line x1="281.5" y1="195.0" x2="305.5" y2="135.6" />
          <line x1="200.3" y1="219.0" x2="147.9" y2="182.3" />
          <line x1="311.7" y1="219.0" x2="364.1" y2="182.3" />
          <line x1="124" y1="324" x2="188" y2="324" />
          <line x1="324" y1="324" x2="388" y2="324" />
        </g>
      </svg>
    </div>
  );
}
