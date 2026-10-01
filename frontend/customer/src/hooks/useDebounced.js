import { useEffect, useState } from 'react';

/**
 * A value that settles after the customer stops typing.
 *
 * Search fires a request per keystroke otherwise: "basmati" is seven requests,
 * six of them already stale by the time they answer, and the last one not
 * necessarily the last to arrive. The delay is the whole mechanism — 300ms is
 * long enough to swallow a word being typed and short enough not to feel lagged.
 */
export function useDebounced(value, delay = 300) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
