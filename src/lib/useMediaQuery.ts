import { useEffect, useState } from "react";

/** Subscribe to a CSS media query. SSR-safe: initial value is `false` when
 * `window` is unavailable, then synced on mount. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Sync once on (re-)subscribe — query may have changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
