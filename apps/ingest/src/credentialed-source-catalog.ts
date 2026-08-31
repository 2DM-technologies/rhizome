import {
  CredentialedSourceCatalog,
  type SourceSkillDefinition,
} from "../connected-sources/types.ts";
import { simpleFinSourceSkillDefinition } from "../skills/transactions/simplefin/definition.ts";

export type CredentialedSourceSettings = Readonly<Record<string, unknown>>;

type InstalledSourceSkillDefinition = SourceSkillDefinition<unknown>;

function install<Settings>(
  definition: SourceSkillDefinition<Settings>,
): InstalledSourceSkillDefinition {
  return {
    skillId: definition.skillId,
    parser: definition.parser,
    loadSettings: definition.loadSettings,
    create(settings) {
      const skill = definition.create(settings as Settings);
      if (skill.skillId !== definition.skillId) {
        throw new Error(
          `Credentialed-source definition ${definition.skillId} created skill ${skill.skillId}`,
        );
      }
      if (
        skill.parser.name !== definition.parser.name ||
        skill.parser.version !== definition.parser.version
      ) {
        throw new Error(
          `Credentialed-source definition ${definition.skillId} created an inconsistent parser`,
        );
      }
      return skill;
    },
  };
}

/** This installation list can become generated package discovery without changing bootstrap. */
export const installedCredentialedSourceSkillDefinitions: readonly InstalledSourceSkillDefinition[] =
  [install(simpleFinSourceSkillDefinition)];

export function loadCredentialedSourceSettings(
  environment: Record<string, string | undefined> = process.env,
): CredentialedSourceSettings {
  return Object.freeze(
    Object.fromEntries(
      installedCredentialedSourceSkillDefinitions.map((definition) => [
        definition.skillId,
        definition.loadSettings(environment),
      ]),
    ),
  );
}

export function createCredentialedSourceCatalog(
  settings: CredentialedSourceSettings,
): CredentialedSourceCatalog {
  return new CredentialedSourceCatalog(
    installedCredentialedSourceSkillDefinitions.map((definition) => {
      if (!(definition.skillId in settings)) {
        throw new Error(`Missing settings for source skill ${definition.skillId}`);
      }
      return definition.create(settings[definition.skillId]);
    }),
  );
}
