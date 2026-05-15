import { useEffect } from "react";
import App from "./App";
import LoginPage from "./components/auth/LoginPage";
import RegisterPage from "./components/auth/RegisterPage";
import VerifyEmailPage from "./components/auth/VerifyEmailPage";
import { useAuth } from "./contexts/useAuth";
import { navigate, usePathname } from "./lib/router";

const PUBLIC_PATHS = new Set(["/login", "/register", "/verify-email"]);

export default function RootRouter() {
  const { user, loading } = useAuth();
  const path = usePathname();

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_PATHS.has(path);
    if (!user && !isPublic) {
      navigate("/login");
      return;
    }
    if (user && (path === "/login" || path === "/register")) {
      navigate("/");
    }
  }, [user, loading, path]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  if (path === "/verify-email") return <VerifyEmailPage />;
  if (path === "/login") return <LoginPage />;
  if (path === "/register") return <RegisterPage />;

  if (!user) {
    // Effect above will navigate; render nothing while redirect resolves.
    return null;
  }

  return <App />;
}
