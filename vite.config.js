import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev harness only. Serves dev/index.html and bundles app/fuse-companion.jsx
// with mocked bridge + Claude (see dev/mock-bridge.js). Not part of the shipped app.
export default defineConfig({
  root: "dev",
  plugins: [react()],
  server: { open: true, fs: { allow: [".."] } }, // allow importing ../app/*
});
