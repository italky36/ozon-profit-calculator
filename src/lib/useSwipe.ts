import { useCallback, useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

export interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** Min absolute distance to count as a swipe. Default 50px. */
  threshold?: number;
  /** Max angle deviation from cardinal axis. Below this, the swipe is
   * accepted; above, treated as diagonal and ignored. Default 30°. */
  maxAngleDeg?: number;
  /** If set, only fire when the touch STARTED within this many px of the
   * left screen edge. Used for «swipe from edge to open drawer» gestures. */
  edgeStartPx?: number;
}

export interface SwipeHandlers {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  onTouchEnd: (e: ReactTouchEvent) => void;
}

/** Horizontal + vertical swipe detector. Stateless from the parent's POV —
 * stash the returned handlers onto the element you want to listen on.
 *
 * Angle filter rejects diagonal motion (default ≥30° off axis). This
 * prevents accidental swipes during diagonal scrolls — common when the
 * user is scrolling through a wrapping feed. */
export function useSwipe(opts: SwipeOptions): SwipeHandlers {
  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (opts.edgeStartPx != null && t.clientX > opts.edgeStartPx) {
        active.current = false;
        return;
      }
      startX.current = t.clientX;
      startY.current = t.clientY;
      active.current = true;
    },
    [opts.edgeStartPx],
  );

  const onTouchMove = useCallback(() => {
    // Reserved — could call preventDefault here for sticky drag.
  }, []);

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      if (!active.current) return;
      active.current = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const threshold = opts.threshold ?? 50;
      const maxDeg = opts.maxAngleDeg ?? 30;
      const maxRatio = Math.tan((maxDeg * Math.PI) / 180);

      // Horizontal swipe?
      if (absDx >= threshold && absDx > absDy) {
        if (absDy / absDx > maxRatio) return;
        if (dx < 0) opts.onSwipeLeft?.();
        else opts.onSwipeRight?.();
        return;
      }
      // Vertical swipe?
      if (absDy >= threshold && absDy > absDx) {
        if (absDx / absDy > maxRatio) return;
        if (dy < 0) opts.onSwipeUp?.();
        else opts.onSwipeDown?.();
      }
    },
    [opts],
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}
