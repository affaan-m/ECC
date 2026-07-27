// A launch splash: the app icon builds itself rather than just fading in —
// the arch's side blocks rise into place in steps, then the gold keystone
// drops into the top and bursts into a soft glow that fades the whole
// splash away to reveal the app underneath (see App.jsx for the timers
// that drive `fadingOut`, tuned to line up with the CSS animation timings
// below — .splash-arch-clip-rect, .splash-keystone, .splash-glow).
export default function SplashScreen({ fadingOut, variant = 'full' }) {
  return (
    <div
      className={`splash splash--${variant}${fadingOut ? ' splash--out' : ''}`}
      aria-hidden="true"
    >
      <div className="splash-mark-wrap">
        <span className="splash-glow" />
        {/* Tightly framed on the artwork (x 124..388, y 135.6..388) rather
            than the full 512 icon canvas, so the mark actually fills its
            box — at the original viewBox the arch was only ~52% of the
            width, which made a 65vw splash still look small. All the
            animation coordinates below are unaffected: the viewBox only
            changes the visible window, not the coordinate system. */}
        <svg className="splash-mark" viewBox="116 122 280 280">
          <defs>
            <linearGradient id="splashGold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e0c15a" />
              <stop offset="1" stopColor="#a9822a" />
            </linearGradient>
            {/* Reveals the arch bottom-up: the rect's y/height are animated
                in CSS (steps() easing so it reads as blocks stacking, not a
                smooth wipe) while x/width stay fixed, covering the arch's
                full horizontal extent (x 124–388).

                y/height are also set statically here, to the animation's
                *end* state. Animating SVG geometry properties from CSS is
                not supported in Safari, and without a static value the rect
                would default to height 0 there — clipping the arch away
                entirely and leaving the launch screen black. With these, an
                engine that can't run the animation simply shows the finished
                arch instead of building it. */}
            <clipPath id="splashArchClip" clipPathUnits="userSpaceOnUse">
              <rect className="splash-arch-clip-rect" x="100" width="312" y="126" height="262" />
            </clipPath>
          </defs>
          <rect width="512" height="512" rx="112" fill="#111113" />
          <g clipPath="url(#splashArchClip)">
            <path
              fill="#f2efe7"
              d="M124,388 L124,258 A132,132 0 0 1 388,258 L388,388 L324,388 L324,258 A68,68 0 0 0 188,258 L188,388 Z"
            />
            <g stroke="#111113" strokeWidth="7" strokeLinecap="round">
              <line x1="200.3" y1="219.0" x2="147.9" y2="182.3" />
              <line x1="311.7" y1="219.0" x2="364.1" y2="182.3" />
              <line x1="124" y1="324" x2="188" y2="324" />
              <line x1="324" y1="324" x2="388" y2="324" />
            </g>
          </g>
          {/* The keystone (and the two lines outlining its slanted edges,
              which belong visually to this piece, not the arch reveal)
              drops in as its own group once the sides finish building. */}
          <g className="splash-keystone">
            <path
              fill="url(#splashGold)"
              d="M206.5,135.6 A132,132 0 0 1 305.5,135.6 L281.5,195.0 A68,68 0 0 0 230.5,195.0 Z"
            />
            <g stroke="#111113" strokeWidth="7" strokeLinecap="round">
              <line x1="230.5" y1="195.0" x2="206.5" y2="135.6" />
              <line x1="281.5" y1="195.0" x2="305.5" y2="135.6" />
            </g>
          </g>
        </svg>
      </div>
      {/* The gold takeover. Sits above the mark and floods the whole screen
          as the keystone lands, then the splash's own fade-out carries it
          away to reveal the app — so the hand-off is gold to app, with no
          return to black in between. Only on a real launch. */}
      {variant === 'full' && <span className="splash-flash" />}
    </div>
  );
}
