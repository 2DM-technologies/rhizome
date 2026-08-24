import type { Vibe } from "@rnet/types";

import type { DbGrant } from "../db/models/grant.ts";
import type { DbVibe } from "../db/models/vibe.ts";
import { supportedRnetSchemaVersion } from "../rnet.ts";

export interface VibeAggregate {
  vibe: DbVibe;
  grants: DbGrant[];
  mediaObjectUuids: string[];
}

export function serializeVibe({ vibe, grants, mediaObjectUuids }: VibeAggregate): Vibe {
  return {
    rnet_schema: supportedRnetSchemaVersion(vibe.rnetSchema),
    uri: `rnet://vibe/${vibe.uuid}`,
    title: vibe.title,
    owner: `rnet://id/${vibe.ownerUuid}`,
    objects: mediaObjectUuids.map((uuid) => `rnet://object/${uuid}`),
    created_at: vibe.createdAt.toISOString(),
    ...(vibe.pullConfig ? { pull: vibe.pullConfig } : {}),
    ...(grants.length
      ? { grants: grants.map((grant) => ({ subject: grant.subject, scope: grant.scopes })) }
      : {}),
    ...(Object.keys(vibe.inferred).length ? { inferred: vibe.inferred } : {}),
    ...vibe.extensions,
  } as Vibe;
}
