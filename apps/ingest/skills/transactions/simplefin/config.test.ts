import { describe, expect, test } from "bun:test";

import { DEFAULT_SIMPLEFIN_ALLOWED_HOSTS, loadSimpleFinSettings } from "./config.ts";

describe("SimpleFIN settings", () => {
  test("uses the official hosts by default", () => {
    expect(loadSimpleFinSettings({}).allowedHosts).toEqual([...DEFAULT_SIMPLEFIN_ALLOWED_HOSTS]);
  });

  test("normalizes and deduplicates configured exact hostnames", () => {
    expect(
      loadSimpleFinSettings({
        RHIZOME_SIMPLEFIN_ALLOWED_HOSTS:
          "BRIDGE.SIMPLEFIN.TEST, bridge.simplefin.test, beta.simplefin.test",
      }).allowedHosts,
    ).toEqual(["bridge.simplefin.test", "beta.simplefin.test"]);
  });

  test("rejects empty or non-exact host configuration", () => {
    expect(() => loadSimpleFinSettings({ RHIZOME_SIMPLEFIN_ALLOWED_HOSTS: " , " })).toThrow(
      "at least one exact hostname",
    );

    for (const host of [
      "https://bridge.simplefin.org",
      "*.simplefin.org",
      "bridge.simplefin.org:443",
      "127.0.0.1",
      "localhost",
    ]) {
      expect(() => loadSimpleFinSettings({ RHIZOME_SIMPLEFIN_ALLOWED_HOSTS: host })).toThrow(
        "exact hostnames only",
      );
    }
  });
});
