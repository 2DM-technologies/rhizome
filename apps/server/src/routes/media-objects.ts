import {
  mediaElementSchema,
  mediaObjectSchema,
  TASK_PATTERN,
  validateMediaObjectProperties,
  vibeSchema,
} from "@rnet/types";

import type { BlobStore } from "../blobs/index.ts";
import type { Database } from "../db/index.ts";
import { Problem } from "../errors.ts";
import type { PendingMediaElementUpload } from "../services/media-element-service.ts";
import { MediaObjectsService } from "../services/media-object-service.ts";
import { schemaProblem } from "../services/problems.ts";
import { serializeMediaObject } from "../serializers/media-object-serializer.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  collectionOf,
  jsonObjectSchema,
  jsonSchema,
  jsonSchemaByActor,
  jsonSchemaValue,
  rnetDocument,
  withResponseHeaders,
  type ContractValue,
  type Namespaced,
} from "./contracts.ts";
import { requestMime } from "./http.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const MediaElementUploadReferenceSchema = {
  type: "object",
  required: ["upload", "kind", "mime"],
  properties: {
    upload: { type: "string", minLength: 1 },
    kind: mediaElementSchema.properties.kind,
    mime: mediaElementSchema.properties.mime,
  },
  additionalProperties: false,
} as const;

const MediaElementReferenceInputSchema = {
  anyOf: [mediaObjectSchema.properties.elements.items, MediaElementUploadReferenceSchema],
} as const;

const CreateMediaObjectBaseProperties = {
  type: mediaObjectSchema.properties.type,
  elements: { type: "array", items: MediaElementReferenceInputSchema },
  keys: mediaObjectSchema.properties.keys,
} as const;

const OwnerCreateMediaObjectInputSchema = {
  type: "object",
  required: ["type", "source"],
  properties: {
    ...CreateMediaObjectBaseProperties,
    source: mediaObjectSchema.properties.source,
  },
  patternProperties: mediaObjectSchema.patternProperties,
  additionalProperties: false,
} as const;

const ClientCreateMediaObjectInputSchema = {
  type: "object",
  required: ["type"],
  properties: {
    ...CreateMediaObjectBaseProperties,
    properties: mediaObjectSchema.properties.source.properties.properties,
  },
  patternProperties: mediaObjectSchema.patternProperties,
  additionalProperties: false,
} as const;

const OwnerCreateMediaObjectsRequestSchema = jsonSchema({
  type: "object",
  required: ["objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: {
      type: "array",
      minItems: 1,
      items: OwnerCreateMediaObjectInputSchema,
    },
  },
  additionalProperties: false,
});

const ClientCreateMediaObjectsRequestSchema = jsonSchema({
  type: "object",
  required: ["vibe", "objects"],
  properties: {
    vibe: vibeSchema.properties.uri,
    objects: {
      type: "array",
      minItems: 1,
      items: ClientCreateMediaObjectInputSchema,
    },
  },
  additionalProperties: false,
});

export const CreateMediaObjectsRequestSchema = jsonSchemaByActor({
  user: OwnerCreateMediaObjectsRequestSchema,
  client: ClientCreateMediaObjectsRequestSchema,
});

export type CreateMediaObjectsRequest = ContractValue<typeof CreateMediaObjectsRequestSchema>;
export type CreateMediaObjectInput = Namespaced<CreateMediaObjectsRequest["objects"][number]>;

/**
 * Where a create request carries the properties to validate against the registered type
 * vocabulary, and the JSON pointer to report against. Owners supply `source.properties`;
 * clients supply a bare `properties` and the store authors the surrounding source block.
 * Lives here so the two request shapes are only ever interpreted next to their schemas.
 */
export function mediaObjectPropertiesInput(input: CreateMediaObjectInput): {
  properties: Record<string, unknown>;
  pointer: string;
} {
  if ("source" in input) {
    return { properties: input.source.properties, pointer: "source/properties" };
  }
  return { properties: input.properties ?? {}, pointer: "properties" };
}

const MediaObjectDocumentSchema = rnetDocument("media-object");
/**
 * The `user` revision, quoted. A client reads it here and sends it back as `If-Match` on the
 * next `user` write, so it is contract, not incidental transport.
 */
const MediaObjectEtagHeaders = {
  etag: {
    type: "string",
    description: "Quoted `user` revision, for the `If-Match` of a subsequent write.",
  },
} as const;
const MediaObjectDocumentWithEtag = withResponseHeaders(
  MediaObjectDocumentSchema,
  MediaObjectEtagHeaders,
);
const MediaObjectCollectionSchema = collectionOf(MediaObjectDocumentSchema, "mediaObjects");
const SetMediaObjectUserRequestSchema = jsonSchema({
  type: "object",
  required: ["properties"],
  properties: { properties: { type: "object" } },
  additionalProperties: false,
});
/**
 * `If-Match` carries the `user` revision a write is conditioned on. It is declared so that it
 * reaches the OpenAPI document and generated clients, where it was previously invisible even
 * though the store requires it.
 *
 * Declared optional on purpose. The handler rejects a missing or unparseable revision with
 * 409 `revision_conflict`, which names what actually went wrong; making the header required
 * here would pre-empt that with a 422 schema violation about the request shape instead.
 */
