import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "@renderer/App";
import "@renderer/styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "Renderer bootstrap failed: #root not found in index.html",
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
