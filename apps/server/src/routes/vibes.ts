import {
  createImportPreviewRequestSchema,
  createVibeRequestSchema,
  mediaObjectRefsRequestSchema,
  mediaObjectsResponseSchema,
  operationDocumentSchema,
  pullVibeRequestSchema,
  pushVibeRequestSchema,
  updateVibeRequestSchema,
  vibesResponseSchema,
} from "@rhizome/store-contract";
import { UUIDV7_PATTERN } from "@rnet/types/patterns";

import type { CredentialedSourceCatalog } from "../../../ingest/connected-sources/types.ts";
import type { FileSourceCatalog } from "../../../ingest/file-sources/types.ts";
import type { PublicRemoteSourceCatalog } from "../../../ingest/public-sources/types.ts";
import type { BlobStore } from "../blobs/index.ts";
import type { Database, ProviderLeasePool } from "../db/index.ts";
import { VibesService } from "../services/vibe-service.ts";
import { ImportService } from "../services/import-service.ts";
import type { SourceCredentialCrypto } from "../services/source-credential-crypto.ts";
import { serializeOperation } from "../serializers/operation-serializer.ts";
import { serializeMediaObject } from "../serializers/media-object-serializer.ts";
import { serializeVibe } from "../serializers/vibe-serializer.ts";
import type { PushService } from "../push/push-service.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonSchema,
  rnetDocument,
} from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

export const CreateVibeRequestSchema = jsonSchema(createVibeRequestSchema);
export const UpdateVibeRequestSchema = jsonSchema(updateVibeRequestSchema);
export const MediaObjectRefsRequestSchema = jsonSchema(mediaObjectRefsRequestSchema);
const CreateImportPreviewRequestSchema = jsonSchema(createImportPreviewRequestSchema);
const OperationDocumentSchema = jsonSchema(operationDocumentSchema);
const PullVibeRequestSchema = jsonSchema(pullVibeRequestSchema);
const PushVibeRequestSchema = jsonSchema(pushVibeRequestSchema);
const ImportConfirmParamsSchema = jsonSchema({
  type: "object",
  required: ["id", "operation_id"],
  properties: {
    id: { type: "string", pattern: UUIDV7_PATTERN },
    operation_id: { type: "string", pattern: UUIDV7_PATTERN },
  },
  additionalProperties: false,
});

