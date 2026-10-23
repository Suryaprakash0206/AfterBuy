// Test-only frontend server. Credentials below are deliberately invalid placeholders.
// Playwright intercepts every auth/API request; no external service or real user data is used.
import { createServer } from "vite";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-only-invalid-publishable-key";
process.env.VITE_API_BASE_URL = "/api/v1";
const server = await createServer({
  root: "frontend",
  configFile: "frontend/vite.config.ts",
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
await server.listen();
server.printUrls();
