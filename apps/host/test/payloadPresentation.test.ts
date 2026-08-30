import { expect, test } from "bun:test";

import {
  payloadPresentation,
  primaryPayloadCandidate,
} from "../src/surfaces/payloadPresentation.ts";

test("selects browser-native payload renderers from MIME types", () => {
  expect(payloadPresentation("image/png")).toBe("image");
  expect(payloadPresentation("audio/mpeg")).toBe("audio");
  expect(payloadPresentation("video/mp4")).toBe("video");
  expect(payloadPresentation("text/plain; charset=utf-8")).toBe("text");
  expect(payloadPresentation("application/json")).toBe("text");
  expect(payloadPresentation("application/pdf")).toBe("document");
  expect(payloadPresentation("application/octet-stream")).toBe("download");
});

test("selects a generic primary payload by presentation and then source order", () => {
  const plainText = { element: { kind: "text", mime: "text/plain" }, index: 0 };
  const laterImage = { element: { kind: "image", mime: "image/png" }, index: 2 };
  const firstImage = { element: { kind: "image", mime: "image/jpeg" }, index: 1 };

  expect(primaryPayloadCandidate([plainText, laterImage, firstImage])).toBe(firstImage);
  expect(primaryPayloadCandidate([laterImage, firstImage])).toBe(firstImage);
});

test("prefers a natively renderable payload over inconsistent metadata", () => {
  const mismatchedImage = { element: { kind: "text", mime: "image/png" }, index: 0 };
  const plainText = { element: { kind: "text", mime: "text/plain" }, index: 1 };
  const genericDownload = {
    element: { kind: "document", mime: "application/octet-stream" },
    index: 2,
  };

  expect(primaryPayloadCandidate([mismatchedImage, plainText])).toBe(plainText);
  expect(primaryPayloadCandidate([genericDownload, mismatchedImage])).toBe(mismatchedImage);
  expect(primaryPayloadCandidate([])).toBeUndefined();
});
