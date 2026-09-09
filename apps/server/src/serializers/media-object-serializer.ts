import type { MediaObject, MediaObjectElementRef } from "@rnet/types";

import type { DbMediaObject } from "../db/models/media-object.ts";
import { supportedRnetSchemaVersion } from "../rnet.ts";

export interface MediaObjectAggregate {
  mediaObject: DbMediaObject;
  mediaElementReferences: Array<{
    uuid: string;
    role?: NonNullable<MediaObjectElementRef["role"]>;
  }>;
}

export function serializeMediaObject({
  mediaObject,
  mediaElementReferences,
}: MediaObjectAggregate): MediaObject {
  return {
    rnet_schema: supportedRnetSchemaVersion(mediaObject.rnetSchema),
    uri: `rnet://object/${mediaObject.uuid}`,
    owner: `rnet://id/${mediaObject.ownerUuid}`,
    type: mediaObject.type,
    elements: mediaElementReferences.map(({ uuid, role }) => ({
      uri: `rnet://element/${uuid}`,
      ...(role ? { role } : {}),
    })),
    ...(Object.keys(mediaObject.keys).length ? { keys: mediaObject.keys } : {}),
    source: mediaObject.source,
    ...(mediaObject.user ? { user: mediaObject.user } : {}),
    ...(Object.keys(mediaObject.inferred).length ? { inferred: mediaObject.inferred } : {}),
    ...mediaObject.extensions,
  } as MediaObject;
}
