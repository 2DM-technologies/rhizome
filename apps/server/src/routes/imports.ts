import {
  confirmPendingVibeImportRequestSchema,
  createPendingVibeImportRequestSchema,
  operationDocumentSchema,
} from "@rhizome/store-contract";
import { UUIDV7_PATTERN } from "@rnet/types/patterns";

import type { CredentialedSourceCatalog } from "../../../ingest/connected-sources/types.ts";
import type { FileSourceCatalog } from "../../../ingest/file-sources/types.ts";
import type { PublicRemoteSourceCatalog } from "../../../ingest/public-sources/types.ts";
import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { serializeOperation } from "../serializers/operation-serializer.ts";
import { serializeVibe } from "../serializers/vibe-serializer.ts";
import { ImportService } from "../services/import-service.ts";
import type { SourceCredentialCrypto } from "../services/source-credential-crypto.ts";
import { ProblemSchema, jsonSchema, rnetDocument } from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const CreatePendingVibeImportRequestSchema = jsonSchema(createPendingVibeImportRequestSchema);
const ConfirmPendingVibeImportRequestSchema = jsonSchema(confirmPendingVibeImportRequestSchema);
const OperationDocumentSchema = jsonSchema(operationDocumentSchema);
const PendingImportParamsSchema = jsonSchema({
  type: "object",
  required: ["operation_id"],
  properties: { operation_id: { type: "string", pattern: UUIDV7_PATTERN } },
  additionalProperties: false,
});
const VibeDocumentSchema = rnetDocument("vibe");

export function createPendingImportRoutes(
  db: Database,
  blobs: BlobStore,
  connectedSources: {
    baseUrl: string;
    credentialedSources: CredentialedSourceCatalog;
    credentialCrypto: SourceCredentialCrypto;
    fileSources: FileSourceCatalog;
    publicRemoteSources: PublicRemoteSourceCatalog;
  },
) {
  const router = createRhizomeRouter();

  router.post(
    "/",
    {
      operationId: "createPendingVibeImportPreview",
      auth: "user",
      request: { json: CreatePendingVibeImportRequestSchema },
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
      const operation = await service.startPendingVibePreview(context.req.valid("json"));
      return context.json(serializeOperation(operation, { exposeOwnerOnlyResult: true }), 202);
    },
  );

  router.post(
    "/:operation_id/confirm",
    {
      operationId: "confirmPendingVibeImportPreview",
      auth: "user",
      request: {
        param: PendingImportParamsSchema,
        json: ConfirmPendingVibeImportRequestSchema,
      },
      responses: {
        200: VibeDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const service = new ImportService({
        db,
        blobs,
        actor: context.get("actor"),
        ...connectedSources,
      });
      const vibe = await service.confirm(
        undefined,
        context.req.valid("param").operation_id,
        context.req.valid("json"),
      );
      return context.json(serializeVibe(vibe));
    },
  );

  return router;
}
