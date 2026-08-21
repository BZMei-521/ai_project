import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import "./styles/global.css";
import "./styles/director-desk-tokens.css";
import "./styles/director-desk.css";
import "./styles/script-transition-editor.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
