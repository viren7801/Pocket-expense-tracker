import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import LockScreen from "./LockScreen.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LockScreen>
      <App />
    </LockScreen>
  </React.StrictMode>,
);
