import { operationDocumentSchema } from "@rhizome/store-contract";
import { UUIDV7_PATTERN } from "@rnet/types/patterns";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { MediaElementKindEnum, type MediaElementKind } from "../db/models/media-element.ts";
import { notFound } from "../errors.ts";
import { serializeOperation } from "../serializers/operation-serializer.ts";
import { OperationsService } from "../services/operation-service.ts";
import { ProblemSchema, RecordIdParamsSchema, binaryResponse, jsonSchema } from "./contracts.ts";
import { blobResponse, mediaElementContentType } from "./http.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const OperationDocumentSchema = jsonSchema(operationDocumentSchema);

const OperationElementParamsSchema = jsonSchema({
  type: "object",
  required: ["id", "element_id"],
  properties: {
    id: { type: "string", pattern: UUIDV7_PATTERN },
    element_id: { type: "string", pattern: UUIDV7_PATTERN },
  },
  additionalProperties: false,
});

interface PreviewElementManifest {
  uri: string;
  content_hash: string;
  kind: MediaElementKind;
  mime: string;
}

export function createOperationRoutes(db: Database, blobs: BlobStore) {
  const router = createRhizomeRouter();

  router.get(
    "/:id",
    {
      operationId: "getOperation",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: OperationDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const operationsService = new OperationsService({ db, actor: context.get("actor") });
      const authorized = await operationsService.getOperation(context.req.valid("param").id);
      return context.json(
        serializeOperation(authorized.operation, {
          exposeOwnerOnlyResult: authorized.exposeOwnerOnlyResult,
        }),
      );
    },
  );

  router.get(
    "/:id/elements/:element_id/bytes",
    {
      operationId: "getImportPreviewElementBytes",
      auth: "user",
      request: { param: OperationElementParamsSchema },
      responses: {
        200: binaryResponse("*/*"),
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const parameters = context.req.valid("param");
      const service = new OperationsService({ db, actor: context.get("actor") });
      const authorized = await service.getOperation(parameters.id);
      if (!authorized.exposeOwnerOnlyResult) throw notFound("Element preview");
      const manifest = previewElementManifest(
        authorized.operation.result,
        `rnet://element/${parameters.element_id}`,
      );
      const blob = await blobs.get("elements", manifest.content_hash);
      return blobResponse(context, blob, mediaElementContentType(manifest.kind, manifest.mime));
    },
  );

  return router;
}

function previewElementManifest(result: unknown, uri: string): PreviewElementManifest {
  if (!result || typeof result !== "object") throw notFound("Element preview");
  const elements = (result as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) throw notFound("Element preview");
  const manifest = elements.find(
    (value): value is PreviewElementManifest =>
      Boolean(value) &&
      typeof value === "object" &&
      (value as { uri?: unknown }).uri === uri &&
      typeof (value as { content_hash?: unknown }).content_hash === "string" &&
      MediaElementKindEnum.some((kind) => kind === (value as { kind?: unknown }).kind) &&
      typeof (value as { mime?: unknown }).mime === "string",
  );
  if (!manifest) throw notFound("Element preview");
  return manifest;
}
