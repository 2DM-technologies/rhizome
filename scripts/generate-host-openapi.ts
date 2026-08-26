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

const prettierConfig =
  (await resolveConfig(new URL("../.prettierrc.json", import.meta.url).pathname)) ?? {};
/**
 * A schema that says `{"type": "object"}` and nothing else — any object at all.
 *
 * `user.properties`, `source.properties`, and each inferred entry's `properties` are all
 * declared this way. Left alone, openapi-typescript renders them as `Record<string, never>`:
 * a type permitting no keys, which is the exact opposite of what the schema says, and which
 * forces a cast at every read and every write. Mapping them here fixes both directions once,
 * without widening a protocol schema to suit a code generator.
 */
function isFreeFormObject(schema: Record<string, unknown>): boolean {
  return (
    schema.type === "object" &&
    schema.properties === undefined &&
    schema.additionalProperties === undefined &&
    schema.patternProperties === undefined &&
    schema.allOf === undefined &&
    schema.anyOf === undefined &&
    schema.oneOf === undefined &&
    schema.$ref === undefined
  );
}

const types = await openapiTS(openApiDocument, {
  transform(schema) {
    if (schema.format === "binary") return ts.factory.createTypeReferenceNode("Blob");
    if (isFreeFormObject(schema as Record<string, unknown>)) {
      return ts.factory.createTypeReferenceNode("Record", [
        ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
      ]);
    }
    return undefined;
  },
});
const contents = await format(astToString(types), {
  ...prettierConfig,
  parser: "typescript",
});
const output = new URL("../apps/host/src/api/generated/openapi.ts", import.meta.url);

if (process.argv.includes("--check")) {
  if (!(await Bun.file(output).exists()) || (await Bun.file(output).text()) !== contents) {
    throw new Error(`Generated host API types are stale: ${output.pathname}`);
  }
} else {
  await Bun.write(output, contents);
}
