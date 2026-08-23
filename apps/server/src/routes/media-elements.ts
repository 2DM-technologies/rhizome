import { validateSchema, type MediaElement } from "@rnet/types";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import { AccessService } from "../services/access.ts";
import { MediaElementService, type DbMediaElement } from "../services/media-elements.ts";
import { uriId } from "../services/uris.ts";
import { problemSchema, rnetDocument, rnetRoute } from "./contracts.ts";
import { blobResponse, contentHash, normalizedUuid, requestMime } from "./http.ts";
import type { AppEnvironment } from "./types.ts";

const mediaElementDocumentSchema = rnetDocument("media-element");

export function createMediaElementRoutes(db: Database, blobs: BlobStore) {
  const router = new Hono<AppEnvironment>();

  router.post(
    "/",
    rnetRoute({ responses: { 201: mediaElementDocumentSchema, 422: problemSchema } }),
    async (context) => {
      const actor = context.get("actor");
      const accessService = new AccessService({ db, actor });
      const mediaElementService = new MediaElementService({ db, actor });
      await accessService.assertAuthenticated();
      let uploadVibeUuid: string | undefined;
      let ownerUuid: string;
      if (actor.kind === "client") {
        const vibe = context.req.header("X-Rnet-Vibe");
        if (!vibe) {
          throw new Problem(
            403,
            "grant_missing",
            "Grant context missing",
            "X-Rnet-Vibe is required",
            { scope: "write:objects" },
          );
        }
        uploadVibeUuid = normalizedUuid(uriId(vibe));
        ownerUuid = (await accessService.assertVibeScope(uploadVibeUuid, "write:objects")).ownerUuid;
      } else if (actor.kind === "user") {
        ownerUuid = actor.uuid;
      } else {
        throw new Error("Authentication assertion did not narrow to a user or client");
      }
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      const mime = requestMime(context.req.header("Content-Type"));
      const kind = context.req.header("X-Rnet-Kind");
      const contentHashValue = await contentHash(bytes);
      const mediaElementUuid = uuidv7();
      const candidateMediaElement = {
        rnet_schema: "0.1",
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
      await blobs.put("elements", contentHashValue, bytes, mime);
      await mediaElementService.createMediaElement({
        uuid: mediaElementUuid,
        ownerUuid,
        contentHash: contentHashValue,
        kind: validation.value.kind,
        mime,
        byteSize: bytes.byteLength,
        createdBy: actor.subject,
        createdForVibe: actor.kind === "client" ? uploadVibeUuid : undefined,
      });
      return context.json(validation.value, 201);
    },
  );
  router.get(
    "/:id",
    rnetRoute({ responses: { 200: mediaElementDocumentSchema } }),
    async (context) => {
      const mediaElementService = new MediaElementService({ db, actor: context.get("actor") });
      const mediaElement = await mediaElementService.getMediaElement(
        normalizedUuid(context.req.param("id")),
      );
      return context.json(await mediaElementDocument(mediaElement, blobs));
    },
  );
  router.get("/:id/bytes", async (context) => {
    const mediaElementService = new MediaElementService({ db, actor: context.get("actor") });
    const mediaElement = await mediaElementService.getMediaElement(
      normalizedUuid(context.req.param("id")),
    );
    return blobResponse(context, await blobs.get("elements", mediaElement.contentHash));
  });

  return router;
}

async function mediaElementDocument(mediaElement: DbMediaElement, blobs: BlobStore): Promise<MediaElement> {
  return {
    rnet_schema: "0.1",
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
