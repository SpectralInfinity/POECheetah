import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { ItemCheckWindow } from "./ui/ItemCheck";
import { RunOverlay } from "./ui/Runs";
import "./ui/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.hash === "#item-check" ? (
      <ItemCheckWindow />
    ) : window.location.hash === "#run-overlay" ? (
      <RunOverlay />
    ) : (
      <App />
    )}
  </StrictMode>,
);
