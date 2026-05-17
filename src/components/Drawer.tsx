import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useSwipe } from "../lib/useSwipe";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

export type DrawerSide = "left" | "right" | "bottom" | "center";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side: DrawerSide;
  /** For left/right — px width. For bottom — CSS height (e.g. "85vh"). */
  size?: number | string;
  /** Drag handle on top (visual affordance, bottom-side only). */
  showDragHandle?: boolean;
  /** Header text. Omit for headerless drawer (caller renders own). */
  title?: ReactNode;
  /** Backdrop opacity (0–1). Default 0.4. Set 0 for transparent overlay. */
  backdropOpacity?: number;
  /** Disable swipe-to-close. Default false. */
  disableSwipeClose?: boolean;
  children: ReactNode;
}

/** Portal-based drawer/overlay with side-aware slide animation, backdrop
 * tap-close, Esc-close, focus shift to first focusable on open, and
 * swipe-close (left→close on left-drawer, right→close on right-drawer,
 * down→close on bottom-sheet). Body scroll is locked while open.
 *
 * Animation: rAF-deferred mount so the off-screen transform paints first,
 * then we toggle the in-view transform; on close, we stay mounted for the
 * transition duration before unmounting. */
export default function Drawer({
  open,
  onClose,
  side,
  size,
  showDragHandle,
  title,
  backdropOpacity = 0.4,
  disableSwipeClose,
  children,
}: DrawerProps) {
  useBodyScrollLock(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useMountedRaf(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Move focus inside the drawer on open so keyboard users land in-modal.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const t = setTimeout(() => {
      const node = panelRef.current;
      if (!node) return;
      const focusable = node.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open]);

  const swipe = useSwipe({
    onSwipeLeft: !disableSwipeClose && side === "left" ? onClose : undefined,
    onSwipeRight: !disableSwipeClose && side === "right" ? onClose : undefined,
    onSwipeDown: !disableSwipeClose && side === "bottom" ? onClose : undefined,
    threshold: 60,
  });

  if (!open && !mounted) return null;

  const isVertical = side === "bottom";
  const openState = open && mounted;

  const baseStyle: React.CSSProperties = {
    position: "fixed",
    background: "var(--bg, #fff)",
    boxShadow: "0 0 24px rgba(0,0,0,0.25)",
    display: "flex",
    flexDirection: "column",
    transition:
      side === "center"
        ? "opacity 200ms ease, transform 220ms cubic-bezier(0.2, 0.0, 0.2, 1)"
        : "transform 220ms cubic-bezier(0.2, 0.0, 0.2, 1)",
    willChange: "transform, opacity",
  };

  const sideStyle: React.CSSProperties =
    side === "left"
      ? {
          left: 0,
          top: 0,
          bottom: 0,
          width: typeof size === "number" ? size : (size ?? 280),
          transform: openState ? "translateX(0)" : "translateX(-100%)",
        }
      : side === "right"
        ? {
            right: 0,
            top: 0,
            bottom: 0,
            width: typeof size === "number" ? size : (size ?? 360),
            transform: openState ? "translateX(0)" : "translateX(100%)",
          }
        : side === "center"
          ? {
              top: "50%",
              left: "50%",
              width:
                typeof size === "number"
                  ? size
                  : (size ?? "min(640px, calc(100vw - 32px))"),
              maxHeight: "min(85vh, 720px)",
              borderRadius: 14,
              opacity: openState ? 1 : 0,
              transform: openState
                ? "translate(-50%, -50%) scale(1)"
                : "translate(-50%, -50%) scale(0.96)",
            }
          : {
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight:
                typeof size === "number" ? `${size}px` : (size ?? "85vh"),
              borderRadius: "14px 14px 0 0",
              transform: openState ? "translateY(0)" : "translateY(100%)",
            };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(0, 0, 0, ${backdropOpacity})`,
          opacity: openState ? 1 : 0,
          transition: "opacity 220ms ease",
        }}
      />
      <div ref={panelRef} {...swipe} style={{ ...baseStyle, ...sideStyle }}>
        {showDragHandle && isVertical && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "8px 0 4px",
              touchAction: "none",
            }}
          >
            <div
              style={{
                width: 40,
                height: 4,
                borderRadius: 4,
                background: "var(--border, #d4d4d4)",
              }}
            />
          </div>
        )}
        {title && (
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--border, #e2e2e2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: "0 0 auto",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>
              {title}
            </div>
            <button
              type="button"
              className="btn-icon"
              onClick={onClose}
              title="Закрыть"
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function useMountedRaf(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) {
      // Two-frame defer: ensures the initial off-screen transform paints
      // before we transition to the in-view transform.
      let r2 = 0;
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setMounted(true));
      });
      return () => {
        cancelAnimationFrame(r1);
        if (r2) cancelAnimationFrame(r2);
      };
    }
    // Keep mounted for transition duration (220ms + buffer), then unmount.
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);
  return mounted;
}
