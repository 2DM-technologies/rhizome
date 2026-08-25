import type { MediaElement } from "@rnet/types";

import type { DbMediaElement } from "../db/models/media-element.ts";
import { supportedRnetSchemaVersion } from "../rnet.ts";

export function serializeMediaElement(mediaElement: DbMediaElement, baseUrl: string): MediaElement {
  return {
    rnet_schema: supportedRnetSchemaVersion(mediaElement.rnetSchema),
    uri: `rnet://element/${mediaElement.uuid}`,
    owner: `rnet://id/${mediaElement.ownerUuid}`,
    content_hash: mediaElement.contentHash,
    kind: mediaElement.kind,
    mime: mediaElement.mime,
    bytes: `${baseUrl}/rnet/v0/elements/${mediaElement.uuid}/bytes`,
    byte_size: mediaElement.byteSize,
    created_at: mediaElement.createdAt.toISOString(),
  };
}
