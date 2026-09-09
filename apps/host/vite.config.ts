import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env, at the repo root, as the README describes. Vite otherwise resolves it relative
  // to this package and silently leaves VITE_* unset — which surfaces as the client calling
  // its own origin and the dev server answering with index.html at 200.
  envDir: "../..",
  // Keep the development origin deterministic. On macOS, Vite's implicit `localhost` binding can
  // resolve to IPv6-only `::1`; an OAuth flow started from 127.0.0.1 then returns to an origin the
  // host is not listening on.
  server: { host: "127.0.0.1", port: 5173 },
});
