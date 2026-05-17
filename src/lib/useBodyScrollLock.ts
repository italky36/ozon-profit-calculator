import { useEffect } from "react";

/** Lock the document body scroll while a modal/drawer is open. Uses the
 * `position:fixed + top:-scrollY` technique so iOS Safari doesn't rubber-
 * band the background. Restores scroll position on unmount. Idempotent
 * across stacked drawers via ref-count on the `data-` attribute. */
const ATTR = "data-scroll-lock-count";

function lockCount(): number {
  return Number(document.body.getAttribute(ATTR) ?? "0");
}

function setLockCount(n: number): void {
  if (n <= 0) document.body.removeAttribute(ATTR);
  else document.body.setAttribute(ATTR, String(n));
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prevCount = lockCount();
    if (prevCount === 0) {
      // First lock — capture style and apply.
      body.dataset.scrollLockTop = String(scrollY);
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
    }
    setLockCount(prevCount + 1);
    return () => {
      const next = lockCount() - 1;
      setLockCount(next);
      if (next <= 0) {
        const restored = Number(body.dataset.scrollLockTop ?? "0");
        body.style.position = "";
        body.style.top = "";
        body.style.left = "";
        body.style.right = "";
        body.style.width = "";
        delete body.dataset.scrollLockTop;
        window.scrollTo(0, restored);
      }
    };
  }, [active]);
}
