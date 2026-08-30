import {
  CredentialedSourceCatalog,
  SourceSkillManifestCatalog,
} from "../connected-sources/types.ts";
import { FileSourceCatalog } from "../file-sources/types.ts";
import { csvSourceSkill } from "../skills/csv/manifest.ts";
import { ofxSourceSkill } from "../skills/ofx/manifest.ts";

/** Canonical installed file capabilities. Package discovery can replace only this bootstrap seam. */
export const installedFileSourceSkills = new FileSourceCatalog([csvSourceSkill, ofxSourceSkill]);

/** This installation list can become generated package discovery without changing consumers. */
export function createSourceSkillManifestCatalog(
  fileSources: FileSourceCatalog,
  credentialed: CredentialedSourceCatalog,
): SourceSkillManifestCatalog {
  return new SourceSkillManifestCatalog([...fileSources.manifests(), ...credentialed.manifests()]);
}
