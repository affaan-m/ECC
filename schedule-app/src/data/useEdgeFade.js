import { useEffect, useState } from 'react';

// Fades the left/right edge of a horizontally-scrollable row only when
// there's actually more content in that direction — a chip sitting flush
// against the start of a row that fits entirely on screen has nothing to
// scroll back to, so it shouldn't look faded out.
export function useEdgeFade(ref, deps = []) {
  const [fade, setFade] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setFade({
        left: scrollLeft > 2,
        right: scrollLeft + clientWidth < scrollWidth - 2,
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return fade;
}
