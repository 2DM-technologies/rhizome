import { expect, test } from "bun:test";

import { payloadPresentation } from "../src/surfaces/payloadPresentation.ts";

test("selects browser-native payload renderers from MIME types", () => {
  expect(payloadPresentation("image/png")).toBe("image");
  expect(payloadPresentation("audio/mpeg")).toBe("audio");
  expect(payloadPresentation("video/mp4")).toBe("video");
  expect(payloadPresentation("text/plain; charset=utf-8")).toBe("text");
  expect(payloadPresentation("application/json")).toBe("text");
  expect(payloadPresentation("application/pdf")).toBe("document");
  expect(payloadPresentation("application/octet-stream")).toBe("download");
});
