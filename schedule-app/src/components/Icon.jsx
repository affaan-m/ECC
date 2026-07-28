// The app's icon set, drawn rather than borrowed.
//
// Emoji were quick to write but they're the one thing on screen the theme
// can't touch: they arrive pre-coloured, they render as a different picture
// on every platform, and next to a black-and-gold interface a full-colour
// 🔔 reads as a sticker someone dropped on the page. These are inline SVG
// on a 24×24 grid, stroked in `currentColor`, so every icon takes the
// colour of the text beside it and follows the theme for free.
//
// Map pins are deliberately still emoji — there the colour and the variety
// are the point, and a pin is a label the user picks, not chrome.
//
// House style, matching the tab bar these grew out of: 24×24 viewBox, no
// fill, 2px round-capped strokes. Small solid dots are the only exception.

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

const PATHS = {
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" {...S} />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" {...S} />
      <circle cx="12" cy="12" r="5" {...S} />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" {...S} />
      <path d="M3 9h18M8 3v3M16 3v3" {...S} />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" {...S} />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" {...S} />
      <path d="M16 5.3a3.4 3.4 0 0 1 0 5.4M17 14.6a5.5 5.5 0 0 1 3.5 5.4" {...S} />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.6" {...S} />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" {...S} />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" {...S} />
      <circle cx="12" cy="10" r="2.6" {...S} />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" {...S} />
      <path d="M16 16l4.5 4.5" {...S} />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" {...S} />,
  check: <path d="M4.5 12.5l5 5 10-11" {...S} />,
  plus: <path d="M12 5v14M5 12h14" {...S} />,
  minus: <path d="M5 12h14" {...S} />,
  pencil: (
    <>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" {...S} />
      <path d="M13.5 7l3 3" {...S} />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 12.2a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5L17.5 7" {...S} />
      <path d="M10.5 11v6M13.5 11v6" {...S} />
    </>
  ),
  chevronRight: <path d="M9.5 5.5l6.5 6.5-6.5 6.5" {...S} />,
  chevronLeft: <path d="M14.5 5.5L8 12l6.5 6.5" {...S} />,
  chevronDown: <path d="M5.5 9.5L12 16l6.5-6.5" {...S} />,
  // A paper-plane "go there" arrow, used for directions and outbound links.
  send: <path d="M20.5 3.5L10 14M20.5 3.5l-6.6 17-3.9-6.5L3.5 10z" {...S} />,
  repeat: (
    <>
      <path d="M4 11a7 7 0 0 1 11.9-5H19" {...S} />
      <path d="M20 13a7 7 0 0 1-11.9 5H5" {...S} />
      <path d="M16 3v3h3M8 21v-3H5" {...S} />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z" {...S} />
      <path d="M10 18.5a2.2 2.2 0 0 0 4 0" {...S} />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" {...S} />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...S} />
    </>
  ),
  crown: (
    <>
      <path d="M3.5 7.5l3.6 3.4L12 4.5l4.9 6.4 3.6-3.4-1.7 11.5H5.2z" {...S} />
      <path d="M5.2 19h13.6" {...S} />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" {...S} />
      <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" {...S} />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" {...S} />
      <path d="M7 20v-6M12 20V6M17 20v-9" {...S} />
    </>
  ),
  trending: (
    <>
      <path d="M4 16.5l5-5 3.5 3.5L20 7.5" {...S} />
      <path d="M15 7.5h5v5" {...S} />
    </>
  ),
  flame: (
    <>
      <path d="M12 3s5.5 4.4 5.5 9.4A5.5 5.5 0 0 1 6.5 12.4C6.5 9.6 9 8 9 8s-.4 2.4 1 3.4C10.5 8.5 12 6 12 3z" {...S} />
    </>
  ),
  snowflake: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" {...S} />
      <path d="M9.5 5L12 7.5 14.5 5M9.5 19L12 16.5l2.5 2.5" {...S} />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4.5h10v5a5 5 0 0 1-10 0z" {...S} />
      <path d="M7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4" {...S} />
      <path d="M12 14.5V18M8.5 20.5h7" {...S} />
    </>
  ),
  star: <path d="M12 3.8l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 10l5.9-.8z" {...S} />,
  heart: <path d="M12 20s-7.5-4.7-7.5-9.8A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.9C19.5 15.3 12 20 12 20z" {...S} />,
  lightbulb: (
    <>
      <path d="M9 16.5a6 6 0 1 1 6 0v1.8H9z" {...S} />
      <path d="M9.8 21h4.4" {...S} />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h14v11.5L14.5 20.5H5z" {...S} />
      <path d="M19 16h-4.5v4.5M8.5 9h7M8.5 13h4" {...S} />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M12 7v5.3l3.4 2" {...S} />
    </>
  ),
  phone: (
    <path
      d="M7.2 3.8l2.3 3.6-2 2a13 13 0 0 0 7.1 7.1l2-2 3.6 2.3v3a1.6 1.6 0 0 1-1.8 1.6C10.6 20.5 3.5 13.4 2.6 5.6A1.6 1.6 0 0 1 4.2 3.8z"
      {...S}
    />
  ),
  message: <path d="M4.5 5.5h15v11h-8.5L6 20.5V16.5H4.5z" {...S} />,
  car: (
    <>
      <path d="M4 16.5v-3.2l1.8-4.6A2 2 0 0 1 7.7 7.5h8.6a2 2 0 0 1 1.9 1.2l1.8 4.6v3.2z" {...S} />
      <path d="M4 13.3h16" {...S} />
      <circle cx="8" cy="17.5" r="1.6" {...S} />
      <circle cx="16" cy="17.5" r="1.6" {...S} />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" {...S} />
    </>
  ),
  // "You reached out." A literal handshake collapses into a squiggle at
  // 16px — which is the only size this ever renders at — so it's a person
  // with a tick instead. Unmistakable small, and it says the same thing.
  personCheck: (
    <>
      <circle cx="10" cy="8" r="3.6" {...S} />
      <path d="M3.5 20a6.5 6.5 0 0 1 11-4.7" {...S} />
      <path d="M14 18.2l2.4 2.3 4.6-5" {...S} />
    </>
  ),
  // A waving hand was the obvious pick for "no people yet", and the obvious
  // pick was a blob at icon size — every finger gap closed up. This says
  // the actionable half of the same thing: add someone.
  personPlus: (
    <>
      <circle cx="10" cy="8" r="3.6" {...S} />
      <path d="M3.5 20a6.5 6.5 0 0 1 11-4.7" {...S} />
      <path d="M17.5 15v6M14.5 18h6" {...S} />
    </>
  ),
  // Kept deliberately plain — this renders at 12–15px next to a date, and an
  // earlier version with frosting scallops and three candle flames turned
  // into an unreadable smudge at that size.
  cake: (
    <>
      <path d="M4 20.5v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6z" {...S} />
      <path d="M4 16.5h16" {...S} />
      <path d="M8.5 12.5V10M12 12.5V9.5M15.5 12.5V10" {...S} />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="15.5" r="5" {...S} />
      <path d="M12 3.5l3 3.5-3 3.5-3-3.5z" {...S} />
    </>
  ),
  warning: (
    <>
      <path d="M12 4l9 16H3z" {...S} />
      <path d="M12 10v4.5" {...S} />
      <circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Spokes rather than a toothed outline: the toothed version filled in
  // solid below about 20px.
  gear: (
    <>
      <circle cx="12" cy="12" r="3" {...S} />
      <circle cx="12" cy="12" r="7" {...S} />
      {/* Teeth sit outside the rim rather than crossing it — spokes drawn
          through the circle turned the whole thing into a dark disc small. */}
      <path
        d="M12 5V3M12 19v2M5 12H3M19 12h2M7.05 7.05L5.64 5.64M16.95 16.95l1.41 1.41M16.95 7.05l1.41-1.41M7.05 16.95l-1.41 1.41"
        {...S}
      />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" {...S} />,
  play: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M10 8.5l6 3.5-6 3.5z" {...S} />
    </>
  ),
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
};

export const ICON_NAMES = Object.keys(PATHS);

export default function Icon({ name, size = 18, className = '', title }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon${className ? ` ${className}` : ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {glyph}
    </svg>
  );
}
