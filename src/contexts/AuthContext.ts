import { createContext } from "react";
import type { AuthUser } from "../api";

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    workspaceName: string,
    inviteToken?: string,
  ) => Promise<{ message: string }>;
  verifyEmail: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
