import { originArtifactSchema, type OriginArtifact } from "@rnet/types";
import { Hono } from "hono";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { serializeOriginArtifact } from "../serializers/origin-artifact-serializer.ts";
import { OriginArtifactsService } from "../services/origin-artifact-service.ts";
import {
  BinaryRequest,
  ProblemSchema,
  RecordIdParamsSchema,
  binaryResponse,
  jsonObjectSchema,
  jsonSchemaValue,
  rnetDocument,
  rnetRoute,
  transformSchema,
} from "./contracts.ts";
import { blobResponse, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const OriginArtifactDocumentSchema = rnetDocument("origin-artifact");
const OriginArtifactUploadHeadersSchema = transformSchema(
  jsonObjectSchema(
    {
      "content-type": jsonSchemaValue<OriginArtifact["mime"]>(originArtifactSchema.properties.mime),
      "x-rnet-label": jsonSchemaValue<OriginArtifact["label"]>(
        originArtifactSchema.properties.label,
      ),
    },
    ["content-type"] as const,
  ),
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const headers = value as Record<string, unknown>;
    return {
      ...headers,
      "content-type": requestMime(
        typeof headers["content-type"] === "string" ? headers["content-type"] : undefined,
      ),
    };
  },
);

export function createOriginRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
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
    }),
    async (context) => {
      const originArtifactsService = new OriginArtifactsService({
        db,
        actor: context.get("actor"),
        blobs,
      });
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const headers = context.req.valid("header");
      const originArtifactRecord = await originArtifactsService.createOriginArtifact({
        bytes,
        mime: headers["content-type"],
        ...(headers["x-rnet-label"] ? { label: headers["x-rnet-label"] } : {}),
      });
      const originArtifact = await serializeOriginArtifact(originArtifactRecord, blobs);
      return context.json(originArtifact, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({
      operationId: "getOriginArtifact",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: OriginArtifactDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    }),
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
    rnetRoute({
      operationId: "getOriginArtifactBytes",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: binaryResponse("*/*"),
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    }),
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
