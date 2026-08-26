import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import S3rver from "s3rver";

import { BLOB_NAMESPACES } from "../src/config.ts";

/**
 * A local stand-in for R2, so `bun run dev` needs nothing but Bun and Postgres.
 *
 * The store requires object storage at startup — element and origin payloads live there — and
 * the same emulator already backs the blob contract tests, so local development and CI agree
 * on the S3 surface being targeted. Point `.env` at a real bucket instead and this is unused.
 */
const directory = resolve(import.meta.dir, "../../../.rhizome/s3");
await mkdir(directory, { recursive: true });

const port = Number(process.env.RHIZOME_DEV_S3_PORT ?? 4568);
const server = new S3rver({
  address: "127.0.0.1",
  port,
  silent: true,
  directory,
  configureBuckets: BLOB_NAMESPACES.map((name) => ({ name, configs: [] })),
});

const address = await server.run();
console.log(`Object store emulator on http://${address.address}:${address.port}`);
console.log(`Buckets: ${BLOB_NAMESPACES.join(", ")} · data in .rhizome/s3`);
