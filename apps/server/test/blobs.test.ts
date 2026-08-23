import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import S3rver from "s3rver";

import { FileSystemBlobStore } from "../src/blobs/fs.ts";
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
  test("filesystem backend is content-addressed and idempotent", async () => {
    const store = new FileSystemBlobStore(join(scratch, "fs"), "http://rhizome.test");
    await store.put("elements", key, payload, "text/plain");
    await store.put("elements", key, payload, "text/plain");
    expect((await store.get("elements", key))?.bytes).toEqual(payload);
    expect(await store.signedUrl("elements", key)).toContain(encodeURIComponent(key));
    await store.delete("elements", key);
    expect(await store.get("elements", key)).toBeNull();
  });

  test("R2 backend obeys the same contract through the S3 API", async () => {
    const store = new R2BlobStore({
      endpoint,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
      buckets: { elements: "elements", origins: "origins", bundles: "bundles", assets: "assets" },
    });
    await store.put("origins", key, payload, "text/plain");
    const stored = await store.get("origins", key);
    expect(stored?.bytes).toEqual(payload);
    expect(stored?.contentType).toBe("text/plain");
    const signed = await store.signedUrl("origins", key, 60);
    expect(new URL(signed).searchParams.has("X-Amz-Signature")).toBe(true);
    await store.delete("origins", key);
    expect(await store.get("origins", key)).toBeNull();
  });
});
