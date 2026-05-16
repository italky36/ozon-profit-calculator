import { useEffect, useState } from "react";

export const MONO_FONT =
  "ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace";

const NARROW_BP = 760;

export function useNarrow(): boolean {
  const get = () =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(`(max-width: ${NARROW_BP}px)`).matches;
  const [n, setN] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(`(max-width: ${NARROW_BP}px)`);
    const fn = () => setN(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);
  return n;
}
