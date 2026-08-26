/**
 * Query keys, in one place, because the interesting part is not the keys but what invalidates
 * what. The store's resources overlap: a Vibe holds object references, so creating an object
 * in a Vibe changes that Vibe's object list, and adding an existing object to a Vibe changes
 * the Vibe itself. Mutations invalidate through this module so those edges are stated once.
 */
export const keys = {
  vibes: {
    all: ["vibes"] as const,
    list: () => ["vibes", "list"] as const,
    detail: (uuid: string) => ["vibes", "detail", uuid] as const,
    objects: (uuid: string) => ["vibes", "detail", uuid, "objects"] as const,
  },
  objects: {
    all: ["objects"] as const,
    detail: (uuid: string) => ["objects", "detail", uuid] as const,
  },
  elements: {
    all: ["elements"] as const,
    detail: (uuid: string) => ["elements", "detail", uuid] as const,
  },
  origins: {
    all: ["origins"] as const,
    detail: (uuid: string) => ["origins", "detail", uuid] as const,
  },
  payloads: {
    /** Object URLs for authenticated payload bytes, keyed by kind and record. */
    bytes: (kind: "elements" | "origins", uuid: string) => ["payload", kind, uuid] as const,
  },
} as const;
