import { useCountUp } from '../data/useCountUp.js';

// Renders a number that eases toward `value` when it changes (a streak
// count going up, a percentage recalculating) instead of jumping instantly.
export default function AnimatedNumber({ value }) {
  return useCountUp(value);
}
