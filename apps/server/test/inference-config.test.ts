import { describe, expect, test } from "bun:test";
import { loadInferenceConfig } from "../src/inference/config.ts";
import { loadOpenAIProviderSettings } from "../src/inference/openai/config.ts";

describe("inference configuration", () => {
  test("all settings are optional and keyless configuration has no provider", () => {
    expect(loadInferenceConfig({})).toEqual({
      defaultTarget: "model:openai/gpt-5.6-luna",
      useFake: false,
    });
    expect(loadOpenAIProviderSettings({ OPENAI_API_KEY: " " })).toBeUndefined();
  });
  test("loads provider settings only inside inference and keeps a configured target", () => {
    expect(
      loadInferenceConfig({
        OPENAI_API_KEY: " test-key ",
        OPENAI_BASE_URL: "https://provider.test/",
        RHIZOME_PUSH_DEFAULT_TARGET: "model:openai/gpt-5.6-luna",
      }),
    ).toEqual({
      defaultTarget: "model:openai/gpt-5.6-luna",
      useFake: false,
      openai: { apiKey: "test-key", baseUrl: "https://provider.test" },
    });
    expect(loadOpenAIProviderSettings({ OPENAI_API_KEY: "test" })?.baseUrl).toBe(
      "https://api.openai.com",
    );
    for (const baseUrl of [
      "not-url",
      "file:///etc",
      "https://user:secret@provider.test",
      "https://provider.test/?secret=x",
      "https://provider.test/#fragment",
    ]) {
      expect(() =>
        loadOpenAIProviderSettings({ OPENAI_API_KEY: "test", OPENAI_BASE_URL: baseUrl }),
      ).toThrow();
    }
  });
  test("fake is explicit, allowed locally and refused in production", () => {
    expect(loadInferenceConfig({ RHIZOME_USE_FAKE_INFERENCE_PROVIDER: "true" }).useFake).toBe(true);
    expect(loadInferenceConfig({ RHIZOME_USE_FAKE_INFERENCE_PROVIDER: "false" }).useFake).toBe(
      false,
    );
    expect(() =>
      loadInferenceConfig({ NODE_ENV: "production", RHIZOME_USE_FAKE_INFERENCE_PROVIDER: "true" }),
    ).toThrow("forbidden in production");
  });
});
