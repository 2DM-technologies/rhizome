import { createApp } from "./app.ts";
import { createBlobStore } from "./blobs/index.ts";
import { loadConfig } from "./config.ts";
import { createDatabase, createProviderLeasePool } from "./db/index.ts";
import { sweepInterruptedOperations } from "./services/operation-sweep.ts";

const config = loadConfig();
const { db } = createDatabase(config.databaseUrl);
await sweepInterruptedOperations(db);
const providerLeasePool = createProviderLeasePool(config.databaseUrl);
const { app } = createApp({
  config,
  db,
  blobs: createBlobStore(config),
  providerLeasePool,
});

console.log(`Rhizome listening on ${config.baseUrl}`);

export default {
  port: config.port,
  maxRequestBodySize: config.maxRequestBodySize,
  fetch: app.fetch,
};
