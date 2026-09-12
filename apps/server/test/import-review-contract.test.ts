import { expect, test } from "bun:test";
import {
  createImportPreviewRequestSchema,
  createPendingVibeImportRequestSchema,
} from "@rhizome/store-contract";
import { jsonSchema } from "../src/routes/contracts.ts";

const source = "source:0198f2a1-abcd-7abc-8abc-000000000001";
const replacement_origin = "rnet://origin/0198f2a1-abcd-7abc-8abc-000000000002";
const existing = jsonSchema(createImportPreviewRequestSchema);
const pending = jsonSchema(createPendingVibeImportRequestSchema);

test("replacement export is an existing-import action with a canonical origin reference", () => {
  expect(existing.validate({ source, replacement_origin }).ok).toBe(true);
  expect(
    existing.validate({ source, replacement_origin: "https://strava.example/export.zip" }).ok,
  ).toBe(false);
  expect(
    existing.validate({
      source,
      replacement_origin: replacement_origin.replace("origin", "object"),
    }).ok,
  ).toBe(false);
  expect(
    existing.validate({ source, replacement_origin, continuation_token: "x".repeat(64) }).ok,
  ).toBe(false);
  expect(pending.validate({ source, replacement_origin }).ok).toBe(false);
});

test("ordinary previews and pending imports keep accepting sources and reviewed continuations", () => {
  for (const contract of [existing, pending]) {
    expect(contract.validate({ source }).ok).toBe(true);
    expect(contract.validate({ source, continuation_token: "x".repeat(64) }).ok).toBe(true);
    expect(contract.validate({ source, user: { properties: { forged: true } } }).ok).toBe(false);
  }
});
