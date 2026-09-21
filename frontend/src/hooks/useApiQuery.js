import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loading data for a screen, with the four states a screen actually has.
 *
 * Every screen from 11.4 on needs the same thing and would otherwise grow its
 * own slightly different version:
 *
 *   loading  first fetch in flight — show a skeleton
 *   data     it arrived
 *   error    it did not; `refetch` is how the customer retries
 *   refreshing  a later fetch over data we already have, so the screen updates
 *               in place instead of flashing back to a skeleton
 *
 * Deliberately not a cache. A cart total or a store's open/closed state going
 * stale is worse than a second request, and a real cache (React Query and
 * friends) is a dependency and a set of invalidation rules this app does not
 * need yet. Screens that must not go stale call `refetch`.
 *
 *   const { data, loading, error, refetch } = useApiQuery(
 *     () => endpoints.stores.get(slug),
 *     [slug],
 *   );
 */
export function useApiQuery(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({
    data: null,
    meta: null,
    error: null,
    loading: enabled,
    refreshing: false,
  });

  // Guards against a response from a previous slug landing after a new one — the
  // bug where navigating between two stores quickly shows the wrong store.
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async ({ isRefresh = false } = {}) => {
      if (!enabled) return;

      const id = requestId.current + 1;
      requestId.current = id;

      setState((current) => {
        // Only the FIRST load shows a skeleton. A later fetch — a dependency
        // changing, or an explicit refresh — keeps what is on screen and updates
        // in place. Without this, the store page blanked back to a skeleton the
        // moment the session resolved and `isSaved` became knowable: the shop
        // appeared, vanished, and reappeared.
        //
        // An error counts as something on screen. A failed store page was blanking
        // to a skeleton and back for the same reason, which both looks like a
        // second failure and swaps the element under anyone reading it.
        const isFirstLoad = current.data === null && current.error === null;

        return {
          ...current,
          loading: isFirstLoad && !isRefresh,
          refreshing: !isFirstLoad || isRefresh,
          error: isFirstLoad && !isRefresh ? null : current.error,
        };
      });

      try {
        const result = await fetcher();
        if (!mounted.current || requestId.current !== id) return;

        setState({
          data: result?.data ?? null,
          meta: result?.meta ?? null,
          error: null,
          loading: false,
          refreshing: false,
        });
      } catch (caught) {
        if (!mounted.current || requestId.current !== id) return;
        if (caught?.name === 'AbortError') return;

        setState((current) => ({
          // A failed re-fetch keeps what is on screen: replacing a working page
          // with an error because a background refresh failed is a downgrade.
          data: current.data,
          meta: current.meta,
          error: caught,
          loading: false,
          refreshing: false,
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller states
    // what the fetcher depends on; including `fetcher` would refetch on every
    // render, since it is an inline arrow.
    [enabled, ...deps],
  );

  useEffect(() => {
    run();
  }, [run]);

  const refetch = useCallback(() => run({ isRefresh: false }), [run]);
  const refresh = useCallback(() => run({ isRefresh: true }), [run]);

  return { ...state, refetch, refresh, setData: (data) => setState((s) => ({ ...s, data })) };
}
