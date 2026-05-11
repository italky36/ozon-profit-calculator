import { useEffect, useState } from "react";

/** Minimal pathname-based routing. Listens to popstate so back/forward work. */
export function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    window.addEventListener("locationchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("locationchange", onPop);
    };
  }, []);
  return path;
}

export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("locationchange"));
}

export function getQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}
