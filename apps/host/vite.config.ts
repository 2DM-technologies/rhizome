import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DEV_HOST = "127.0.0.1";
const DEV_PORT = 5173;
const DEV_ORIGIN = `http://${DEV_HOST}:${DEV_PORT}`;

/** Prevents local OAuth cookies from crossing between the localhost and IPv4 loopback sites. */
export function canonicalDevServerLocation(
  hostHeader: string | undefined,
  requestTarget: string | undefined,
): string | undefined {
  const host = hostHeader?.toLowerCase();
  if (host !== "localhost" && host !== `localhost:${DEV_PORT}`) return undefined;

  let requestUrl: URL;
  try {
    requestUrl = new URL(requestTarget ?? "/", "http://localhost");
  } catch {
    requestUrl = new URL("/", "http://localhost");
  }
  const location = new URL(DEV_ORIGIN);
  location.pathname = requestUrl.pathname;
  location.search = requestUrl.search;
  return location.href;
}

function canonicalLoopbackOrigin(): Plugin {
  return {
    name: "rhizome-canonical-loopback-origin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const location = canonicalDevServerLocation(request.headers.host, request.url);
        if (!location) {
          next();
          return;
        }
        response.statusCode = 307;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Location", location);
        response.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [canonicalLoopbackOrigin(), react(), tailwindcss()],
  // One .env, at the repo root, as the README describes. Vite otherwise resolves it relative
  // to this package and silently leaves VITE_* unset — which surfaces as the client calling
  // its own origin and the dev server answering with index.html at 200.
  envDir: "../..",
  // Keep the development origin deterministic. On macOS, Vite's implicit `localhost` binding can
  // resolve to IPv6-only `::1`; an OAuth flow started from 127.0.0.1 then returns to an origin the
  // host is not listening on.
  server: { host: DEV_HOST, port: DEV_PORT, strictPort: true },
});
