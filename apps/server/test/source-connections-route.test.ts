import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";
import type { BlobStore } from "../src/blobs/index.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database, ProviderLeasePool } from "../src/db/index.ts";
import { createCredentialKeyring } from "../src/services/source-credential-crypto.ts";

const config: ServerConfig = {
  port: 3000,
  databaseUrl: "postgres://oauth-route.invalid/rhizome",
  authMode: "dev",
  baseUrl: "http://rhizome.test",
  allowedOrigins: ["http://host.test"],
  maxRequestBodySize: 52_428_800,
  sourceCredentials: {
    keyProvider: {
      driver: "local",
      keyring: createCredentialKeyring("test", { test: new Uint8Array(32) }),
    },
    sources: { simplefin: { allowedHosts: ["bridge.simplefin.test"] } },
  },
  blob: {
    driver: "r2",
    endpoint: "https://oauth-route.invalid",
    accessKeyId: "unused",
    secretAccessKey: "unused",
    forcePathStyle: false,
    buckets: {
      elements: "elements",
      origins: "origins",
      bundles: "bundles",
      assets: "assets",
    },
  },
};
const providerLeasePool = {} as ProviderLeasePool;

const created = createApp({
  config,
  db: {} as Database,
  blobs: {} as BlobStore,
  providerLeasePool,
});

describe("generic OAuth route contract", () => {
  test("publishes callback query parameters and the required redirect and cookie headers", () => {
    const callback = created.openApiDocument.paths["/rnet/v0/source-connections/oauth/callback"]
      ?.get as
      | {
          parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
          responses?: Record<string, { headers?: Record<string, unknown> }>;
        }
      | undefined;
    const start = created.openApiDocument.paths["/rnet/v0/source-connections/{skill_id}/oauth"]
      ?.post as
      | {
          responses?: Record<string, { headers?: Record<string, unknown> }>;
        }
      | undefined;

    expect(callback?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "state", in: "query", required: true }),
        expect.objectContaining({ name: "code", in: "query", required: false }),
        expect.objectContaining({ name: "error", in: "query", required: false }),
        expect.objectContaining({
          name: "error_description",
          in: "query",
          required: false,
        }),
      ]),
    );
    expect(callback?.responses?.["303"]?.headers).toEqual(
      expect.objectContaining({
        "Cache-Control": expect.any(Object),
        Location: expect.any(Object),
        "Referrer-Policy": expect.any(Object),
        "Set-Cookie": expect.any(Object),
      }),
    );
    expect(start?.responses?.["201"]?.headers).toEqual(
      expect.objectContaining({
        "Cache-Control": expect.any(Object),
        "Set-Cookie": expect.any(Object),
      }),
    );
  });

  test("sanitizes an invalid callback without clearing unrelated browser bindings", async () => {
    const attemptUuid = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
    const stateSentinel = "STATE-SENTINEL-THAT-MUST-NOT-LEAK-1234567890";
    const codeSentinel = "CODE-SENTINEL-THAT-MUST-NOT-LEAK";
    const callback = new URL("http://rhizome.test/rnet/v0/source-connections/oauth/callback");
    callback.searchParams.set("state", stateSentinel);
    callback.searchParams.set("code", codeSentinel);
    callback.searchParams.set("error", "access_denied");

    const response = await created.app.request(callback, {
      headers: {
        Cookie: `rhizome_oauth_${attemptUuid}=${"A".repeat(43)}`,
      },
      redirect: "manual",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const location = response.headers.get("Location")!;
    expect(location).toBe("http://host.test/imports?source_connection_error=callback_failed");
    expect(location).not.toContain(stateSentinel);
    expect(location).not.toContain(codeSentinel);
    expect(location).not.toContain("access_denied");
  });
});
