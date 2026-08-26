import type { components } from "./generated/openapi.ts";

/**
 * Record shapes as the store actually serves them, taken from the served OpenAPI document
 * rather than from `@rnet/types`. The two agree — the document is generated from the same
 * schemas — but deriving from the document means a drift between store and protocol shows up
 * here as a type error instead of at runtime. Type-only, so nothing reaches the bundle.
 */
export type Vibe = components["schemas"]["Vibe"];
export type MediaObject = components["schemas"]["MediaObject"];
export type MediaElement = components["schemas"]["MediaElement"];
export type OriginArtifact = components["schemas"]["OriginArtifact"];
export type Grant = components["schemas"]["Grant"];

/**
 * A free-form property bag.
 *
 * `user.properties`, `source.properties`, and each inferred entry's `properties` are declared
 * in the canonical schemas as a bare `{"type": "object"}`, meaning any object.
 * `openapi-typescript` renders that as `{} & { [x: string]: undefined }` — a type permitting no
 * keys at all — so the generated shape is unusable even though the schema is maximally
 * permissive. The schemas are protocol, copied verbatim from `rnet/schemas`, and not ours to
 * widen. This module is where that mismatch is absorbed, and the only place a cast for it is
 * allowed.
 */
export type PropertyBag = Record<string, unknown>;

/** The owner-mutable block, with its property bag made usable. */
export type UserBlock = Omit<NonNullable<MediaObject["user"]>, "properties"> & {
  properties: PropertyBag;
};

/** One writer-and-task-keyed inference, with its property bag made usable. */
export type InferredEntry = Omit<NonNullable<MediaObject["inferred"]>[string], "properties"> & {
  properties: PropertyBag;
};
