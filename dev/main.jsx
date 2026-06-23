import React from "react";
import { createRoot } from "react-dom/client";
import "./mock-bridge.js"; // must run before <App/> boots so the ping is answered
import App from "../app/fuse-companion.jsx";

// The artifact runtime provides Tailwind's animate-spin; supply it locally.
const style = document.createElement("style");
style.textContent = "@keyframes spin{to{transform:rotate(360deg)}}.animate-spin{animation:spin 1s linear infinite}";
document.head.appendChild(style);

createRoot(document.getElementById("root")).render(
  <div style={{ maxWidth: 1100, margin: "24px auto", padding: "0 16px" }}>
    <App />
  </div>
);
