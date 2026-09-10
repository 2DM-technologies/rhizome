import { createApp, type AppDependencies } from "../apps/server/src/app.ts";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import { format, resolveConfig } from "prettier";
import ts from "typescript";

import {
  PUSH_TASK_LEVELS,
  type STORE_SCHEMA_COMPONENTS,
} from "../packages/store-contract/src/index.ts";
import { installedPushTasks } from "../apps/server/src/push/installed-tasks.ts";

const RNET_COMPONENT_TYPES = {
  Grant: "RnetGrant",
  IngestRecord: "RnetIngestRecord",
  MediaElement: "RnetMediaElement",
  MediaObject: "RnetMediaObject",
  OriginArtifact: "RnetOriginArtifact",
  TrackProperties: "RnetTrackProperties",
  TweetProperties: "RnetTweetProperties",
  TransactionProperties: "RnetTransactionProperties",
  Vibe: "RnetVibe",
} as const;

const STORE_COMPONENT_TYPES = {
  PushVibeRequest: "StorePushVibeRequest",
  PushOperationResult: "StorePushOperationResult",
  PushTaskManifest: "StorePushTaskManifest",
  PushTaskManifestsResponse: "StorePushTaskManifestsResponse",

  Problem: "StoreProblemDocument",
  Operation: "StoreOperationDocument",
  SourceCredential: "StoreSourceCredentialDocument",
  SourceConnectionAttempt: "StoreSourceConnectionAttemptDocument",
  StartSourceConnectionRequest: "StoreStartSourceConnectionRequest",
  StartSourceConnectionResponse: "StoreStartSourceConnectionResponse",
  SourceSkillManifestsResponse: "StoreSourceSkillManifestsResponse",
  SourceActionRequired: "StoreSourceActionRequired",
  ReviewImportContinuationRequest: "StoreReviewImportContinuationRequest",
  IngestionSource: "StoreIngestionSourceDocument",
  CreateIngestionSourceRequest: "StoreCreateIngestionSourceRequest",
  CreateImportPreviewRequest: "StoreCreateImportPreviewRequest",
  CreatePendingVibeImportRequest: "StoreCreatePendingVibeImportRequest",
  ConfirmPendingVibeImportRequest: "StoreConfirmPendingVibeImportRequest",
  PullVibeRequest: "StorePullVibeRequest",
  CreateVibeRequest: "StoreCreateVibeRequest",
  UpdateVibeRequest: "StoreUpdateVibeRequest",
  MediaObjectRefsRequest: "StoreMediaObjectRefsRequest",
  CreateMediaObjectsRequest: "StoreCreateMediaObjectsRequest",
  SetMediaObjectUserRequest: "StoreSetMediaObjectUserRequest",
  SetMediaObjectInferredRequest: "StoreSetMediaObjectInferredRequest",
  VibesResponse: "StoreVibesResponse",
  MediaObjectsResponse: "StoreMediaObjectsResponse",
} as const satisfies Record<keyof typeof STORE_SCHEMA_COMPONENTS, string>;

const KNOWN_COMPONENT_TYPES: Readonly<Record<string, string>> = {
  ...RNET_COMPONENT_TYPES,
  ...STORE_COMPONENT_TYPES,
};

const TYPE_IMPORTS = `
import type {
  Grant as RnetGrant,
  IngestRecord as RnetIngestRecord,
  MediaElement as RnetMediaElement,
  MediaObject as RnetMediaObject,
  OriginArtifact as RnetOriginArtifact,
  TrackProperties as RnetTrackProperties,
  TweetProperties as RnetTweetProperties,
  TransactionProperties as RnetTransactionProperties,
  Vibe as RnetVibe,
} from "@rnet/types";
import type {
  PushVibeRequest as StorePushVibeRequest,
  PushOperationResult as StorePushOperationResult,
  PushTaskManifest as StorePushTaskManifest,
  PushTaskManifestsResponse as StorePushTaskManifestsResponse,
  ProblemDocument as StoreProblemDocument,
  OperationDocument as StoreOperationDocument,
  SourceCredentialDocument as StoreSourceCredentialDocument,
  SourceConnectionAttemptDocument as StoreSourceConnectionAttemptDocument,
  StartSourceConnectionRequest as StoreStartSourceConnectionRequest,
  StartSourceConnectionResponse as StoreStartSourceConnectionResponse,
  SourceSkillManifestsResponse as StoreSourceSkillManifestsResponse,
  SourceActionRequired as StoreSourceActionRequired,
  ReviewImportContinuationRequest as StoreReviewImportContinuationRequest,
  IngestionSourceDocument as StoreIngestionSourceDocument,
  CreateIngestionSourceRequest as StoreCreateIngestionSourceRequest,
  CreateImportPreviewRequest as StoreCreateImportPreviewRequest,
  CreatePendingVibeImportRequest as StoreCreatePendingVibeImportRequest,
  ConfirmPendingVibeImportRequest as StoreConfirmPendingVibeImportRequest,
  PullVibeRequest as StorePullVibeRequest,
  CreateVibeRequest as StoreCreateVibeRequest,
  UpdateVibeRequest as StoreUpdateVibeRequest,
  MediaObjectRefsRequest as StoreMediaObjectRefsRequest,
  CreateMediaObjectsRequest as StoreCreateMediaObjectsRequest,
  SetMediaObjectUserRequest as StoreSetMediaObjectUserRequest,
  SetMediaObjectInferredRequest as StoreSetMediaObjectInferredRequest,
  VibesResponse as StoreVibesResponse,
  MediaObjectsResponse as StoreMediaObjectsResponse,
} from "@rhizome/store-contract";
`;

