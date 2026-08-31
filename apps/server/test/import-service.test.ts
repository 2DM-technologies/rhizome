import { describe, expect, test } from "bun:test";
import type { MediaObject } from "@rnet/types";

import { candidateSemanticDigest, canonicalJson } from "../src/services/import-service.ts";

const firstCandidate: MediaObject = {
  rnet_schema: "0.1",
  uri: "rnet://object/0198f2a1-a001-7a01-8001-000000000001",
  owner: "rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
  type: "transaction",
  elements: [],
  keys: { fitid: "transaction-1", account_hash: "sha256:account" },
  source: {
    ingest: { method: "parser", reproducible: true, skill: "csv@1" },
    origins: ["rnet://origin/0198f2a1-a002-7a02-8002-000000000002"],
    properties: { amount: "-12.34", currency: "USD", posted_at: "2026-08-29" },
  },
};

describe("pull candidate identity", () => {
  test("semantic digests ignore record and capture identities but retain source values", async () => {
    const recaptured: MediaObject = {
      ...firstCandidate,
      uri: "rnet://object/0198f2a1-a003-7a03-8003-000000000003",
      source: {
        ...firstCandidate.source,
        origins: ["rnet://origin/0198f2a1-a004-7a04-8004-000000000004"],
      },
    };
    const changed: MediaObject = {
      ...recaptured,
      source: {
        ...recaptured.source,
        properties: { ...recaptured.source.properties, amount: "-12.35" },
      },
    };

    expect(await candidateSemanticDigest(recaptured)).toBe(
      await candidateSemanticDigest(firstCandidate),
    );
    expect(await candidateSemanticDigest(changed)).not.toBe(
      await candidateSemanticDigest(firstCandidate),
    );
  });

  test("semantic digests ignore SimpleFIN account snapshots but retain transaction changes", async () => {
    const firstSnapshot: MediaObject = {
      ...firstCandidate,
      source: {
        ...firstCandidate.source,
        properties: {
          ...firstCandidate.source.properties,
          account_balance: "100.00",
          account_balance_date: "2026-08-29T12:00:00.000Z",
          account_balance_date_epoch: 1_777_461_600,
          simplefin_account_extra: { available_balance: "90.00", status: "open" },
          simplefin_transaction_extra: { category: "food" },
        },
      },
    };
    const laterSnapshot: MediaObject = {
      ...firstSnapshot,
      source: {
        ...firstSnapshot.source,
        properties: {
          ...firstSnapshot.source.properties,
          account_balance: "75.00",
          account_balance_date: "2026-08-30T12:00:00.000Z",
          account_balance_date_epoch: 1_777_548_000,
          simplefin_account_extra: { available_balance: "65.00", status: "restricted" },
        },
      },
    };
    const changedAmount: MediaObject = {
      ...laterSnapshot,
      source: {
        ...laterSnapshot.source,
        properties: { ...laterSnapshot.source.properties, amount: "-12.35" },
      },
    };
    const changedTransactionExtra: MediaObject = {
      ...laterSnapshot,
      source: {
        ...laterSnapshot.source,
        properties: {
          ...laterSnapshot.source.properties,
          simplefin_transaction_extra: { category: "travel" },
        },
      },
    };

    expect(await candidateSemanticDigest(laterSnapshot)).toBe(
      await candidateSemanticDigest(firstSnapshot),
    );
    expect(await candidateSemanticDigest(changedAmount)).not.toBe(
      await candidateSemanticDigest(firstSnapshot),
    );
    expect(await candidateSemanticDigest(changedTransactionExtra)).not.toBe(
      await candidateSemanticDigest(firstSnapshot),
    );
    expect(laterSnapshot.source.properties).toMatchObject({
      account_balance: "75.00",
      account_balance_date: "2026-08-30T12:00:00.000Z",
      account_balance_date_epoch: 1_777_548_000,
      simplefin_account_extra: { available_balance: "65.00", status: "restricted" },
    });
  });

  test("semantic digests bind staged element bytes without binding allocated UUIDs", async () => {
    const first: MediaObject = {
      ...firstCandidate,
      type: "document",
      elements: ["rnet://element/0198f2a1-a005-7a05-8005-000000000005"],
      keys: { external_id: "42" },
      source: {
        ...firstCandidate.source,
        retrieved_at: "2026-08-29T12:00:00.000Z",
      },
    };
    const recaptured: MediaObject = {
      ...first,
      uri: "rnet://object/0198f2a1-a006-7a06-8006-000000000006",
      elements: ["rnet://element/0198f2a1-a007-7a07-8007-000000000007"],
      source: {
        ...first.source,
        origins: ["rnet://origin/0198f2a1-a008-7a08-8008-000000000008"],
        retrieved_at: "2026-08-29T13:00:00.000Z",
      },
    };
    const manifest = {
      uri: first.elements[0]!,
      object_uri: first.uri,
      role: "content" as const,
      kind: "image" as const,
      mime: "image/png",
      byte_size: 4,
      content_hash: `sha256:${"a".repeat(64)}`,
      preview_url: "http://rhizome.test/preview/first",
    };
    const recapturedManifest = {
      ...manifest,
      uri: recaptured.elements[0]!,
      object_uri: recaptured.uri,
      preview_url: "http://rhizome.test/preview/second",
    };

    expect(await candidateSemanticDigest(first, [manifest])).toBe(
      await candidateSemanticDigest(recaptured, [recapturedManifest]),
    );
    expect(
      await candidateSemanticDigest(recaptured, [
        { ...recapturedManifest, content_hash: `sha256:${"b".repeat(64)}` },
      ]),
    ).not.toBe(await candidateSemanticDigest(first, [manifest]));
    expect(
      await candidateSemanticDigest(recaptured, [
        { ...recapturedManifest, role: "preview" as const },
      ]),
    ).not.toBe(await candidateSemanticDigest(first, [manifest]));
  });
});

describe("canonical JSON", () => {
  test("orders mixed keys by UTF-16 code units without locale collation", () => {
    const mixed = { "😀": 7, ä: 6, z: 5, a: 4, A: 3, "2": 2, "10": 1 };

    expect(canonicalJson(mixed)).toBe('{"10":1,"2":2,"A":3,"a":4,"z":5,"ä":6,"😀":7}');
  });
});
