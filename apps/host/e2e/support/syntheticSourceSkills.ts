import { fileURLToPath } from "node:url";
import type { MediaObject } from "@rnet/types";
import type { SourceSkillManifest } from "@rhizome/store-contract";

import syntheticSourceFixture from "../fixtures/synthetic-source.json";
import {
  OWNER_ID,
  type MockOriginUpload,
  type MockSourceCaptureContext,
  type MockSourceSkillAdapter,
  type MockStagedImport,
} from "./mockStore.ts";

export const SYNTHETIC_FILE_SOURCE_ID = "0198f2a1-1001-7101-8101-000000000001";
export const SYNTHETIC_FILE_OPERATION_ID = "0198f2a1-1002-7102-8102-000000000001";
export const SYNTHETIC_FILE_ORIGIN_ID = "0198f2a1-1003-7103-8103-000000000001";
export const SYNTHETIC_PUBLIC_SOURCE_ID = "0198f2a1-1101-7201-8201-000000000001";
export const SYNTHETIC_PUBLIC_OPERATION_ID = "0198f2a1-1102-7202-8202-000000000001";
export const SYNTHETIC_CREDENTIAL_SOURCE_ID = "0198f2a1-1201-7301-8301-000000000001";
export const SYNTHETIC_CREDENTIAL_OPERATION_ID = "0198f2a1-1202-7302-8302-000000000001";
export const SYNTHETIC_CREDENTIAL_ID = "0198f2a1-1203-7303-8303-000000000001";

export const SYNTHETIC_FILE_SKILL_LABEL = "Synthetic file source";
export const SYNTHETIC_FILE_INPUT_LABEL = "Synthetic source document";
export const SYNTHETIC_PUBLIC_SKILL_LABEL = "Synthetic public source";
export const SYNTHETIC_PUBLIC_INPUT_LABEL = "Synthetic public URL";
export const SYNTHETIC_PUBLIC_URL = "https://source.invalid/synthetic-records";
export const SYNTHETIC_CREDENTIAL_SKILL_LABEL = "Synthetic credentialed source";
export const SYNTHETIC_CREDENTIAL_INPUT_LABEL = "Synthetic access token";
export const SYNTHETIC_COLLECTION_INPUT_LABEL = "Synthetic collection";
export const SYNTHETIC_COLLECTION = "browser-conformance";
export const SYNTHETIC_VALID_SECRET = "valid-synthetic-test-secret";
export const SYNTHETIC_INVALID_SECRET = "rejected-synthetic-test-secret";
export const SYNTHETIC_SOURCE_ACTION_TITLE = "Synthetic source needs review";
export const SYNTHETIC_SOURCE_ACTION_DETAIL =
  "The synthetic source changed its record boundary. Review the staged records to continue.";

export const SYNTHETIC_FILE_FIXTURE = fileURLToPath(
  new URL("../fixtures/synthetic-source.json", import.meta.url),
);

export const syntheticFileSourceSkillManifest = {
  skill_id: "synthetic-file",
  label: SYNTHETIC_FILE_SKILL_LABEL,
  description: "Choose a small synthetic document and review its generic records before import.",
  source_kind: "file",
  connector_version: "synthetic-file@1.0.0",
  parser: { name: "synthetic-records", version: "1.0.0" },
  input_fields: [
    {
      name: "file",
      label: SYNTHETIC_FILE_INPUT_LABEL,
      target: "source",
      control: "file",
      required: true,
      secret: false,
      accept: [".json", "application/json"],
    },
  ],
  review_actions: ["review_import"],
} as const satisfies SourceSkillManifest;

export const syntheticPublicSourceSkillManifest = {
  skill_id: "synthetic-public",
  label: SYNTHETIC_PUBLIC_SKILL_LABEL,
  description: "Capture generic records from a synthetic public endpoint and review them.",
  source_kind: "public_remote",
  connector_version: "synthetic-public@1.0.0",
  parser: { name: "synthetic-records", version: "1.0.0" },
  input_fields: [
    {
      name: "url",
      label: SYNTHETIC_PUBLIC_INPUT_LABEL,
      target: "source",
      control: "url",
      required: true,
      secret: false,
      placeholder: SYNTHETIC_PUBLIC_URL,
    },
    {
      name: "include_archived",
      label: "Include archived records",
      target: "source",
      control: "checkbox",
      required: false,
      secret: false,
    },
  ],
  review_actions: ["review_import", "refresh_source"],
} as const satisfies SourceSkillManifest;

