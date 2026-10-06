import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { loadRuntimeConfig } from "./app/config/serverUrl";
import "./styles/index.css";

// Resolves within 1.5s even if /runtime-config.json is missing/slow — see
// loadRuntimeConfig's own doc comment. Awaited here so chatSocketTarget()'s
// first real use (inside CallContext, after login) already has it.
loadRuntimeConfig().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
