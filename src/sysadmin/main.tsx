import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../App.css";
import { AuthProvider } from "../contexts/AuthProvider";
import SysadminApp from "./SysadminApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <SysadminApp />
    </AuthProvider>
  </StrictMode>,
);
