import { describe, expect, test } from "bun:test";
import { mediaObjectSchema, vibeSchema } from "@rnet/types/schemas";

import {
  ARENA_CHANNEL_SLUG_MAX_LENGTH,
  ARENA_PARSER_NAME,
  ARENA_PROVIDER,
  STORE_SCHEMA_COMPONENTS,
  arenaIngestionSourceDocumentSchema,
  arenaSourceConfigSchema,
  clientCreateMediaObjectInputSchema,
  clientCreateMediaObjectsRequestSchema,
  connectSimpleFinRequestSchema,
  createArenaIngestionSourceRequestSchema,
  createImportPreviewRequestSchema,
  createIngestionSourceRequestSchema,
  createSimpleFinIngestionSourceRequestSchema,
  createMediaObjectsRequestSchema,
  createVibeRequestSchema,
  mediaObjectsResponseSchema,
  ownerCreateMediaObjectInputSchema,
  ownerCreateMediaObjectsRequestSchema,
  setMediaObjectUserRequestSchema,
  simpleFinIngestionSourceDocumentSchema,
  simpleFinSourceConfigSchema,
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
    expect(STORE_SCHEMA_COMPONENTS.ConnectSimpleFinRequest).toBe(connectSimpleFinRequestSchema);
    expect(STORE_SCHEMA_COMPONENTS.SourceCredential).toBe(sourceCredentialDocumentSchema);
    expect(Object.values(STORE_SCHEMA_COMPONENTS).every((schema) => !("$id" in schema))).toBe(true);
  });

  test("keeps SimpleFIN secrets out of credential and source documents", () => {
    expect(connectSimpleFinRequestSchema.properties).toHaveProperty("setup_token");
    expect(createSimpleFinIngestionSourceRequestSchema.properties).toHaveProperty("credential");
    expect(sourceCredentialDocumentSchema.properties).not.toHaveProperty("secret");
    expect(sourceCredentialDocumentSchema.properties).not.toHaveProperty("access_url");
    expect(simpleFinIngestionSourceDocumentSchema.properties).not.toHaveProperty("credential");
    expect(simpleFinIngestionSourceDocumentSchema.properties.parser_version).toEqual({
      type: "string",
      minLength: 1,
    });
    expect(simpleFinSourceConfigSchema.properties.accounts.minItems).toBe(1);
  });

  test("keeps public Are.na locators normalized and credential-free", () => {
    expect(createArenaIngestionSourceRequestSchema).toMatchObject({
      required: ["provider", "channel_url"],
      properties: {
        provider: { const: ARENA_PROVIDER },
        channel_url: { type: "string" },
      },
      additionalProperties: false,
    });
    expect(arenaSourceConfigSchema).toMatchObject({
      required: ["channel_slug"],
      properties: {
        channel_slug: { maxLength: ARENA_CHANNEL_SLUG_MAX_LENGTH },
      },
      additionalProperties: false,
    });
    expect(arenaIngestionSourceDocumentSchema.properties).toMatchObject({
      kind: { const: "remote" },
      provider: { const: ARENA_PROVIDER },
      parser: { const: ARENA_PARSER_NAME },
      config: arenaSourceConfigSchema,
    });
    expect(arenaIngestionSourceDocumentSchema.properties).not.toHaveProperty("origin");
    expect(arenaIngestionSourceDocumentSchema.properties).not.toHaveProperty("credential");
    expect(arenaIngestionSourceDocumentSchema.properties).not.toHaveProperty("channel_url");
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
