import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// single theme — set before first render so deck/globe read the right accent
document.documentElement.setAttribute("data-theme", "editorial");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Remove any previously-installed service worker + caches. A caching SW was
// serving stale builds (broken chunk references after a redeploy); the site now
// runs network-only (the browser still HTTP-caches the immutable hashed assets).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
