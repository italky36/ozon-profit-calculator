import { createContext } from "react";

export type ToastVariant = "info" | "success" | "error";

export interface ShowOptions {
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastContextValue {
  show: (message: string, opts?: ShowOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