const SetMediaObjectUserHeadersSchema = jsonObjectSchema(
  {
    "if-match": jsonSchemaValue<string>({
      type: "string",
      description:
        "Quoted `user` revision the write is conditioned on, as returned by the ETag of a " +
        "prior GET. Required in practice: a request without it is rejected with 409 " +
        "revision_conflict.",
    }),
  },
  [] as const,
);

const SetMediaObjectInferredRequestSchema = jsonSchema({
  type: "object",
  required: ["task", "entry"],
  properties: {
    task: { type: "string", pattern: TASK_PATTERN },
    entry: mediaObjectSchema.properties.inferred.additionalProperties,
  },
  additionalProperties: false,
});

export function createMediaObjectRoutes(db: Database, blobs: BlobStore) {
  const router = createRhizomeRouter();

  router.post(
    "/",
    {
      operationId: "createMediaObjects",
      auth: "user_or_client",
      request: { multipart: CreateMediaObjectsRequestSchema },
      responses: {
        201: MediaObjectCollectionSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        415: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const input = context.req.valid("form");
      for (const [index, mediaObject] of input.metadata.objects.entries()) {
        const { properties, pointer } = mediaObjectPropertiesInput(mediaObject);
        const validation = validateMediaObjectProperties(mediaObject.type, properties);
        if (!validation.ok) throw schemaProblem(validation.issues, `/objects/${index}/${pointer}`);
      }
      const pendingMediaElementUploads = new Map<string, PendingMediaElementUpload>();
      for (const [name, file] of input.uploads) {
        pendingMediaElementUploads.set(name, {
          bytes: new Uint8Array(await file.arrayBuffer()),
          ...(file.type ? { mime: requestMime(file.type) } : {}),
        });
      }
      const mediaObjectsService = new MediaObjectsService({
        db,
        actor: context.get("actor"),
        blobs,
      });
      const mediaObjectAggregates = await mediaObjectsService.createMediaObjects(
        input.metadata.vibe,
        input.metadata.objects,
        pendingMediaElementUploads,
      );
      const mediaObjects = mediaObjectAggregates.map(serializeMediaObject);
      return context.json({ mediaObjects }, 201);
    },
  );
  router.get(
    "/:id",
    {
      operationId: "getMediaObject",
      request: { param: RecordIdParamsSchema },
      responses: { 200: MediaObjectDocumentWithEtag, 422: ProblemSchema },
    },
    async (context) => {
      const mediaObjectsService = new MediaObjectsService({ db, actor: context.get("actor") });
      const result = await mediaObjectsService.getMediaObject(context.req.valid("param").id);
      const mediaObject = serializeMediaObject(result.mediaObject);
      context.header("ETag", `"${result.userRev}"`);
      return context.json(mediaObject);
    },
  );
  router.patch(
    "/:id/user",
    {
      operationId: "setMediaObjectUser",
      auth: "user_or_client",
      request: {
        param: RecordIdParamsSchema,
        header: SetMediaObjectUserHeadersSchema,
        json: SetMediaObjectUserRequestSchema,
      },
      responses: {
        200: MediaObjectDocumentWithEtag,
        401: ProblemSchema,
        403: ProblemSchema,
        409: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const header = context.req.header("If-Match");
      if (header === undefined) {
        throw new Problem(409, "revision_conflict", "Revision required", "If-Match is required");
      }
      const expectedRevision = Number(header.replaceAll('"', ""));
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new Problem(
          409,
          "revision_conflict",
          "Invalid revision",
          "If-Match must be an integer revision",
        );
      }
      const input = context.req.valid("json");
      const mediaObjectsService = new MediaObjectsService({ db, actor: context.get("actor") });
      const result = await mediaObjectsService.setUser(
        context.req.valid("param").id,
        expectedRevision,
        input.properties,
      );
      const mediaObject = serializeMediaObject(result.mediaObject);
      context.header("ETag", `"${result.userRev}"`);
      return context.json(mediaObject);
    },
  );
  router.put(
    "/:id/inferred",
    {
      operationId: "setMediaObjectInferred",
      auth: "user_or_client",
      request: { param: RecordIdParamsSchema, json: SetMediaObjectInferredRequestSchema },
      responses: {
        200: MediaObjectDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const input = context.req.valid("json");
      const mediaObjectsService = new MediaObjectsService({ db, actor: context.get("actor") });
      const mediaObjectAggregate = await mediaObjectsService.setInferred(
        context.req.valid("param").id,
        input.task,
        input.entry,
      );
      const mediaObject = serializeMediaObject(mediaObjectAggregate);
      return context.json(mediaObject);
    },
  );

  return router;
}
