import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env, at the repo root, as the README describes. Vite otherwise resolves it relative
  // to this package and silently leaves VITE_* unset — which surfaces as the client calling
  // its own origin and the dev server answering with index.html at 200.
  envDir: "../..",
  server: { port: 5173 },
});
