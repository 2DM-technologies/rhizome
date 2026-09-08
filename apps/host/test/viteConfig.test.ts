import { describe, expect, test } from "bun:test";

import config from "../vite.config.ts";

describe("host development server", () => {
  test("binds the IPv4 loopback origin used by local OAuth returns", () => {
    expect(config).toMatchObject({
      server: { host: "127.0.0.1", port: 5173 },
    });
  });
});
