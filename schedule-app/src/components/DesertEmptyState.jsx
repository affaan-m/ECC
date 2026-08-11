import { useId } from 'react';

// A little desert scene — styled after Chrome's offline "dino game" —
// shown on Home when every tile has been toggled off: a couple of
// blocky cacti (hollow, outline-only) on a bumpy ground line, plus a
// tumbleweed that blows by left to right on a loop, ducking behind the
// small cactus and vanishing behind clipped "walls" at each edge of
// the floor between crossings. Sun or moon depends on the active
// theme. Drawn in currentColor, matching the app's icon house style,
// so it costs nothing offline and themes for free.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const SOLID = { fill: 'currentColor', stroke: 'none' };

function Cactus({ x, h, left, right, tw = 3 }) {
  return (
    <g className="desert-cactus" transform={`translate(${x},96)`}>
      <rect {...S} x={-tw} y={-h} width={tw * 2} height={h} rx={tw * 0.55} />
      {left && <rect {...S} x={-tw - left.w} y={left.y} width={left.w} height={left.h} rx={left.w * 0.45} />}
      {right && <rect {...S} x={tw} y={right.y} width={right.w} height={right.h} rx={right.w * 0.45} />}
    </g>
  );
}

function WindScratch({ className }) {
  return (
    <path
      className={className}
      d="M-30,-5 L-24,-6 M-30,5 L-24,4 M-22,0 C-12,-5 -4,5 6,-1 C9,-3 8,-6 5,-6 C3,-6 2,-4 3,-2"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export default function DesertEmptyState() {
  const clipId = useId();
  return (
    <svg
      className="desert-empty-svg"
      viewBox="0 0 200 120"
      role="img"
      aria-label="An empty desert scene with a couple of cacti and a tumbleweed blowing by"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="4" y="0" width="192" height="120" />
        </clipPath>
      </defs>

      <g className="desert-sun-icon">
        <circle cx="168" cy="20" r="11" {...S} />
        <path
          d="M182,20 L187,20 M177.9,29.9 L181.4,33.4 M168,34 L168,39 M158.1,29.9 L154.6,33.4
             M154,20 L149,20 M158.1,10.1 L154.6,6.6 M168,6 L168,1 M177.9,10.1 L181.4,6.6"
          {...S}
          strokeWidth={1.8}
        />
      </g>
      <g className="desert-moon-icon" transform="translate(148,3)">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" {...SOLID} />
      </g>

      <path className="desert-ground" d="M4,96 L22,96 L26,94 L36,96 L50,96 L54,94 L64,96 L114,96 L118,94 L130,96 L168,96 L172,94 L182,96 L196,96" {...S} strokeWidth={1.5} />

      <Cactus x={30} h={50} tw={3.3} left={{ y: -34, h: 22, w: 5 }} right={{ y: -42, h: 16, w: 5 }} />
      <Cactus x={58} h={32} tw={3} right={{ y: -22, h: 14, w: 4.5 }} />

      <g clipPath={`url(#${clipId})`}>
        <WindScratch className="desert-wind desert-wind-a" />
        <WindScratch className="desert-wind desert-wind-b" />
        <g className="desert-tumbleweed-track">
          <g className="desert-tumbleweed-spin">
            <circle cx="0" cy="0" r="10" {...S} />
            <path d="M-6,-8 C0,-2 -2,4 -8,6" {...S} />
            <path d="M8,-6 C2,-2 4,4 -2,8" {...S} />
            <path d="M-8,2 C-2,-4 4,-6 8,2" {...S} />
            <path d="M0,-10 L0,-13 M0,-10 L-2,-12.5" {...S} />
            <path d="M8.6,-4.9 L11.6,-6.2 M8.6,-4.9 L11,-3.2" {...S} />
            <path d="M5.3,8.3 L6.7,11.1 M5.3,8.3 L3.5,10.7" {...S} />
            <path d="M-8.6,4.9 L-11.4,6.5 M-8.6,4.9 L-10.3,3" {...S} />
            <path d="M-6.7,-7.5 L-9.4,-9.3 M-6.7,-7.5 L-8.9,-6" {...S} />
          </g>
        </g>
      </g>

      <Cactus x={122} h={20} tw={2.8} />
    </svg>
  );
}
