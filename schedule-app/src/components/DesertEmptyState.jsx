// A little animated desert scene — cactus, cow skull, and a tumbleweed
// rolling past — shown on Home when every tile has been toggled off.
// Drawn in the app's icon house style (stroke-only, currentColor, no
// fill) so it themes for free instead of carrying its own palette.
// Plain inline SVG + CSS keyframes rather than a video/lottie asset, so
// it costs nothing offline (see .desert-* rules in styles.css).
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export default function DesertEmptyState() {
  return (
    <svg
      className="desert-empty-svg"
      viewBox="0 0 200 120"
      role="img"
      aria-label="An empty desert scene with a cactus, a cow skull, and a tumbleweed rolling by"
    >
      <circle className="desert-sun" cx="168" cy="22" r="12" {...S} />
      <line className="desert-ground" x1="4" y1="96" x2="196" y2="96" {...S} />

      <g className="desert-cactus" transform="translate(44,96)">
        <path
          className="desert-cactus-part"
          d="M0,0 V-44 M0,-20 C-13,-20 -15,-26 -15,-37 M0,-12 C11,-12 13,-17 13,-26
             M-3,-6 L-6,-8 M3,-6 L6,-8
             M-3,-27 L-6,-29 M3,-27 L6,-29
             M-3,-34 L-6,-36 M3,-34 L6,-36
             M-3,-41 L-6,-43 M3,-41 L6,-43
             M-15,-33 L-19,-34 M-15,-33 L-18,-30
             M13,-22 L17,-23 M13,-22 L16,-19"
          {...S}
        />
      </g>

      <g className="desert-skull" transform="translate(148,90) rotate(-16)">
        <path
          className="desert-skull-bone"
          d="M-14,5 C-16,-7 -9,-17 0,-19 C9,-17 16,-7 14,5 C13,9 8,11 8,11 L6,17 L3,11 L-3,11 L-6,17 L-8,11 C-8,11 -13,9 -14,5 Z"
          {...S}
        />
        <path className="desert-skull-horn" d="M-13,-9 C-27,-15 -35,-9 -35,3 C-35,9 -31,13 -27,13" {...S} />
        <path className="desert-skull-horn" d="M13,-9 C27,-15 35,-9 35,3 C35,9 31,13 27,13" {...S} />
        <circle className="desert-skull-socket" cx="-6" cy="-3" r="2.4" {...S} />
        <circle className="desert-skull-socket" cx="6" cy="-3" r="2.4" {...S} />
      </g>

      <g className="desert-tumbleweed-track">
        <g className="desert-tumbleweed-bounce">
          <g className="desert-tumbleweed-frame-a">
            <path
              d="M0,0 L-8,-9 M0,0 L-3,-11 M0,0 L4,-10 M0,0 L9,-6 M0,0 L-10,2 M0,0 L10,3 M0,0 L-7,9 M0,0 L1,11 M0,0 L7,8"
              {...S}
              strokeWidth={1.4}
            />
          </g>
          <g className="desert-tumbleweed-frame-b">
            <circle cx="0" cy="0" r="9" {...S} />
            <path d="M-6,-8 C0,-2 -2,4 -8,6" {...S} />
            <path d="M8,-6 C2,-2 4,4 -2,8" {...S} />
            <path d="M-8,2 C-2,-4 4,-6 8,2" {...S} />
          </g>
        </g>
      </g>
    </svg>
  );
}
