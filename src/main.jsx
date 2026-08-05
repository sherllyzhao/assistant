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
    // 相对路径注册：部署在子路径（如 GitHub Pages 的 /assistant/）时绝对路径 /sw.js 会 404。
    navigator.serviceWorker.register("./sw.js").catch((error) => console.error(error));
  });
}