const config: AppDependencies["config"] = {
  port: 3000,
  databaseUrl: "postgres://openapi.invalid/rhizome",
  authMode: "dev",
  baseUrl: "http://localhost:3000",
  allowedOrigins: [],
  maxRequestBodySize: 52_428_800,
  sourceCredentials: {
    keyProvider: {
      driver: "local",
      keyring: {
        activeKeyId: "openapi",
        keys: new Map([["openapi", new Uint8Array(32)]]),
      },
    },
    sources: { simplefin: { allowedHosts: ["bridge.simplefin.test"] } },
  },
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
  providerLeasePool: {} as AppDependencies["providerLeasePool"],
});

const emittedComponentNames = Object.keys(openApiDocument.components.schemas);
const unaliasedComponentNames = emittedComponentNames.filter(
  (name) => KNOWN_COMPONENT_TYPES[name] === undefined,
);
const missingComponentNames = Object.keys(KNOWN_COMPONENT_TYPES).filter(
  (name) => !emittedComponentNames.includes(name),
);
if (unaliasedComponentNames.length > 0 || missingComponentNames.length > 0) {
  throw new Error(
    [
      unaliasedComponentNames.length > 0
        ? `OpenAPI components missing generated type aliases: ${unaliasedComponentNames.join(", ")}`
        : undefined,
      missingComponentNames.length > 0
        ? `Known generated type aliases missing OpenAPI components: ${missingComponentNames.join(", ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

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

const types = await openapiTS(JSON.parse(JSON.stringify(openApiDocument)) as OpenAPI3, {
  inject: TYPE_IMPORTS,
  transform(schema, { path }) {
    const componentName = path?.match(/^#\/components\/schemas\/([^/]+)$/)?.[1];
    const aliasedType = componentName && KNOWN_COMPONENT_TYPES[componentName];
    if (aliasedType) return ts.factory.createTypeReferenceNode(aliasedType);
    if (schema["x-rhizome-typescript-type"] === "FormData") {
      return ts.factory.createTypeReferenceNode("FormData");
    }
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
const pushTasksOutput = new URL("../apps/host/src/api/generated/push-tasks.ts", import.meta.url);
const pushTasks = Object.fromEntries(
  PUSH_TASK_LEVELS.map((level) => [
    level,
    Object.fromEntries(
      installedPushTasks
        .manifests()
        .filter((task) => task.level === level)
        .map((task) => [task.name, task]),
    ),
  ]),
);
const pushTasksContents = await format(
  `// Generated by scripts/generate-host-openapi.ts. Do not edit.\n\nexport const PUSH_TASKS = ${JSON.stringify(pushTasks, null, 2)} as const;\n`,
  { ...prettierConfig, parser: "typescript" },
);

if (process.argv.includes("--check")) {
  const stale = [];
  if (!(await Bun.file(output).exists()) || (await Bun.file(output).text()) !== contents)
    stale.push(output.pathname);
  if (
    !(await Bun.file(pushTasksOutput).exists()) ||
    (await Bun.file(pushTasksOutput).text()) !== pushTasksContents
  )
    stale.push(pushTasksOutput.pathname);
  if (stale.length > 0) throw new Error(`Generated host files are stale: ${stale.join(", ")}`);
} else {
  await Bun.write(output, contents);
  await Bun.write(pushTasksOutput, pushTasksContents);
}
