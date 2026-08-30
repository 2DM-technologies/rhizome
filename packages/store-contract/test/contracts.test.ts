import { describe, expect, test } from "bun:test";
import { mediaObjectSchema, vibeSchema } from "@rnet/types/schemas";

import {
  STORE_SCHEMA_COMPONENTS,
  clientCreateMediaObjectInputSchema,
  clientCreateMediaObjectsRequestSchema,
  createCredentialIngestionSourceRequestSchema,
  createFileIngestionSourceRequestSchema,
  createImportPreviewRequestSchema,
  createIngestionSourceRequestSchema,
  createMediaObjectsRequestSchema,
  createVibeRequestSchema,
  fileIngestionSourceDocumentSchema,
  credentialIngestionSourceDocumentSchema,
  ingestionSourceDocumentSchema,
  mediaObjectsResponseSchema,
  ownerCreateMediaObjectInputSchema,
  ownerCreateMediaObjectsRequestSchema,
  setMediaObjectUserRequestSchema,
  reviewImportContinuationRequestSchema,
  sourceActionRequiredSchema,
  sourceSkillManifestSchema,
  sourceSkillManifestsResponseSchema,
  sourceCredentialDocumentSchema,
  type OwnerCreateMediaObjectsRequest,
  vibesResponseSchema,
} from "../src/index.ts";
import { makeOwnerCreateMediaObjectsFormData } from "../src/multipart.ts";

