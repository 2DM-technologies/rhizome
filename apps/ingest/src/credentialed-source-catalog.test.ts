import { describe, expect, test } from "bun:test";

import { createCredentialedSourceCatalog } from "./credentialed-source-catalog.ts";

describe("installed credentialed-source definitions", () => {
  test("keeps optional definitions absent when their operator settings are unavailable", () => {
    const catalog = createCredentialedSourceCatalog({
      simplefin: { allowedHosts: ["bridge.simplefin.test"] },
    });

    expect(catalog.all().map(({ skillId }) => skillId)).toEqual(["simplefin"]);
  });
});
