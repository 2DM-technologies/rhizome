import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import S3rver from "s3rver";

import { R2BlobStore } from "../src/blobs/r2.ts";

const key = `sha256:${"a".repeat(64)}`;
const payload = new TextEncoder().encode("rhizome blob contract");
let scratch = "";
let s3: S3rver;
let endpoint = "";

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "rhizome-blob-contract-"));
  s3 = new S3rver({
    address: "127.0.0.1",
    port: 0,
    silent: true,
    directory: join(scratch, "s3"),
    configureBuckets: ["elements", "origins", "bundles", "assets"].map((name) => ({
      name,
      configs: [],
    })),
  });
  const address = await s3.run();
  endpoint = `http://${address.address}:${address.port}`;
});

afterAll(async () => {
  await s3.close();
  await rm(scratch, { recursive: true, force: true });
});

describe("BlobStore contract", () => {
  for (const stage of ["headers", "body"] as const) {
    test(`aborting a blob read closes a stalled ${stage} request`, async () => {
      let received!: () => void;
      const requestReceived = new Promise<void>((resolve) => {
        received = resolve;
      });
      const server = createServer((_request, response) => {
        if (stage === "body") {
          response.writeHead(200, { "Content-Length": "1024", "Content-Type": "image/png" });
          response.write("x");
        }
        received();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const store = new R2BlobStore({
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        accessKeyId: "S3RVER",
        secretAccessKey: "S3RVER",
        forcePathStyle: true,
        buckets: { elements: "elements", origins: "origins", bundles: "bundles", assets: "assets" },
      });
      const controller = new AbortController();
      const reading = store.get("elements", key, controller.signal);
      try {
        await requestReceived;
        // Give the partial body time to reach the SDK's stream reader.
        if (stage === "body") await Bun.sleep(30);
        controller.abort();
        await expect(
          Promise.race([
            reading,
            Bun.sleep(500).then(() => {
              throw new Error("Blob read ignored cancellation");
            }),
          ]),
        ).rejects.toMatchObject({ name: "AbortError" });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await reading.catch(() => {});
      }
    });
  }

  test("R2/S3 storage is content-addressed and idempotent", async () => {
    const store = new R2BlobStore({
      endpoint,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
      buckets: { elements: "elements", origins: "origins", bundles: "bundles", assets: "assets" },
    });
    await store.put("origins", key, payload, "text/plain");
    await store.put("origins", key, payload, "text/plain");
    const stored = await store.get("origins", key);
    expect(stored?.bytes).toEqual(payload);
    expect(stored?.contentType).toBe("text/plain");
    expect((await store.get("origins", key, new AbortController().signal))?.bytes).toEqual(payload);
    await expect(store.get("origins", key, AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
    const signed = await store.signedUrl("origins", key, 60);
    expect(new URL(signed).searchParams.has("X-Amz-Signature")).toBe(true);
    await store.delete("origins", key);
    expect(await store.get("origins", key)).toBeNull();
  });
});