const VibeDocumentSchema = rnetDocument("vibe");
const VibeCollectionSchema = collectionOf(VibeDocumentSchema, "vibes", vibesResponseSchema);
const MediaObjectCollectionSchema = collectionOf(
  rnetDocument("media-object"),
  "mediaObjects",
  mediaObjectsResponseSchema,
);
export function createVibeRoutes(
  db: Database,
  blobs: BlobStore,
  connectedSources: {
    baseUrl: string;
    credentialedSources: CredentialedSourceCatalog;
    credentialCrypto: SourceCredentialCrypto;
    fileSources: FileSourceCatalog;
    providerLeasePool: ProviderLeasePool;
    publicRemoteSources: PublicRemoteSourceCatalog;
  },
  pushService: PushService,
) {
  const router = createRhizomeRouter();

  router.get(
    "/",
    { operationId: "listVibes", responses: { 200: VibeCollectionSchema } },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregates = await vibesService.listVibes();
      const vibes = vibeAggregates.map(serializeVibe);
      return context.json({ vibes });
    },
  );
  router.post(
    "/",
    {
      operationId: "createVibe",
      auth: "user",
      request: { json: CreateVibeRequestSchema },
      responses: {
        201: VibeDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregate = await vibesService.createVibe(context.req.valid("json"));
      const vibe = serializeVibe(vibeAggregate);
      return context.json(vibe, 201);
    },
  );
  router.get(
    "/:id",
    {
      operationId: "getVibe",
      request: { param: RecordIdParamsSchema },
      responses: { 200: VibeDocumentSchema, 422: ProblemSchema },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregate = await vibesService.getVibe(context.req.valid("param").id);
      const vibe = serializeVibe(vibeAggregate);
      return context.json(vibe);
    },
  );
  router.patch(
    "/:id",
    {
      operationId: "updateVibe",
      auth: "user",
      request: { param: RecordIdParamsSchema, json: UpdateVibeRequestSchema },
      responses: {
        200: VibeDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const vibeAggregate = await vibesService.updateVibe(
        context.req.valid("param").id,
        context.req.valid("json"),
      );
      const vibe = serializeVibe(vibeAggregate);
      return context.json(vibe);
    },
  );
  router.delete(
    "/:id",
    {
      operationId: "deleteVibe",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: { 204: null, 401: ProblemSchema, 403: ProblemSchema, 422: ProblemSchema },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      await vibesService.deleteVibe(context.req.valid("param").id);
      return context.body(null, 204);
    },
  );
  router.get(
    "/:id/objects",
    {
      operationId: "listVibeMediaObjects",
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaObjectCollectionSchema, 422: ProblemSchema },
    },
    async (context) => {
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      const mediaObjectAggregates = await vibesService.listMediaObjects(
        context.req.valid("param").id,
      );
      const mediaObjects = mediaObjectAggregates.map(serializeMediaObject);
      return context.json({ mediaObjects });
    },
  );
  router.post(
    "/:id/objects",
    {
      operationId: "addVibeMediaObjects",
      auth: "user",
      request: { param: RecordIdParamsSchema, json: MediaObjectRefsRequestSchema },
      responses: { 204: null, 401: ProblemSchema, 403: ProblemSchema, 422: ProblemSchema },
    },
    async (context) => {
      const body = context.req.valid("json");
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      await vibesService.addMediaObjectRefs(context.req.valid("param").id, body.objects);
      return context.body(null, 204);
    },
  );
  router.delete(
    "/:id/objects",
    {
      operationId: "removeVibeMediaObjects",
      auth: "user",
      request: { param: RecordIdParamsSchema, json: MediaObjectRefsRequestSchema },
      responses: { 204: null, 401: ProblemSchema, 403: ProblemSchema, 422: ProblemSchema },
    },
    async (context) => {
      const body = context.req.valid("json");
      const vibesService = new VibesService({ db, actor: context.get("actor") });
      await vibesService.removeMediaObjectRefs(context.req.valid("param").id, body.objects);
      return context.body(null, 204);
    },
  );
  router.post(
    "/:id/imports",
    {
      operationId: "createImportPreview",
      auth: "user",
      request: { param: RecordIdParamsSchema, json: CreateImportPreviewRequestSchema },
      responses: {
        202: OperationDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
        429: ProblemSchema,
      },
    },
    async (context) => {
      const service = new ImportService({
        db,
        blobs,
        actor: context.get("actor"),
        ...connectedSources,
      });
      const operation = await service.startPreview(
        context.req.valid("param").id,
        context.req.valid("json"),
      );
      return context.json(serializeOperation(operation, { exposeOwnerOnlyResult: true }), 202);
    },
  );
  router.post(
    "/:id/imports/:operation_id/confirm",
    {
      operationId: "confirmImportPreview",
      auth: "user",
      request: { param: ImportConfirmParamsSchema },
      responses: {
        200: VibeDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const parameters = context.req.valid("param");
      const service = new ImportService({
        db,
        blobs,
        actor: context.get("actor"),
        ...connectedSources,
      });
      const vibe = await service.confirm(parameters.id, parameters.operation_id);
      return context.json(serializeVibe(vibe));
    },
  );
  router.post(
    "/:id/push",
    {
      operationId: "pushVibe",
      auth: "user_or_client",
      request: { param: RecordIdParamsSchema, json: PushVibeRequestSchema },
      responses: {
        202: OperationDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        409: ProblemSchema,
        422: ProblemSchema,
        503: ProblemSchema,
      },
    },
    async (context) => {
      const operation = await pushService.startPush(
        context.req.valid("param").id,
        context.req.valid("json"),
        context.get("actor"),
      );
      return context.json(
        serializeOperation(operation, {
          exposeOwnerOnlyResult:
            context.get("actor").subject === `id:rnet://id/${operation.ownerUuid}`,
        }),
        202,
      );
    },
  );
  router.post(
    "/:id/pull",
    {
      operationId: "pullVibe",
      auth: "user_or_client",
      request: { param: RecordIdParamsSchema, json: PullVibeRequestSchema },
      responses: {
        202: OperationDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
        429: ProblemSchema,
      },
    },
    async (context) => {
      const service = new ImportService({
        db,
        blobs,
        actor: context.get("actor"),
        ...connectedSources,
      });
      const operation = await service.startPull(
        context.req.valid("param").id,
        context.req.valid("json"),
      );
      return context.json(serializeOperation(operation, { exposeOwnerOnlyResult: false }), 202);
    },
  );

  return router;
}