export const syntheticCredentialedSourceSkillManifest = {
  skill_id: "synthetic-credentialed",
  label: SYNTHETIC_CREDENTIAL_SKILL_LABEL,
  description:
    "Connect a synthetic secret, capture generic records, and review them before import.",
  source_kind: "credentialed_remote",
  connector_version: "synthetic-credentialed@1.0.0",
  parser: { name: "synthetic-records", version: "1.0.0" },
  connection: {
    claim_policy: { kind: "single_use_global", attempts: 3, window_hours: 1 },
  },
  input_fields: [
    {
      name: "access_token",
      label: SYNTHETIC_CREDENTIAL_INPUT_LABEL,
      target: "connection",
      control: "text",
      required: true,
      secret: true,
      placeholder: "Paste synthetic access token",
    },
    {
      name: "collection",
      label: SYNTHETIC_COLLECTION_INPUT_LABEL,
      target: "source",
      control: "text",
      required: false,
      secret: false,
      placeholder: SYNTHETIC_COLLECTION,
    },
  ],
  review_actions: ["review_import", "refresh_source"],
} as const satisfies SourceSkillManifest;

export const mockSyntheticFileSourceSkill = {
  manifest: syntheticFileSourceSkillManifest,
  operationId: SYNTHETIC_FILE_OPERATION_ID,
  originUpload: {
    contentHash: `sha256:${"1".repeat(64)}`,
    id: SYNTHETIC_FILE_ORIGIN_ID,
    accepts({ label, mime }) {
      return label.toLocaleLowerCase().endsWith(".json") || mime === "application/json";
    },
  },
  sourceId: SYNTHETIC_FILE_SOURCE_ID,
  stage: ({ actionResumed, origin }) =>
    stageSyntheticRecords({
      actionResumed,
      operationId: SYNTHETIC_FILE_OPERATION_ID,
      origin,
      skillId: syntheticFileSourceSkillManifest.skill_id,
    }),
} satisfies MockSourceSkillAdapter;

export const mockSyntheticPublicSourceSkill = {
  manifest: syntheticPublicSourceSkillManifest,
  operationId: SYNTHETIC_PUBLIC_OPERATION_ID,
  sourceId: SYNTHETIC_PUBLIC_SOURCE_ID,
  capture: (context) => captureSyntheticFixture(context, "public"),
  normalizeConfig(input) {
    if (!isRecord(input) || typeof input.url !== "string") {
      return { ok: false, detail: `${SYNTHETIC_PUBLIC_INPUT_LABEL} is required` };
    }
    try {
      const url = new URL(input.url);
      if (url.protocol !== "https:") throw new Error("unsupported protocol");
      return { ok: true, value: { url: url.toString() } };
    } catch {
      return { ok: false, detail: "Enter a valid HTTPS synthetic public URL" };
    }
  },
  stage: ({ actionResumed, origin }) =>
    stageSyntheticRecords({
      actionResumed,
      operationId: SYNTHETIC_PUBLIC_OPERATION_ID,
      origin,
      skillId: syntheticPublicSourceSkillManifest.skill_id,
    }),
} satisfies MockSourceSkillAdapter;

