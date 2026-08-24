import { createApp, type AppDependencies } from "../apps/server/src/app.ts";
import openapiTS, { astToString } from "openapi-typescript";
import { format, resolveConfig } from "prettier";
import ts from "typescript";

const config: AppDependencies["config"] = {
  port: 3000,
  databaseUrl: "postgres://openapi.invalid/rhizome",
  authMode: "dev",
  baseUrl: "http://localhost:3000",
  allowedOrigins: [],
  maxRequestBodySize: 52_428_800,
  blob: {
    driver: "r2",
    endpoint: "https://openapi.invalid",
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

const { openApiDocument } = createApp({
  config,
  db: {} as AppDependencies["db"],
  blobs: {} as AppDependencies["blobs"],
});

const openApiSource = JSON.stringify(openApiDocument);
const prettierConfig =
  (await resolveConfig(new URL("../.prettierrc.json", import.meta.url).pathname)) ?? {};
const openApiContents = await format(openApiSource, { ...prettierConfig, parser: "json" });
const types = await openapiTS(JSON.parse(openApiSource) as Parameters<typeof openapiTS>[0], {
  transform(schema) {
    if (schema.format === "binary") return ts.factory.createTypeReferenceNode("Blob");
    return undefined;
  },
});
const typeContents = await format(astToString(types), { ...prettierConfig, parser: "typescript" });
const outputs = [
  [new URL("../packages/client/openapi.json", import.meta.url), openApiContents],
  [new URL("../packages/client/src/generated/openapi.ts", import.meta.url), typeContents],
] as const;

if (process.argv.includes("--check")) {
  const stale = [];
  for (const [url, contents] of outputs) {
    if (!(await Bun.file(url).exists()) || (await Bun.file(url).text()) !== contents) {
      stale.push(url.pathname);
    }
  }
  if (stale.length) {
    throw new Error(`Generated OpenAPI artifacts are stale:\n${stale.join("\n")}`);
  }
} else {
  await Promise.all(outputs.map(([url, contents]) => Bun.write(url, contents)));
}
