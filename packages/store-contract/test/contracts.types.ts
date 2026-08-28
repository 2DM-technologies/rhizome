import type { MediaObject, Vibe } from "@rnet/types";
import type {
  ClientCreateMediaObjectsRequest,
  CreateVibeRequest,
  CreateMediaObjectsRequest,
  MediaObjectsResponse,
  OwnerCreateMediaObjectsRequest,
  ProblemCode,
  SetMediaObjectInferredRequest,
  SetMediaObjectUserRequest,
  VibesResponse,
} from "../src/index.ts";
import type { CreateMediaObjectsMultipartInput } from "../src/multipart.ts";

const source = {
  ingest: {
    method: "authored" as const,
    reproducible: false,
  },
  origins: ["rnet://client/0198eaf0-4cb3-7000-8000-000000000001"],
  properties: {},
};

const ownerRequest: OwnerCreateMediaObjectsRequest = {
  objects: [{ type: "receipt", source, "x-example": { retained: true } }],
};

const clientRequest: ClientCreateMediaObjectsRequest = {
  vibe: "rnet://vibe/0198eaf0-4cb3-7000-8000-000000000002",
  objects: [{ type: "note", properties: {}, "x-example": true }],
};

const requests: CreateMediaObjectsRequest[] = [ownerRequest, clientRequest];
const multipart: CreateMediaObjectsMultipartInput<OwnerCreateMediaObjectsRequest> = {
  ...ownerRequest,
  uploads: { scan: new Blob() },
};

const problemCode: ProblemCode = "schema_violation";
const vibes: VibesResponse = { vibes: [] };
const mediaObjects: MediaObjectsResponse = { mediaObjects: [] };

void [multipart, problemCode, vibes, mediaObjects];

const ownerWithArbitraryKey: OwnerCreateMediaObjectsRequest = {
  objects: [
    {
      type: "receipt",
      source,
      // @ts-expect-error Only x-* extension keys are permitted.
      arbitrary: true,
    },
  ],
};

// @ts-expect-error Removed transport codes are not part of the public vocabulary.
const invalidProblemCode: ProblemCode = "revision_conflict";

void [ownerWithArbitraryKey, invalidProblemCode];

const ownerWithInvalidIngest: OwnerCreateMediaObjectsRequest = {
  objects: [
    {
      type: "receipt",
      source: {
        // @ts-expect-error Canonical ingest records always declare reproducibility.
        ingest: { method: "authored" },
        origins: ["rnet://client/0198eaf0-4cb3-7000-8000-000000000001"],
        properties: {},
      },
    },
  ],
};

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type CanonicalUserRequest = Pick<NonNullable<MediaObject["user"]>, "properties">;
type CanonicalInferredEntry = NonNullable<MediaObject["inferred"]>[string];
type _UserRequestMatchesRnet = Assert<Equal<SetMediaObjectUserRequest, CanonicalUserRequest>>;
type _InferredEntryMatchesRnet = Assert<
  Equal<SetMediaObjectInferredRequest["entry"], CanonicalInferredEntry>
>;
type _OwnerSourceMatchesRnet = Assert<
  Equal<OwnerCreateMediaObjectsRequest["objects"][number]["source"], MediaObject["source"]>
>;
type _CreateVibeGrantsMatchRnet = Assert<Equal<CreateVibeRequest["grants"], Vibe["grants"]>>;
type _VibesResponseUsesRnet = Assert<Equal<VibesResponse["vibes"][number], Vibe>>;
type _MediaObjectsResponseUsesRnet = Assert<
  Equal<MediaObjectsResponse["mediaObjects"][number], MediaObject>
>;

void ownerWithInvalidIngest;
