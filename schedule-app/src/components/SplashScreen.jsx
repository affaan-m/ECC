// A brief launch splash: the mark rendered as a flat silhouette (black in
// light mode, white in dark mode) that fades to reveal the app underneath.
export default function SplashScreen({ fadingOut }) {
  return (
    <div className={`splash${fadingOut ? ' splash--out' : ''}`} aria-hidden="true">
      <svg className="splash-mark" viewBox="0 0 512 512" width="96" height="96">
        <path
          d="M256,96 L362,138 V252 C362,332 315,392 256,420 C197,392 150,332 150,252 V138 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="250" y="228" width="12" height="112" rx="6" fill="currentColor" />
        <ellipse cx="215" cy="262" rx="34" ry="18" fill="currentColor" transform="rotate(-35 215 262)" />
        <ellipse cx="297" cy="230" rx="34" ry="18" fill="currentColor" transform="rotate(35 297 230)" />
        <circle cx="256" cy="348" r="15" fill="none" stroke="currentColor" strokeWidth="7" />
      </svg>
    </div>
  );
}
