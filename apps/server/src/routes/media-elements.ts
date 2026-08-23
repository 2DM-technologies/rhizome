import { RNET_SCHEMA_VERSION, validateSchema, type MediaElement } from "@rnet/types";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";

import type { BlobStore } from "../blobs/index.ts";
import { contentHash } from "../blobs/content.ts";
import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import { MediaElementService, type DbMediaElement } from "../services/media-elements.ts";
import { ProblemSchema, RecordIdParamsSchema, rnetDocument, rnetRoute } from "./contracts.ts";
import { blobResponse, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const MediaElementDocumentSchema = rnetDocument("media-element");

export function createMediaElementRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({
      auth: "user",
      responses: {
        201: MediaElementDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    }),
    async (context) => {
      const actor = context.get("actor");
      if (actor.kind !== "user") throw new Error("User middleware did not narrow the actor");
      const mediaElementService = new MediaElementService({ db, actor });
      const ownerUuid = actor.uuid;
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const mime = requestMime(context.req.header("Content-Type"));
      const kind = context.req.header("X-Rnet-Kind");
      const contentHashValue = await contentHash(bytes);
      const mediaElementUuid = uuidv7();
      const candidateMediaElement = {
        rnet_schema: RNET_SCHEMA_VERSION,
        uri: `rnet://element/${mediaElementUuid}`,
        owner: `rnet://id/${ownerUuid}`,
        content_hash: contentHashValue,
        kind,
        mime,
        bytes: await blobs.signedUrl("elements", contentHashValue),
        byte_size: bytes.byteLength,
        created_at: new Date().toISOString(),
      };
      const validation = validateSchema("media-element", candidateMediaElement);
      if (!validation.ok) {
        throw new Problem(
          422,
          "schema_violation",
          "Schema violation",
          "The media element metadata does not conform",
          { errors: validation.issues },
        );
      }
      const mediaElement = validation.value;
      await blobs.put("elements", contentHashValue, bytes, mime);
      await mediaElementService.createMediaElement({
        uuid: mediaElementUuid,
        ownerUuid,
        contentHash: contentHashValue,
        kind: mediaElement.kind,
        mime,
        byteSize: bytes.byteLength,
        createdBy: actor.subject,
      });
      return context.json(mediaElement, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaElementDocumentSchema, 422: ProblemSchema },
    }),
    async (context) => {
      const mediaElementService = new MediaElementService({ db, actor: context.get("actor") });
      const mediaElement = await mediaElementService.getMediaElement(context.req.valid("param").id);
      const document = await mediaElementDocument(mediaElement, blobs);
      return context.json(document);
    },
  );
  router.get(
    "/:id/bytes",
    rnetRoute({
      request: { param: RecordIdParamsSchema },
      responses: { 422: ProblemSchema },
    }),
    async (context) => {
      const mediaElementService = new MediaElementService({ db, actor: context.get("actor") });
      const mediaElement = await mediaElementService.getMediaElement(context.req.valid("param").id);
      const blob = await blobs.get("elements", mediaElement.contentHash);
      return blobResponse(context, blob);
    },
  );

  return router;
}

async function mediaElementDocument(
  mediaElement: DbMediaElement,
  blobs: BlobStore,
): Promise<MediaElement> {
  return {
    rnet_schema: RNET_SCHEMA_VERSION,
    uri: `rnet://element/${mediaElement.uuid}`,
    owner: `rnet://id/${mediaElement.ownerUuid}`,
    content_hash: mediaElement.contentHash,
    kind: mediaElement.kind as MediaElement["kind"],
    mime: mediaElement.mime,
    bytes: await blobs.signedUrl("elements", mediaElement.contentHash),
    byte_size: mediaElement.byteSize,
    created_at: mediaElement.createdAt.toISOString(),
  };
}
