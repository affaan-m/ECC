// A little desert scene — styled after Chrome's offline "dino game" —
// shown on Home when every tile has been toggled off: a couple of
// blocky cacti (hollow, outline-only) on a bumpy ground line, plus a
// tumbleweed that blows by left to right on a loop. Sun or moon
// depends on the active theme. Drawn in currentColor, matching the
// app's icon house style, so it costs nothing offline and themes for
// free.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const SOLID = { fill: 'currentColor', stroke: 'none' };

function Cactus({ x, h, left, right }) {
  const tw = 2.5;
  return (
    <g className="desert-cactus" transform={`translate(${x},96)`}>
      <rect {...S} x={-tw} y={-h} width={tw * 2} height={h} rx={tw} />
      {left && <rect {...S} x={-tw - left.w} y={left.y} width={left.w} height={left.h} rx={left.w / 2} />}
      {right && <rect {...S} x={tw} y={right.y} width={right.w} height={right.h} rx={right.w / 2} />}
    </g>
  );
}

export default function DesertEmptyState() {
  return (
    <svg
      className="desert-empty-svg"
      viewBox="0 0 200 120"
      role="img"
      aria-label="An empty desert scene with a couple of cacti and a tumbleweed blowing by"
    >
      <g className="desert-sun-icon">
        <circle cx="168" cy="20" r="11" {...S} />
      </g>
      <g className="desert-moon-icon" transform="translate(148,3)">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" {...SOLID} />
      </g>

      <path className="desert-ground" d="M4,96 L36,96 L40,94 L58,96 L96,96 L100,94 L134,96 L164,96 L168,94 L196,96" {...S} strokeWidth={1.5} />

      <Cactus x={34} h={38} left={{ y: -26, h: 16, w: 4 }} right={{ y: -32, h: 12, w: 4 }} />
      <Cactus x={56} h={24} right={{ y: -18, h: 10, w: 3.5 }} />
      <Cactus x={118} h={15} />

      <g className="desert-tumbleweed-track">
        <g className="desert-tumbleweed-bounce">
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
    </svg>
  );
}
