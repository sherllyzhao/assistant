import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

const canRegisterServiceWorker =
  "serviceWorker" in navigator &&
  (import.meta.env.PROD || ["localhost", "127.0.0.1"].includes(window.location.hostname));

if (canRegisterServiceWorker) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.error(error));
  });
}
