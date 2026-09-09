import { CredentialedSourceCatalog } from "../connected-sources/types.ts";
import { FileSourceCatalog } from "../file-sources/types.ts";
import type { PublicRemoteSourceCatalog } from "../public-sources/types.ts";
import { SourceSkillManifestCatalog } from "../source-skills/manifest-catalog.ts";
import { csvSourceSkill } from "../skills/transactions/csv/source.ts";
import { ofxSourceSkill } from "../skills/transactions/ofx/source.ts";
import { xArchiveSourceSkill } from "../skills/x/archive/source.ts";

/** Canonical installed file capabilities. Package discovery can replace only this bootstrap seam. */
export const installedFileSourceSkills = new FileSourceCatalog([
  csvSourceSkill,
  ofxSourceSkill,
  xArchiveSourceSkill,
]);

/** This installation list can become generated package discovery without changing consumers. */
export function createSourceSkillManifestCatalog(
  fileSources: FileSourceCatalog,
  credentialed: CredentialedSourceCatalog,
  publicRemote: PublicRemoteSourceCatalog,
): SourceSkillManifestCatalog {
  return new SourceSkillManifestCatalog([
    ...fileSources.manifests(),
    ...credentialed.manifests(),
    ...publicRemote.manifests(),
  ]);
}
