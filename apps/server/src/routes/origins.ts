import { RNET_SCHEMA_VERSION, validateSchema, type OriginArtifact } from "@rnet/types";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";

import type { BlobStore } from "../blobs/index.ts";
import { contentHash } from "../blobs/content.ts";
import type { Database } from "../db/index.ts";
import {
  OriginArtifactService,
  type DbOriginArtifact,
} from "../services/origin-artifact-service.ts";
import { schemaProblem } from "../services/problems.ts";
import { uriId } from "../services/uris.ts";
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
      },
    }),
    async (context) => {
      const actor = context.get("actor");
      const originArtifactService = new OriginArtifactService({ db, actor });
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const mime = requestMime(context.req.header("Content-Type"));
      const contentHashValue = await contentHash(bytes);
      const originArtifactUuid = uuidv7();
      const label = context.req.header("X-Rnet-Label");
      const candidateOriginArtifact = {
        rnet_schema: RNET_SCHEMA_VERSION,
        uri: `rnet://origin/${originArtifactUuid}`,
        owner: `rnet://id/${actor.uuid}`,
        content_hash: contentHashValue,
        mime,
        bytes: await blobs.signedUrl("origins", contentHashValue),
        byte_size: bytes.byteLength,
        ...(label ? { label } : {}),
        uploaded_at: new Date().toISOString(),
      };
      const validation = validateSchema("origin-artifact", candidateOriginArtifact);
      if (!validation.ok) throw schemaProblem(validation.issues);
      const originArtifactDocument = {
        ...validation.value,
        byte_size: candidateOriginArtifact.byte_size,
        uploaded_at: candidateOriginArtifact.uploaded_at,
      };
      await blobs.put(
        "origins",
        originArtifactDocument.content_hash,
        bytes,
        originArtifactDocument.mime,
      );
      const originArtifact = await originArtifactService.createOriginArtifact({
        uuid: uriId(originArtifactDocument.uri),
        ownerUuid: uriId(originArtifactDocument.owner),
        contentHash: originArtifactDocument.content_hash,
        mime: originArtifactDocument.mime,
        byteSize: originArtifactDocument.byte_size,
        label: originArtifactDocument.label,
        rnetSchema: originArtifactDocument.rnet_schema,
        uploadedAt: new Date(originArtifactDocument.uploaded_at),
      });
      const document = await toOriginArtifactDocument(originArtifact, blobs);
      return context.json(document, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({
      operationId: "getOriginArtifact",
      request: { param: RecordIdParamsSchema },
      responses: { 200: OriginArtifactDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const originArtifactService = new OriginArtifactService({ db, actor: context.get("actor") });
      const originArtifact = await originArtifactService.getOriginArtifact(
        context.req.valid("param").id,
      );
      const document = await toOriginArtifactDocument(originArtifact, blobs);
      return context.json(document);
    },
  );
  router.get(
    "/:id/bytes",
    rnetRoute({
      operationId: "getOriginArtifactBytes",
      request: { param: RecordIdParamsSchema },
      responses: { 200: binaryResponse("*/*"), 422: ProblemSchema },
    }),
    async (context) => {
      const originArtifactService = new OriginArtifactService({ db, actor: context.get("actor") });
      const originArtifact = await originArtifactService.getOriginArtifact(
        context.req.valid("param").id,
      );
      const blob = await blobs.get("origins", originArtifact.contentHash);
      return blobResponse(context, blob);
    },
  );

  return router;
}

async function toOriginArtifactDocument(
  originArtifact: DbOriginArtifact,
  blobs: BlobStore,
): Promise<OriginArtifact> {
  return {
    rnet_schema: RNET_SCHEMA_VERSION,
    uri: `rnet://origin/${originArtifact.uuid}`,
    owner: `rnet://id/${originArtifact.ownerUuid}`,
    content_hash: originArtifact.contentHash,
    mime: originArtifact.mime,
    bytes: await blobs.signedUrl("origins", originArtifact.contentHash),
    byte_size: originArtifact.byteSize,
    ...(originArtifact.label ? { label: originArtifact.label } : {}),
    uploaded_at: originArtifact.uploadedAt.toISOString(),
  };
}
