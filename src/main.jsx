import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import LockScreen from "./LockScreen.jsx";
import { registerPocketServiceWorker } from "./pushNotifications";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => registerPocketServiceWorker().catch(console.error));
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LockScreen>
      <App />
    </LockScreen>
  </React.StrictMode>,
);
