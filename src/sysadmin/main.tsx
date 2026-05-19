import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../App.css";
import { configureApiScope } from "../api";
import { AuthProvider } from "../contexts/AuthProvider";
import CookieNotice from "../components/CookieNotice";
import SysadminApp from "./SysadminApp";

// Must run BEFORE AuthProvider mounts so the initial /api/auth/me sends the
// right scope and reads the sysadmin cookie (not the workspace one — both can
// coexist on the same browser during dev).
configureApiScope("sysadmin");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <SysadminApp />
      <CookieNotice />
    </AuthProvider>
  </StrictMode>,
);
