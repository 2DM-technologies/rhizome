import { describe, expect, test } from "bun:test";
import { validateSchema, type MediaElement } from "@rnet/types";

import type { DbMediaElement } from "../src/db/models/media-element.ts";
import { serializeMediaElement } from "../src/serializers/media-element-serializer.ts";

const baseUrl = "http://rhizome.test";

const mediaElement: DbMediaElement = {
  uuid: "0198f2a1-a005-7a05-8005-000000000005",
  ownerUuid: "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
  contentHash: `sha256:${"a".repeat(64)}`,
  kind: "image",
  mime: "image/png",
  byteSize: 4,
  alt: null,
  inferred: {},
  rnetSchema: "0.1",
  createdAt: new Date("2026-08-29T12:00:00.000Z"),
  createdBy: "user:0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
  tombstonedAt: null,
};

describe("media element serializer", () => {
  test("omits alt and inferred when the record carries neither", () => {
    const document = serializeMediaElement(mediaElement, baseUrl);
    const validation = validateSchema("media-element", document);
    if (!validation.ok) expect(validation.issues).toEqual([]);
    expect(document).not.toHaveProperty("alt");
    expect(document).not.toHaveProperty("inferred");
  });

  test("emits alt as the element's own description", () => {
    const document = serializeMediaElement({ ...mediaElement, alt: "A synthetic pixel" }, baseUrl);
    const validation = validateSchema("media-element", document);
    if (!validation.ok) expect(validation.issues).toEqual([]);
    expect(document.alt).toBe("A synthetic pixel");
  });

  test("a MediaElement document with an inferred entry conforms to its schema", () => {
    const inferred: NonNullable<MediaElement["inferred"]> = {
      "rhizome:describe": {
        model: "synthetic-vision-1",
        inferred_at: "2026-08-29T12:05:00.000Z",
        properties: { caption: "A single pixel on a white ground" },
        confidence: 0.5,
      },
    };
    const document = serializeMediaElement({ ...mediaElement, inferred }, baseUrl);
    const validation = validateSchema("media-element", document);
    if (!validation.ok) expect(validation.issues).toEqual([]);
    expect(document.inferred).toEqual(inferred);
  });
});
