import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace and form-library imports must share the renderer's React instance.
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: { chunkSizeWarningLimit: 850 },
});