export const mockSyntheticCredentialedSourceSkill = {
  credentialId: SYNTHETIC_CREDENTIAL_ID,
  manifest: syntheticCredentialedSourceSkillManifest,
  operationId: SYNTHETIC_CREDENTIAL_OPERATION_ID,
  sourceId: SYNTHETIC_CREDENTIAL_SOURCE_ID,
  sourceAction: {
    title: SYNTHETIC_SOURCE_ACTION_TITLE,
    detail: SYNTHETIC_SOURCE_ACTION_DETAIL,
    operationError: "The synthetic source refresh needs owner review before it can continue.",
  },
  capture: (context) => captureSyntheticFixture(context, "credentialed"),
  connect(input) {
    if (!isRecord(input) || typeof input.access_token !== "string" || !input.access_token) {
      return { ok: false, detail: `${SYNTHETIC_CREDENTIAL_INPUT_LABEL} is required` };
    }
    return input.access_token === SYNTHETIC_VALID_SECRET
      ? { ok: true, publicMetadata: { connection: "synthetic" } }
      : { ok: false, detail: "The synthetic source rejected this access token" };
  },
  normalizeConfig(input) {
    if (input === undefined) return { ok: true, value: {} };
    if (!isRecord(input)) {
      return { ok: false, detail: "Synthetic source configuration must be an object" };
    }
    if (input.collection !== undefined && typeof input.collection !== "string") {
      return { ok: false, detail: "Synthetic collection must be text" };
    }
    return {
      ok: true,
      value:
        typeof input.collection === "string" && input.collection
          ? { collection: input.collection }
          : {},
    };
  },
  stage: ({ actionResumed, origin }) =>
    stageSyntheticRecords({
      actionResumed,
      operationId: SYNTHETIC_CREDENTIAL_OPERATION_ID,
      origin,
      skillId: syntheticCredentialedSourceSkillManifest.skill_id,
    }),
} satisfies MockSourceSkillAdapter;

function captureSyntheticFixture(
  context: MockSourceCaptureContext,
  kind: "public" | "credentialed",
) {
  const skillId =
    kind === "public"
      ? syntheticPublicSourceSkillManifest.skill_id
      : syntheticCredentialedSourceSkillManifest.skill_id;
  const sequence = context.nextSequence(skillId);
  const namespace = kind === "public" ? "0198f2a1-1103-7203-8203" : "0198f2a1-1204-7304-8304";
  return context.save({
    id: `${namespace}-${String(sequence).padStart(12, "0")}`,
    payload: JSON.stringify(syntheticSourceFixture),
    contentHash: `sha256:${String(sequence).padStart(64, kind === "public" ? "2" : "3")}`,
    label: `${kind}-synthetic-records-${sequence}.json`,
    mime: "application/json",
  });
}

function stageSyntheticRecords({
  actionResumed,
  operationId,
  origin,
  skillId,
}: {
  actionResumed: boolean;
  operationId: string;
  origin: MockOriginUpload;
  skillId: string;
}): MockStagedImport {
  const fixture = parseSyntheticFixture(origin.payload);
  const candidates = fixture.records.map((record, index): MediaObject => ({
    rnet_schema: "0.1",
    uri: `rnet://object/${indexedUuid(operationId, index)}`,
    owner: `rnet://id/${OWNER_ID}`,
    type: "synthetic.record",
    elements: [],
    keys: { synthetic_id: record.id },
    source: {
      ingest: { method: "parser", reproducible: true, skill: `${skillId}@test` },
      origins: [origin.document.uri],
      properties: {
        title: record.title,
        body: record.body,
        synthetic_id: record.id,
      },
    },
  }));
  return {
    candidates,
    verification: {
      ok: true,
      source_record_count: fixture.records.length,
      candidate_count: candidates.length,
      totals_by_currency: {},
      checks: [
        {
          name: "record_count",
          ok: fixture.records.length === candidates.length,
          detail: `${candidates.length} synthetic records produced ${candidates.length} candidates`,
        },
        {
          name: "stable_record_ids",
          ok: new Set(fixture.records.map(({ id }) => id)).size === fixture.records.length,
          detail: "Synthetic record identifiers are unique",
        },
        ...(actionResumed
          ? [
              {
                name: "owner_review",
                ok: true,
                detail: "The owner resumed this reviewed source action",
              },
            ]
          : []),
      ],
    },
  };
}

function parseSyntheticFixture(payload: Buffer): SyntheticFixture {
  const parsed: unknown = JSON.parse(payload.toString("utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.records)) {
    throw new Error("Synthetic fixture must contain records");
  }
  const records = parsed.records.map((record) => {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.title !== "string" ||
      typeof record.body !== "string"
    ) {
      throw new Error("Synthetic fixture records must contain id, title, and body text");
    }
    return { id: record.id, title: record.title, body: record.body };
  });
  return { records };
}

function indexedUuid(namespace: string, index: number): string {
  return `${namespace.slice(0, -12)}${String(index + 1).padStart(12, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SyntheticFixture {
  records: Array<{ id: string; title: string; body: string }>;
}
