import { Hono } from "hono";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { OriginArtifactsService } from "../services/origin-artifact-service.ts";
import {
  BinaryRequest,
  ProblemSchema,
  RecordIdParamsSchema,
  binaryResponse,
  rnetDocument,
  rnetRoute,
} from "./contracts.ts";
import { blobResponse, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const OriginArtifactDocumentSchema = rnetDocument("origin-artifact");

export function createOriginRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
      operationId: "createOriginArtifact",
      auth: "user",
      request: { binary: BinaryRequest },
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
      const mime = requestMime(context.req.header("Content-Type"));
      const label = context.req.header("X-Rnet-Label");
      const originArtifact = await originArtifactsService.createOriginArtifact({
        bytes,
        mime,
        ...(label ? { label } : {}),
      });
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
      const originArtifact = await originArtifactsService.getOriginArtifactDocument(
        context.req.valid("param").id,
      );
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
