import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. base "./" so it hosts cleanly on GitHub Pages / Vercel subpaths.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
