import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { syncThemeFromPreference } from "./lib/theme-preference";
import "./styles.css";

syncThemeFromPreference();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Console root element not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
