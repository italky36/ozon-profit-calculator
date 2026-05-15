import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, onAuthError, type AuthUser } from "../api";
import { AuthContext } from "./AuthContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.auth.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  useEffect(() => {
    return onAuthError(() => {
      setUser(null);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.auth.login(email, password);
    setUser(user);
  }, []);

  const register = useCallback(
    async (
      email: string,
      password: string,
      workspaceName: string,
      inviteToken?: string,
    ) => {
      return api.auth.register(email, password, workspaceName, inviteToken);
    },
    [],
  );

  const verifyEmail = useCallback(async (token: string) => {
    const { user } = await api.auth.verifyEmail(token);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, verifyEmail, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}
