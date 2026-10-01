import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// The public pages a customer opens from a QR or a WhatsApp link. Kept apart
// from the dashboard so a phone on weak 4G downloads a menu, not an admin app.
// Served by the API server under /mw/ (assets) with the page HTML injected
// per shop; in development Vite proxies /api to it.
export default defineConfig({
  base: "/mw/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  server: {
    port: Number(process.env.PORT ?? 5180),
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:8090", changeOrigin: false } },
  },
});
