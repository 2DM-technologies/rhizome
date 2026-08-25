import type { MediaObject } from "@rnet/types";

import type { DbMediaObject } from "../db/models/media-object.ts";
import { supportedRnetSchemaVersion } from "../rnet.ts";

export interface MediaObjectAggregate {
  mediaObject: DbMediaObject;
  mediaElementUuids: string[];
}

export function serializeMediaObject({
  mediaObject,
  mediaElementUuids,
}: MediaObjectAggregate): MediaObject {
  return {
    rnet_schema: supportedRnetSchemaVersion(mediaObject.rnetSchema),
    uri: `rnet://object/${mediaObject.uuid}`,
    owner: `rnet://id/${mediaObject.ownerUuid}`,
    type: mediaObject.type,
    elements: mediaElementUuids.map((uuid) => `rnet://element/${uuid}`),
    ...(Object.keys(mediaObject.keys).length ? { keys: mediaObject.keys } : {}),
    source: mediaObject.source,
    ...(mediaObject.user ? { user: mediaObject.user } : {}),
    ...(Object.keys(mediaObject.inferred).length ? { inferred: mediaObject.inferred } : {}),
    ...mediaObject.extensions,
  } as MediaObject;
}
