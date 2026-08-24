import type { MediaElement } from "@rnet/types";

import type { BlobStore } from "../blobs/index.ts";
import type { DbMediaElement } from "../db/models/media-element.ts";
import { supportedRnetSchemaVersion } from "../rnet.ts";

export async function serializeMediaElement(
  mediaElement: DbMediaElement,
  blobs: BlobStore,
): Promise<MediaElement> {
  return {
    rnet_schema: supportedRnetSchemaVersion(mediaElement.rnetSchema),
    uri: `rnet://element/${mediaElement.uuid}`,
    owner: `rnet://id/${mediaElement.ownerUuid}`,
    content_hash: mediaElement.contentHash,
    kind: mediaElement.kind,
    mime: mediaElement.mime,
    bytes: await blobs.signedUrl("elements", mediaElement.contentHash),
    byte_size: mediaElement.byteSize,
    created_at: mediaElement.createdAt.toISOString(),
  };
}
