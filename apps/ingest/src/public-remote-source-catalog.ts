import type { PublicAssetFetcher } from "../public-sources/types.ts";
import { PublicRemoteSourceCatalog } from "../public-sources/types.ts";
import { createArenaSourceSkill } from "../skills/arena/source.ts";

/**
 * Canonical installed public capabilities. This small bootstrap seam can be generated from
 * installed skill packages once discovery moves outside the monorepo.
 */
export function createPublicRemoteSourceCatalog(dependencies: {
  assetFetch: PublicAssetFetcher;
}): PublicRemoteSourceCatalog {
  return new PublicRemoteSourceCatalog({
    current: [createArenaSourceSkill({ assetFetch: dependencies.assetFetch })],
  });
}
