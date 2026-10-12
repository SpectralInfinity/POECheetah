import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { ItemCheckWindow } from "./ui/ItemCheck";
import "./ui/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.hash === "#item-check" ? <ItemCheckWindow /> : <App />}
  </StrictMode>,
);
