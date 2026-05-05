import { useCallback, useEffect, useState } from "react";

export interface Tweaks {
  accentColor: string;
  darkHeader: boolean;
  showChart: boolean;
  density: "normal" | "compact";
  unitMode: boolean;
}

export const TWEAK_DEFAULTS: Tweaks = {
  accentColor: "#005BFF",
  darkHeader: false,
  showChart: true,
  density: "normal",
  unitMode: false,
};

const STORAGE_KEY = "ozon-calc.tweaks";

export function useTweaks(
  defaults: Tweaks = TWEAK_DEFAULTS,
): [Tweaks, <K extends keyof Tweaks>(key: K, val: Tweaks[K]) => void] {
  const [values, setValues] = useState<Tweaks>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<Tweaks>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {
      // ignore
    }
  }, [values]);

  const setTweak = useCallback(
    <K extends keyof Tweaks>(key: K, val: Tweaks[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [],
  );

  return [values, setTweak];
}
