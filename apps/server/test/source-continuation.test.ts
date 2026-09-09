import { describe, expect, test } from "bun:test";

import { SOURCE_ACTION_KINDS } from "../../../packages/store-contract/src/index.ts";
import { createLocalSourceCredentialCrypto } from "../src/services/source-credential-crypto.ts";
import {
  SourceContinuationCodec,
  type SourceContinuationContext,
} from "../src/services/source-continuation.ts";

const key = Uint8Array.from({ length: 32 }, (_, index) => index);
const context: SourceContinuationContext = {
  ownerUuid: "0198f2a1-a001-7a01-8001-000000000001",
  vibeUuid: "0198f2a1-a002-7a02-8002-000000000002",
  source: "source:0198f2a1-a003-7a03-8003-000000000003",
  sourceStateDigest: `sha256:${"a".repeat(64)}`,
};

describe("source action continuations", () => {
  test("round-trips every action with action-independent context binding", async () => {
    const actualCrypto = createLocalSourceCredentialCrypto(key);
    const associatedDataCalls: string[] = [];
    const codec = new SourceContinuationCodec({
      ...actualCrypto,
      open(sealed, associatedData) {
        associatedDataCalls.push(associatedData);
        return actualCrypto.open(sealed, associatedData);
      },
      prepareSeal(associatedData) {
        associatedDataCalls.push(associatedData);
        return actualCrypto.prepareSeal(associatedData);
      },
    });

    for (const kind of SOURCE_ACTION_KINDS) {
      const token = await codec.seal({
        ...context,
        kind,
        resume: { mode: "rebaseline", private_marker: "never-plaintext" },
      });

      expect(token).not.toContain("rebaseline");
      expect(token).not.toContain("never-plaintext");
      await expect(codec.open(token, context)).resolves.toEqual({
        expectedSourceStateDigest: context.sourceStateDigest,
        kind,
        resume: { mode: "rebaseline", private_marker: "never-plaintext" },
      });
    }

    expect(new Set(associatedDataCalls)).toEqual(
      new Set([
        `rhizome:source-continuation:v1:${context.ownerUuid}:${context.vibeUuid}:${context.source}`,
      ]),
    );
    expect(associatedDataCalls).toHaveLength(SOURCE_ACTION_KINDS.length * 2);

    const token = await codec.seal({
      ...context,
      kind: SOURCE_ACTION_KINDS[0],
      resume: { mode: "rebaseline" },
    });

    for (const changed of [
      { ...context, ownerUuid: "0198f2a1-a004-7a04-8004-000000000004" },
      { ...context, vibeUuid: "0198f2a1-a005-7a05-8005-000000000005" },
      { ...context, source: "source:0198f2a1-a006-7a06-8006-000000000006" },
      { ...context, sourceStateDigest: `sha256:${"b".repeat(64)}` },
    ]) {
      await expect(codec.open(token, changed)).rejects.toThrow(
        "The source continuation token is invalid or expired",
      );
    }
  });

  test("rejects tampering and expiry with the same generic failure", async () => {
    let now = Date.parse("2026-08-30T12:00:00.000Z");
    const codec = new SourceContinuationCodec(createLocalSourceCredentialCrypto(key), () => now);
    const token = await codec.seal({
      ...context,
      kind: "review_import",
      resume: { mode: "rebaseline" },
    });
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

    await expect(codec.open(tampered, context)).rejects.toThrow(
      "The source continuation token is invalid or expired",
    );
    now += 15 * 60 * 1_000;
    await expect(codec.open(token, context)).rejects.toThrow(
      "The source continuation token is invalid or expired",
    );
  });

  test("bounds provider resume size and nesting before sealing", async () => {
    const codec = new SourceContinuationCodec(createLocalSourceCredentialCrypto(key));
    await expect(
      codec.seal({
        ...context,
        kind: "review_import",
        resume: "x".repeat(4_097),
      }),
    ).rejects.toThrow("exceeds its size limit");

    let deeplyNested: unknown = null;
    for (let index = 0; index < 17; index += 1) deeplyNested = [deeplyNested];
    await expect(
      codec.seal({
        ...context,
        kind: "review_import",
        resume: deeplyNested as never,
      }),
    ).rejects.toThrow("not serializable JSON");
  });
});
