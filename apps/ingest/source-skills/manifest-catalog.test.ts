import { describe, expect, test } from "bun:test";

import { SourceSkillManifestCatalog } from "./manifest-catalog.ts";

function credentialedManifest() {
  return {
    skill_id: "first",
    label: "First source",
    description: "A source manifest used by catalog tests.",
    source_kind: "credentialed_remote",
    connector_version: "first-connector@test",
    parser: { name: "csv", version: "csv@0.0.0-test" },
    limits: {
      maxCandidates: 10,
      maxCaptureBytes: 1_024,
      maxElementBytes: 512,
      maxTotalElementBytes: 1_024,
    },
    connection: {
      mode: "claim_exchange",
      claim_policy: { kind: "single_use_global" },
    },
    input_fields: [],
    review_actions: ["review_import"],
  } as const;
}

describe("SourceSkillManifestCatalog", () => {
  test("rejects parser pins that cannot be persisted as rNet ingest provenance", () => {
    const manifest = credentialedManifest();
    expect(
      () =>
        new SourceSkillManifestCatalog([
          { ...manifest, parser: { ...manifest.parser, version: "csv@1" } },
        ]),
    ).toThrow("parser version cannot be persisted as rNet ingest provenance");
  });

  test("rejects duplicate ids, unknown fields, and unsafe help links", () => {
    const manifest = credentialedManifest();
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

  test("requires bounded generic limits and restricts preprocessing to file sources", () => {
    const manifest = credentialedManifest();
    expect(
      () =>
        new SourceSkillManifestCatalog([
          { ...manifest, limits: { ...manifest.limits, maxCandidates: 0 } },
        ]),
    ).toThrow("invalid execution limits");
  });

  test("rejects source-kind forms that the generic host cannot serialize", () => {
    const base = credentialedManifest();
    const withoutConnection = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== "connection"),
    );
    expect(
      () =>
        new SourceSkillManifestCatalog([
          { ...withoutConnection, source_kind: "file", input_fields: [] },
        ]),
    ).toThrow("must declare exactly one required source file field");

    expect(
      () =>
        new SourceSkillManifestCatalog([
          {
            ...withoutConnection,
            source_kind: "public_remote",
            input_fields: [
              {
                name: "token",
                label: "Token",
                target: "connection",
                control: "text",
                required: true,
                secret: true,
              },
            ],
          },
        ]),
    ).toThrow("cannot declare connection fields");

    expect(
      () =>
        new SourceSkillManifestCatalog([
          {
            ...withoutConnection,
            source_kind: "public_remote",
            input_fields: [
              {
                name: "url",
                label: "URL",
                target: "source",
                control: "url",
                required: true,
                secret: false,
                accept: ["text/plain"],
              },
            ],
          },
        ]),
    ).toThrow("field url is invalid");
  });

  test("only permits securely clearable connection text fields to carry secrets", () => {
    const base = credentialedManifest();
    const secretField = {
      name: "token",
      label: "Token",
      target: "connection",
      control: "text",
      required: true,
      secret: true,
    } as const;

    expect(
      () => new SourceSkillManifestCatalog([{ ...base, input_fields: [secretField] }]),
    ).not.toThrow();

    expect(
      () =>
        new SourceSkillManifestCatalog([
          {
            ...base,
            input_fields: [{ ...secretField, target: "source" }],
          },
        ]),
    ).toThrow("cannot store a secret in source config");

    for (const control of ["url", "file", "checkbox"] as const) {
      expect(
        () =>
          new SourceSkillManifestCatalog([
            {
              ...base,
              input_fields: [{ ...secretField, control }],
            },
          ]),
      ).toThrow(`secret field token must use a text control`);
    }

    expect(
      () =>
        new SourceSkillManifestCatalog([
          {
            ...base,
            input_fields: [
              {
                ...secretField,
                control: "select",
                options: [{ value: "embedded-credential", label: "Stored credential" }],
              },
            ],
          },
        ]),
    ).toThrow("secret field token must use a text control");
  });
});
