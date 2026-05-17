import { useMediaQuery } from "./useMediaQuery";

export type ChatLayoutMode = "desktop" | "tablet" | "mobile";

export interface ChatLayoutState {
  mode: ChatLayoutMode;
  isDesktop: boolean;
  isTablet: boolean;
  isMobile: boolean;
  /** True when the device lacks a precise pointer (touch-first). On such
   * devices `:hover` doesn't fire reliably, so we replace hover-revealed
   * action icons with long-press menus. */
  isTouch: boolean;
}

const DESKTOP_QUERY = "(min-width: 1024px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1023.98px)";
// "any-hover: none" — no input mechanism that can hover (covers phones,
// tablets without trackpads). Combined with coarse pointer for safety on
// hybrid devices that report both.
const TOUCH_QUERY = "(hover: none), (pointer: coarse)";

/** Layout breakpoints + input modality for the chat surface.
 *
 *   <768px            → mobile
 *   768px–1023.98px   → tablet
 *   ≥1024px           → desktop
 *
 * Use `isTouch` (orthogonal to size) to decide between hover-icons and
 * long-press menus; e.g. an iPad Pro is `tablet + touch`, a small laptop
 * window is `tablet + !touch`. */
export function useChatLayout(): ChatLayoutState {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isTablet = useMediaQuery(TABLET_QUERY);
  const isTouch = useMediaQuery(TOUCH_QUERY);
  const isMobile = !isDesktop && !isTablet;
  const mode: ChatLayoutMode = isDesktop
    ? "desktop"
    : isTablet
      ? "tablet"
      : "mobile";
  return { mode, isDesktop, isTablet, isMobile, isTouch };
}
