import { originArtifactSchema, type OriginArtifact } from "@rnet/types";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { serializeOriginArtifact } from "../serializers/origin-artifact-serializer.ts";
import { OriginArtifactsService } from "../services/origin-artifact-service.ts";
import { schemaProblem } from "../services/problems.ts";
import {
  BinaryRequest,
  ProblemSchema,
  RecordIdParamsSchema,
  binaryResponse,
  jsonObjectSchema,
  jsonSchemaValue,
  rnetDocument,
} from "./contracts.ts";
import { blobResponse, requestMime } from "./http.ts";
import { createRnetRouter } from "./rnet-router.ts";

const OriginArtifactDocumentSchema = rnetDocument("origin-artifact");
const OriginArtifactMimeSchema = jsonSchemaValue<OriginArtifact["mime"]>(
  originArtifactSchema.properties.mime,
);
const OriginArtifactUploadHeadersSchema = jsonObjectSchema(
  {
    "x-rnet-label": jsonSchemaValue<OriginArtifact["label"]>(originArtifactSchema.properties.label),
  },
  [] as const,
);

export function createOriginRoutes(db: Database, blobs: BlobStore) {
  const router = createRnetRouter();

  router.post(
    "/",
    {
      operationId: "createOriginArtifact",
      auth: "user",
      request: { binary: BinaryRequest, header: OriginArtifactUploadHeadersSchema },
      responses: {
        201: OriginArtifactDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        415: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const originArtifactsService = new OriginArtifactsService({
        db,
        actor: context.get("actor"),
        blobs,
      });
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const headers = context.req.valid("header");
      const mime = requestMime(context.req.header("Content-Type"));
      const mimeValidation = OriginArtifactMimeSchema.validate(mime);
      if (!mimeValidation.ok) throw schemaProblem(mimeValidation.issues, "/content-type");
      const originArtifactRecord = await originArtifactsService.createOriginArtifact({
        bytes,
        mime,
        ...(headers["x-rnet-label"] ? { label: headers["x-rnet-label"] } : {}),
      });
      const originArtifact = await serializeOriginArtifact(originArtifactRecord, blobs);
      return context.json(originArtifact, 201);
    },
  );
  router.get(
    "/:id",
    {
      operationId: "getOriginArtifact",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: OriginArtifactDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const originArtifactsService = new OriginArtifactsService({
        db,
        actor: context.get("actor"),
        blobs,
      });
      const originArtifactRecord = await originArtifactsService.getOriginArtifact(
        context.req.valid("param").id,
      );
      const originArtifact = await serializeOriginArtifact(originArtifactRecord, blobs);
      return context.json(originArtifact);
    },
  );
  router.get(
    "/:id/bytes",
    {
      operationId: "getOriginArtifactBytes",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: binaryResponse("*/*"),
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const originArtifactsService = new OriginArtifactsService({
        db,
        actor: context.get("actor"),
        blobs,
      });
      const originArtifact = await originArtifactsService.getOriginArtifact(
        context.req.valid("param").id,
      );
      const blob = await blobs.get("origins", originArtifact.contentHash);
      return blobResponse(context, blob);
    },
  );

  return router;
}
