import { describe, expect, test } from "bun:test";

import {
  CredentialedSourceCatalog,
  SourceSkillManifestCatalog,
  type CredentialedSourceSkill,
} from "./types.ts";
import { installedCredentialedSourceSkillDefinitions } from "../src/credentialed-source-catalog.ts";
import { TransactionParserCatalog, transactionParserFor } from "../src/parser-catalog.ts";

type ParserName = CredentialedSourceSkill["parser"]["name"];

function fakeSkill(skillId: string, parserName: ParserName): CredentialedSourceSkill {
  return {
    skillId,
    displayName: skillId,
    manifest: {
      skill_id: skillId,
      label: skillId,
      description: `${skillId} test source`,
      source_kind: "credentialed_remote",
      connector_version: `${skillId}-connector@test`,
      parser: { name: parserName, version: `${parserName}@test` },
      connection: {
        claim_policy: { kind: "single_use_global", attempts: 10, window_hours: 1 },
      },
      input_fields: [],
      review_actions: ["review_import"],
    },
    parser: {
      name: parserName,
      version: `${parserName}@test`,
      async parse() {
        return { transactions: [], sourceRecordCount: 0 };
      },
    },
    connection: {
      claimPolicy: { kind: "single_use_global", attempts: 10, windowHours: 1 },
      requestSchema: { type: "object", properties: {}, additionalProperties: false },
      prepare() {
        return {
          replayKey: `${skillId}-claim`,
          async acquire() {
            return { secret: `${skillId}-secret` };
          },
        };
      },
    },
    fetchPolicy: { attempts: 1, windowHours: 1 },
    capture: {
      mime: "application/json",
      label: (fetchUuid) => `${fetchUuid}.json`,
    },
    parseConfig: (value) => value,
    normalize: (parsed) => parsed,
    identitySourceProperties: (properties) => properties,
    prepareFetch() {
      return {
        async retrieve() {
          return new Uint8Array();
        },
        verifyOptions: {},
      };
    },
    verificationError: () => undefined,
  };
}

describe("CredentialedSourceCatalog", () => {
  test("derives installed transaction parsers from the canonical skill definitions", () => {
    for (const definition of installedCredentialedSourceSkillDefinitions) {
      expect(transactionParserFor(definition.parser.name)).toBe(definition.parser);
    }
  });

  test("preserves registration order and looks skills up by skill id", () => {
    const first = fakeSkill("first", "csv");
    const second = fakeSkill("second", "ofx");
    const catalog = new CredentialedSourceCatalog([first, second]);

    expect(catalog.all()).toEqual([first, second]);
    expect(catalog.forSkillId("first")).toBe(first);
    expect(catalog.forSkillId("second")).toBe(second);
    expect(catalog.forSkillId("missing")).toBeUndefined();
  });

  test("requires the skill id and parser to identify the same skill", () => {
    const first = fakeSkill("first", "csv");
    const second = fakeSkill("second", "ofx");
    const catalog = new CredentialedSourceCatalog([first, second]);

    expect(catalog.forSource("first", "csv")).toBe(first);
    expect(catalog.forSource("second", "ofx")).toBe(second);
    expect(catalog.forSource("first", "ofx")).toBeUndefined();
    expect(catalog.forSource("missing", "csv")).toBeUndefined();
  });

  test("rejects duplicate skill ids", () => {
    expect(
      () =>
        new CredentialedSourceCatalog([
          fakeSkill("duplicate", "csv"),
          fakeSkill("duplicate", "ofx"),
        ]),
    ).toThrow("Duplicate credentialed-source skill id: duplicate");
  });

  test("allows different skills to reuse a parser", () => {
    const first = fakeSkill("first", "csv");
    const second = fakeSkill("second", "csv");
    const catalog = new CredentialedSourceCatalog([first, second]);

    expect(catalog.forSource("first", "csv")).toBe(first);
    expect(catalog.forSource("second", "csv")).toBe(second);
  });

  test("rejects invalid or inconsistent skill manifests", () => {
    expect(() => new CredentialedSourceCatalog([fakeSkill("Invalid Skill", "csv")])).toThrow(
      "Invalid credentialed-source skill id: Invalid Skill",
    );

    const mismatched = fakeSkill("first", "csv");
    mismatched.manifest.skill_id = "second";
    expect(() => new CredentialedSourceCatalog([mismatched])).toThrow(
      "manifest id second does not match skill id first",
    );
  });

  test("publishes immutable serializable manifest snapshots", () => {
    const skill = fakeSkill("first", "csv");
    const catalog = new CredentialedSourceCatalog([skill]);
    const manifest = catalog.manifests()[0];

    expect(manifest).toEqual(skill.manifest);
    expect(manifest).not.toBe(skill.manifest);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest?.parser)).toBe(true);
  });

  test("rejects manifest fields that drift from connection schemas or persist secrets", () => {
    const uncovered = fakeSkill("first", "csv");
    (uncovered.connection.requestSchema as Record<string, unknown>).properties = {
      claim: { type: "string" },
    };
    expect(() => new CredentialedSourceCatalog([uncovered])).toThrow(
      "manifest does not cover its connection schema",
    );

    const plaintextSecret = fakeSkill("second", "csv");
    plaintextSecret.manifest.input_fields.push({
      name: "password",
      label: "Password",
      target: "source",
      control: "text",
      required: true,
      secret: true,
    });
    expect(() => new CredentialedSourceCatalog([plaintextSecret])).toThrow(
      "cannot store a secret in source config",
    );
  });
});

describe("TransactionParserCatalog", () => {
  test("allows an intentionally shared parser and rejects name collisions", () => {
    const parser = fakeSkill("first", "csv").parser;
    const catalog = new TransactionParserCatalog([parser, parser]);
    expect(catalog.forName("csv")).toBe(parser);

    expect(
      () => new TransactionParserCatalog([parser, { ...parser, version: "csv@other" }]),
    ).toThrow("Conflicting transaction parser registration: csv");
  });
});

describe("SourceSkillManifestCatalog", () => {
  test("rejects duplicate ids, unknown fields, and unsafe help links", () => {
    const manifest = fakeSkill("first", "csv").manifest;
    expect(() => new SourceSkillManifestCatalog([manifest, manifest])).toThrow(
      "Duplicate source-skill manifest: first",
    );
    expect(() => new SourceSkillManifestCatalog([{ ...manifest, executable: "surprise" }])).toThrow(
      "unknown properties",
    );
    expect(
      () =>
        new SourceSkillManifestCatalog([
          {
            ...manifest,
            input_fields: [
              {
                name: "claim",
                label: "Claim",
                target: "connection",
                control: "text",
                required: true,
                secret: true,
                help_url: "http://provider.test/connect",
              },
            ],
          },
        ]),
    ).toThrow("field claim is invalid");
  });
});
