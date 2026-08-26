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

/** The owner-mutable block: revision-protected, writable with `write:user`. */
export type UserBlock = NonNullable<MediaObject["user"]>;

/** One inference, keyed by `{writer}:{task}` and carrying its own model and provenance. */
export type InferredEntry = NonNullable<MediaObject["inferred"]>[string];

/**
 * A free-form property bag — what the schemas mean by a bare `{"type": "object"}`. The
 * generator maps those to this shape, so reads and writes both use it without a cast.
 */
export type PropertyBag = Record<string, unknown>;
