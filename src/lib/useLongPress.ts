import { useCallback, useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

export interface LongPressOptions {
  onLongPress: () => void;
  /** Hold time in ms before firing. Default 400 — between Slack (500) and
   * iOS (300), avoids both «too eager» and «too sluggish». */
  delayMs?: number;
  /** Cancel if the finger moves more than this many px from the start
   * point. Default 10 — large enough to forgive jitter, small enough to
   * cancel any actual scroll. */
  moveThresholdPx?: number;
}

export interface LongPressHandlers {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  /** Suppress the platform context menu that Android sometimes raises on
   * long-press of an element. Caller spreads this onto the same element. */
  onContextMenu: (e: React.MouseEvent | React.SyntheticEvent) => void;
}

/** Touch-only long-press detector. Cancels on finger move (treated as a
 * scroll) and on touchend before the delay. Caller is responsible for
 * giving the user some visual confirmation (e.g. haptic-like animation). */
export function useLongPress(opts: LongPressOptions): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX.current = t.clientX;
      startY.current = t.clientY;
      fired.current = false;
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        opts.onLongPress();
      }, opts.delayMs ?? 400);
    },
    [opts, clear],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - startX.current);
      const dy = Math.abs(t.clientY - startY.current);
      const limit = opts.moveThresholdPx ?? 10;
      if (dx > limit || dy > limit) clear();
    },
    [opts.moveThresholdPx, clear],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent | React.SyntheticEvent) => {
      if (fired.current) e.preventDefault();
    },
    [],
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onContextMenu,
  };
}
