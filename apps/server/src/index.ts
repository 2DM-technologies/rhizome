import { createApp } from "./app.ts";
import { createBlobStore } from "./blobs/index.ts";
import { loadConfig } from "./config.ts";
import { createDatabase } from "./db/index.ts";

const config = loadConfig();
const { db } = createDatabase(config.databaseUrl);
const { app } = createApp({ config, db, blobs: createBlobStore(config) });

console.log(`Rhizome listening on ${config.baseUrl}`);

export default {
  port: config.port,
  maxRequestBodySize: config.maxRequestBodySize,
  fetch: app.fetch,
};
