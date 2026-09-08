import { describe, expect, test } from "bun:test";

import { mediaElementContentType, requestMime } from "../src/routes/http.ts";

describe("MediaElement response content types", () => {
  test("keeps stored MIME parameter-free", () => {
    expect(requestMime("text/plain; charset=windows-1252")).toBe("text/plain");
  });

  test("declares UTF-8 only for text-kind elements", () => {
    expect(mediaElementContentType("text", "text/plain")).toBe("text/plain; charset=utf-8");
    expect(mediaElementContentType("image", "image/png")).toBe("image/png");
    expect(mediaElementContentType("document", "text/plain")).toBe("text/plain");
  });
});
