import type { OriginArtifact } from "@rnet/types";

import type { DbOriginArtifact } from "../db/models/origin-artifact.ts";
import { supportedRnetSchemaVersion } from "../rnet.ts";

export function serializeOriginArtifact(
  originArtifact: DbOriginArtifact,
  baseUrl: string,
): OriginArtifact {
  return {
    rnet_schema: supportedRnetSchemaVersion(originArtifact.rnetSchema),
    uri: `rnet://origin/${originArtifact.uuid}`,
    owner: `rnet://id/${originArtifact.ownerUuid}`,
    content_hash: originArtifact.contentHash,
    mime: originArtifact.mime,
    bytes: `${baseUrl}/rnet/v0/origins/${originArtifact.uuid}/bytes`,
    byte_size: originArtifact.byteSize,
    ...(originArtifact.label ? { label: originArtifact.label } : {}),
    uploaded_at: originArtifact.uploadedAt.toISOString(),
  };
}
