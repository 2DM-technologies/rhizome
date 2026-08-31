import { describe, expect, test } from "bun:test";

import { CANDIDATE_BUNDLE_CAPABILITY, candidateBundle } from "../source-skills/candidate-bundle.ts";
import type { PublicRemoteNetworkCapability, PublicRemoteSourceSkill } from "./types.ts";
import { PublicRemoteSourceCatalog } from "./types.ts";

interface SyntheticSkillOptions {
  connectorVersion?: string;
  networkCapabilities?: readonly PublicRemoteNetworkCapability[];
  parserVersion?: string;
  skillId?: string;
}

function syntheticSkill(options: SyntheticSkillOptions = {}): PublicRemoteSourceSkill {
  const skillId = options.skillId ?? "synthetic_public";
  const parserVersion = options.parserVersion ?? "synthetic-public@2";
  const connectorVersion = options.connectorVersion ?? "synthetic-public-connector@2";
  const parser = {
    name: "synthetic-public",
    version: parserVersion,
    async parse() {
      return {};
    },
  };
  return {
    skillId,
    displayName: "Synthetic public source",
    manifest: {
      skill_id: skillId,
      label: "Synthetic public source",
      description: "Synthetic public source used to exercise catalog conformance.",
      source_kind: "public_remote",
      connector_version: connectorVersion,
      parser: { name: parser.name, version: parser.version },
      input_fields: [
        {
          name: "url",
          label: "URL",
          target: "source",
          control: "url",
          required: true,
          secret: false,
        },
      ],
      review_actions: ["review_import"],
    },
    parser,
    compiledSource: {
      kind: CANDIDATE_BUNDLE_CAPABILITY,
      async compile() {
        return candidateBundle([], { ok: true, checks: [] });
      },
    },
    sourceRequestSchema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string" } },
      additionalProperties: false,
    },
    fetchPolicy: { attempts: 10, windowHours: 24 },
    networkPolicy: {
      capabilities: options.networkCapabilities ?? [{ kind: "safe_public_https" }],
    },
    capture: { mime: "application/json", label: (_config, id) => `capture-${id}.json` },
    normalizeConfig: () => ({ locator: "fixture" }),
    parseConfig: (value) => value,
    stateDigest: () => ({ locator: "fixture" }),
    async retrieve() {
      return new Uint8Array();
    },
  };
}

describe("public-remote source catalog", () => {
  test("exposes one current manifest while resolving current and historical pins explicitly", () => {
    const current = syntheticSkill();
    const historical = syntheticSkill({
      connectorVersion: "synthetic-public-connector@1",
      parserVersion: "synthetic-public@1",
    });
    const catalog = new PublicRemoteSourceCatalog({ current: [current], historical: [historical] });

    expect(catalog.currentForSkillId("synthetic_public")).toBe(current);
    expect(
      catalog.forPinnedSource({
        skillId: "synthetic_public",
        connectorVersion: "synthetic-public-connector@1",
        parserName: "synthetic-public",
        parserVersion: "synthetic-public@1",
      }),
    ).toBe(historical);
    expect(
      catalog.forPinnedSource({
        skillId: "synthetic_public",
        connectorVersion: "synthetic-public-connector@2",
        parserName: "synthetic-public",
        parserVersion: "synthetic-public@2",
      }),
    ).toBe(current);
    expect(
      catalog.forPinnedSource({
        skillId: "synthetic_public",
        connectorVersion: "synthetic-public-connector@1",
        parserName: "synthetic-public",
        parserVersion: "synthetic-public@2",
      }),
    ).toBeUndefined();
    expect(catalog.currentImplementations()).toEqual([current]);
    expect(catalog.installedImplementations()).toEqual([current, historical]);
    expect(catalog.manifests()).toEqual([current.manifest]);
    expect(JSON.parse(JSON.stringify(catalog.manifests()))).toEqual([current.manifest]);
  });

  test("requires exactly one current implementation and unique complete pins per skill", () => {
    const current = syntheticSkill();
    expect(() => new PublicRemoteSourceCatalog({ current: [current, syntheticSkill()] })).toThrow(
      "Duplicate source-skill manifest",
    );
    expect(
      () => new PublicRemoteSourceCatalog({ current: [], historical: [syntheticSkill()] }),
    ).toThrow("no designated current implementation");
    expect(
      () => new PublicRemoteSourceCatalog({ current: [current], historical: [syntheticSkill()] }),
    ).toThrow("Duplicate public-remote source implementation pin");
  });

  test("fails closed on mismatched parser pins", () => {
    const skill = syntheticSkill();
    expect(
      () =>
        new PublicRemoteSourceCatalog({
          current: [
            {
              ...skill,
              parser: { name: "other", version: skill.parser.version, parse: async () => ({}) },
            },
          ],
        }),
    ).toThrow("inconsistent parser metadata");

    expect(
      () =>
        new PublicRemoteSourceCatalog({
          current: [
            {
              ...skill,
              sourceRequestSchema: {
                type: "object",
                required: ["url"],
                properties: { url: { type: "boolean" } },
                additionalProperties: false,
              },
            },
          ],
        }),
    ).toThrow("field url does not match its source request schema");
  });

  test("supports fixed-origin, safe-public, and combined network capabilities", () => {
    const fixed = { kind: "fixed_https_origins", origins: ["https://api.example.test"] } as const;
    expect(
      new PublicRemoteSourceCatalog({
        current: [syntheticSkill({ networkCapabilities: [fixed] })],
      }).currentForSkillId("synthetic_public"),
    ).toBeDefined();
    expect(
      new PublicRemoteSourceCatalog({
        current: [syntheticSkill({ networkCapabilities: [{ kind: "safe_public_https" }] })],
      }).currentForSkillId("synthetic_public"),
    ).toBeDefined();
    expect(
      new PublicRemoteSourceCatalog({
        current: [
          syntheticSkill({
            networkCapabilities: [fixed, { kind: "safe_public_https" }],
          }),
        ],
      }).currentForSkillId("synthetic_public"),
    ).toBeDefined();
  });

  test("rejects absent, repeated, and unsafe network capabilities", () => {
    expect(
      () =>
        new PublicRemoteSourceCatalog({
          current: [syntheticSkill({ networkCapabilities: [] })],
        }),
    ).toThrow("must declare a network capability");
    expect(
      () =>
        new PublicRemoteSourceCatalog({
          current: [
            syntheticSkill({
              networkCapabilities: [{ kind: "fixed_https_origins", origins: ["http://localhost"] }],
            }),
          ],
        }),
    ).toThrow("invalid fixed-origin capability");
    expect(
      () =>
        new PublicRemoteSourceCatalog({
          current: [
            syntheticSkill({
              networkCapabilities: [{ kind: "safe_public_https" }, { kind: "safe_public_https" }],
            }),
          ],
        }),
    ).toThrow("repeats network capability");
  });
});
