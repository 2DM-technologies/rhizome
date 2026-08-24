import type { OriginArtifact } from "@rnet/types";

import type { BlobStore } from "../blobs/index.ts";
import type { DbOriginArtifact } from "../db/models/origin-artifact.ts";
import { supportedRnetSchemaVersion } from "../rnet.ts";

export async function serializeOriginArtifact(
  originArtifact: DbOriginArtifact,
  blobs: BlobStore,
): Promise<OriginArtifact> {
  return {
    rnet_schema: supportedRnetSchemaVersion(originArtifact.rnetSchema),
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