describe("shared store schemas", () => {
  test("reuse canonical rNet schema fragments by identity", () => {
    expect(createVibeRequestSchema.properties.title).toBe(vibeSchema.properties.title);
    expect(ownerCreateMediaObjectInputSchema.properties.source).toBe(
      mediaObjectSchema.properties.source,
    );
    expect(clientCreateMediaObjectInputSchema.properties.properties).toBe(
      mediaObjectSchema.properties.source.properties.properties,
    );
    expect(setMediaObjectUserRequestSchema.properties.properties).toBe(
      mediaObjectSchema.properties.user.properties.properties,
    );
  });

  test("keeps both actor branches in one canonical creation schema", () => {
    expect(createMediaObjectsRequestSchema.oneOf).toEqual([
      ownerCreateMediaObjectsRequestSchema,
      clientCreateMediaObjectsRequestSchema,
    ]);
  });

  test("uses canonical rNet document references in response envelopes", () => {
    expect(vibesResponseSchema.properties.vibes.items.$ref).toBe(vibeSchema.$id);
    expect(mediaObjectsResponseSchema.properties.mediaObjects.items.$ref).toBe(
      mediaObjectSchema.$id,
    );
  });

  test("registers stable component names without cloning schema objects", () => {
    expect(STORE_SCHEMA_COMPONENTS.CreateVibeRequest).toBe(createVibeRequestSchema);
    expect(STORE_SCHEMA_COMPONENTS.CreateMediaObjectsRequest).toBe(createMediaObjectsRequestSchema);
    expect(STORE_SCHEMA_COMPONENTS.CreateIngestionSourceRequest).toBe(
      createIngestionSourceRequestSchema,
    );
    expect(STORE_SCHEMA_COMPONENTS.CreateImportPreviewRequest).toBe(
      createImportPreviewRequestSchema,
    );
    expect(createImportPreviewRequestSchema.properties.continuation_token).toBe(
      reviewImportContinuationRequestSchema.properties.continuation_token,
    );
    expect(STORE_SCHEMA_COMPONENTS.SourceSkillManifestsResponse).toBe(
      sourceSkillManifestsResponseSchema,
    );
    expect(STORE_SCHEMA_COMPONENTS.SourceActionRequired).toBe(sourceActionRequiredSchema);
    expect(STORE_SCHEMA_COMPONENTS.SourceCredential).toBe(sourceCredentialDocumentSchema);
    expect(Object.values(STORE_SCHEMA_COMPONENTS).every((schema) => !("$id" in schema))).toBe(true);
  });

  test("selects file sources by skill and pins their resolved implementation versions", () => {
    expect(createIngestionSourceRequestSchema.oneOf).toContain(
      createFileIngestionSourceRequestSchema,
    );
    expect(ingestionSourceDocumentSchema.oneOf).toContain(fileIngestionSourceDocumentSchema);
    expect(createFileIngestionSourceRequestSchema.required).toEqual(["origin", "skill_id"]);
    expect(createFileIngestionSourceRequestSchema.properties).not.toHaveProperty("parser");
    expect(fileIngestionSourceDocumentSchema.properties).toMatchObject({
      kind: { const: "origin" },
      skill_id: { type: "string" },
      connector_version: { type: "string", minLength: 1 },
      parser: { type: "string", minLength: 1 },
      parser_version: { type: "string", minLength: 1 },
    });
    expect(fileIngestionSourceDocumentSchema.properties).not.toHaveProperty("credential");
    expect(fileIngestionSourceDocumentSchema.properties).not.toHaveProperty("provider");
  });

  test("keeps provider secrets out of generic credential and source documents", () => {
    expect(createIngestionSourceRequestSchema.oneOf).toContain(
      createCredentialIngestionSourceRequestSchema,
    );
    expect(ingestionSourceDocumentSchema.oneOf).toContain(credentialIngestionSourceDocumentSchema);
    expect(sourceCredentialDocumentSchema.properties.skill_id).toMatchObject({ type: "string" });
    expect(sourceCredentialDocumentSchema.required).toContain("connector_version");
    expect(sourceCredentialDocumentSchema.properties.connector_version).toEqual({
      type: "string",
      minLength: 1,
    });
    expect(createCredentialIngestionSourceRequestSchema.properties).toHaveProperty("credential");
    expect(credentialIngestionSourceDocumentSchema.properties).not.toHaveProperty("credential");
    expect(credentialIngestionSourceDocumentSchema.properties.parser_version).toEqual({
      type: "string",
      minLength: 1,
    });
    expect(credentialIngestionSourceDocumentSchema.properties.connector_version).toEqual({
      type: "string",
      minLength: 1,
    });
  });

  test("describes source skills and recovery without provider-specific fields", () => {
    expect(sourceSkillManifestSchema.properties).toMatchObject({
      skill_id: { type: "string" },
      source_kind: { enum: ["file", "public_remote", "credentialed_remote"] },
      connector_version: { type: "string" },
      parser: { type: "object" },
      connection: { type: "object" },
      input_fields: { type: "array" },
      review_actions: { type: "array" },
    });
    expect(sourceActionRequiredSchema.properties).toMatchObject({
      kind: { const: "source_action_required" },
      action: { enum: ["review_import"] },
      continuation_token: { type: "string" },
    });
    expect(sourceActionRequiredSchema.properties).not.toHaveProperty("rebaseline");
    expect(sourceCredentialDocumentSchema.properties).not.toHaveProperty("secret");
  });
});

describe("multipart creation request", () => {
  test("encodes typed metadata and named upload parts", async () => {
    const metadata: OwnerCreateMediaObjectsRequest = {
      objects: [
        {
          type: "receipt",
          source: {
            ingest: {
              method: "authored" as const,
              reproducible: false,
            },
            origins: ["rnet://client/0198eaf0-4cb3-7000-8000-000000000001"],
            properties: {},
          },
          elements: [{ upload: "scan", kind: "document" as const, mime: "image/png" }],
        },
      ],
    };
    const upload = new Blob(["png"], { type: "image/png" });

    const formData = makeOwnerCreateMediaObjectsFormData({
      ...metadata,
      uploads: { scan: upload },
    });

    expect(JSON.parse(String(formData.get("metadata")))).toEqual(metadata);
    const encodedUpload = formData.get("scan");
    expect(encodedUpload).toBeInstanceOf(Blob);
    expect(await (encodedUpload as Blob).text()).toBe("png");
  });

  test("rejects the reserved metadata upload key", () => {
    expect(() =>
      makeOwnerCreateMediaObjectsFormData({
        objects: [],
        uploads: { metadata: new Blob() },
      }),
    ).toThrow('The upload key "metadata" is reserved');
  });
});
