import { describe, expect, test } from "bun:test";

import { FileSourceCatalog, type FileSourceSkill } from "./types.ts";

function fakeFileSkill(skillId: string, parserName: string): FileSourceSkill {
  const parser = {
    name: parserName,
    version: `${parserName}@test`,
    async parse() {
      return { transactions: [], sourceRecordCount: 0 };
    },
  };
  return {
    manifest: {
      skill_id: skillId,
      label: skillId,
      description: `${skillId} file source`,
      source_kind: "file",
      connector_version: "origin-upload@test",
      parser: { name: parser.name, version: parser.version },
      input_fields: [],
      review_actions: ["review_import"],
    },
    parser,
  };
}

describe("FileSourceCatalog", () => {
  test("uses skill identity independently from the parser implementation name", () => {
    const skill = fakeFileSkill("bank_export", "csv");
    const catalog = new FileSourceCatalog([skill]);

    expect(catalog.forSkillId("bank_export")?.parser.name).toBe("csv");
    expect(catalog.forSkillId("csv")).toBeUndefined();
    expect(catalog.manifests()[0]).not.toBe(skill.manifest);
    expect(Object.isFrozen(catalog.manifests()[0])).toBe(true);
  });

  test("fails closed on duplicate identities and inconsistent parser metadata", () => {
    expect(
      () =>
        new FileSourceCatalog([
          fakeFileSkill("duplicate", "csv"),
          fakeFileSkill("duplicate", "ofx"),
        ]),
    ).toThrow("Duplicate source-skill manifest: duplicate");

    const inconsistent = fakeFileSkill("broken", "csv");
    (inconsistent.manifest.parser as { name: string }).name = "ofx";
    expect(() => new FileSourceCatalog([inconsistent])).toThrow("inconsistent parser metadata");
  });
});
