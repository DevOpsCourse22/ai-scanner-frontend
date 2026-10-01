import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled, not fetched from a font CDN: the app makes no request
// to a third party just to draw its text.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
