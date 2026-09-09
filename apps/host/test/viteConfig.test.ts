import { describe, expect, test } from "bun:test";

import config, { canonicalDevServerLocation } from "../vite.config.ts";

describe("host development server", () => {
  test("binds the IPv4 loopback origin used by local OAuth returns", () => {
    expect(config).toMatchObject({
      server: { host: "127.0.0.1", port: 5173, strictPort: true },
    });
  });

  test("redirects localhost documents to the canonical OAuth origin", () => {
    expect(canonicalDevServerLocation("localhost:5173", "/imports?mode=maximized")).toBe(
      "http://127.0.0.1:5173/imports?mode=maximized",
    );
    expect(canonicalDevServerLocation("LOCALHOST:5173", "/vibes/example")).toBe(
      "http://127.0.0.1:5173/vibes/example",
    );
  });

  test("does not redirect canonical or untrusted hosts", () => {
    expect(canonicalDevServerLocation("127.0.0.1:5173", "/imports")).toBeUndefined();
    expect(canonicalDevServerLocation("localhost.example:5173", "/imports")).toBeUndefined();
    expect(canonicalDevServerLocation("localhost:5173@evil.example", "/imports")).toBeUndefined();
  });

  test("never reflects an absolute request target as an open redirect", () => {
    expect(canonicalDevServerLocation("localhost:5173", "//evil.example/path?attempt=1")).toBe(
      "http://127.0.0.1:5173/path?attempt=1",
    );
  });
});
