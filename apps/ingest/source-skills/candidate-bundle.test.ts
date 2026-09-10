import { describe, expect, test } from "bun:test";

import { installedCredentialedSourceSkillDefinitions } from "../src/credentialed-source-catalog.ts";
import { installedFileSourceSkills } from "../src/source-skill-catalog.ts";
import { compileTransactionCandidates } from "../skills/transactions/transaction-candidates.ts";
import {
  CANDIDATE_BUNDLE_CAPABILITY,
  candidateBundle,
  sourceJsonObject,
  sourceJsonValue,
  type SourceCandidateDraft,
} from "./candidate-bundle.ts";

describe("candidate_bundle@1 compiled-source contract", () => {
  test("preserves candidate order and exposes one generic capability discriminator", () => {
    const candidates: SourceCandidateDraft[] = [
      {
        type: "synthetic.note",
        keys: { id: "first" },
        sourceProperties: { title: "First" },
        semanticIdentity: { id: "first" },
        elements: [],
      },
      {
        type: "synthetic.note",
        keys: { id: "second" },
        sourceProperties: { title: "Second" },
        semanticIdentity: { id: "second" },
        elements: [],
      },
    ];
    const bundle = candidateBundle(candidates, { ok: true, checks: [] });

    expect(bundle.kind).toBe(CANDIDATE_BUNDLE_CAPABILITY);
    expect(bundle.candidates).toEqual(candidates);
  });

  test("centralizes defensive JSON-safe copies for source-owned facts", () => {
    const input = { nested: { count: 2 }, values: [true, null, "stable"] };
    const copied = sourceJsonObject(input, "Synthetic facts");
    expect(copied).toEqual(input);
    expect(copied).not.toBe(input);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => sourceJsonValue(cyclic, "Synthetic facts")).toThrow("contains a cycle");
    expect(() => sourceJsonObject({ missing: undefined }, "Synthetic facts")).toThrow(
      "Synthetic facts.missing is undefined",
    );
    expect(() => sourceJsonValue(Number.POSITIVE_INFINITY, "Synthetic facts")).toThrow(
      "not JSON-safe",
    );

    const specialKey = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const specialKeyCopy = sourceJsonObject(specialKey, "Synthetic facts");
    expect(Object.hasOwn(specialKeyCopy, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(specialKeyCopy)).toBe(Object.prototype);
    expect((specialKeyCopy as { polluted?: boolean }).polluted).toBeUndefined();
    expect(JSON.stringify(specialKeyCopy)).toBe('{"__proto__":{"polluted":true}}');
  });

  test("compiles canonical transaction IR without provider or server behavior", async () => {
    const bundle = await compileTransactionCandidates({
      sourceRecordCount: 1,
      transactions: [
        {
          amount: "-12.34",
          currency: "USD",
          postedAt: "2026-08-30",
          fitid: "tx-1",
          accountIdentity: "account-1",
          rawDescription: "SYNTHETIC MARKET",
          sourceProperties: { pending: false },
        },
      ],
    });

    expect(bundle).toMatchObject({
      kind: "candidate_bundle@1",
      verify: { ok: true, source_record_count: 1, candidate_count: 1 },
      candidates: [
        {
          type: "transaction",
          keys: { fitid: "tx-1", account_hash: expect.stringMatching(/^sha256:/) },
          sourceProperties: {
            amount: "-12.34",
            currency: "USD",
            posted_at: "2026-08-30",
            raw_description: "SYNTHETIC MARKET",
            pending: false,
          },
          elements: [],
        },
      ],
    });
  });

  test("registers OFX and SimpleFIN independently with their parser pins", () => {
    expect(
      installedFileSourceSkills.all().map(({ manifest, compiledSource }) => ({
        skillId: manifest.skill_id,
        parser: manifest.parser,
        capability: compiledSource.kind,
      })),
    ).toEqual([
      {
        skillId: "ofx",
        parser: { name: "ofx", version: "ofx@1.1.0" },
        capability: "candidate_bundle@1",
      },
    ]);
    expect(
      installedCredentialedSourceSkillDefinitions
        .filter(({ skillId }) => skillId === "simplefin")
        .map(({ skillId, parser }) => ({
          skillId,
          parser: { name: parser.name, version: parser.version },
        })),
    ).toEqual([
      {
        skillId: "simplefin",
        parser: { name: "simplefin", version: "simplefin@2.0.0" },
      },
    ]);
  });

  test("keeps transaction parsing and VERIFY out of the server boundary", async () => {
    const server = await Bun.file(
      new URL("../../server/src/services/import-service.ts", import.meta.url),
    ).text();

    expect(server).toContain("CANDIDATE_BUNDLE_CAPABILITY");
    expect(server).not.toContain("ParsedTransactions");
    expect(server).not.toContain("verifyTransactions");
    expect(server).not.toContain('candidate.type !== "transaction"');
    expect(server).not.toContain('skillId === "simplefin"');
  });
});
