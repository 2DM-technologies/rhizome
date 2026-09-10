import { describe, expect, test } from "bun:test";
import type { JSONSchema } from "json-schema-to-ts";
import { loadInferenceConfig } from "../src/inference/config.ts";
import { createModelConnectorRegistry } from "../src/inference/connector-registry.ts";
import { FakeModelConnector } from "../src/inference/fake-connector.ts";
import {
  ModelConnectorError,
  modelIdentity,
  parseModelTarget,
  type CompletionRequest,
  type ModelUsage,
} from "../src/inference/model-connector.ts";
import { LUNA_RATE_CARD, priceUsage } from "../src/inference/openai/rate-card.ts";
import { assertStructuredOutputSchema } from "../src/inference/structured-output-schema.ts";

const target = parseModelTarget("model:openai/gpt-5.6-luna");
const output = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: ["string", "null"], pattern: "^.{1,80}$" } },
} as const;
const usage: ModelUsage = {
  tokensIn: 1000,
  cachedTokensIn: 0,
  cacheWriteTokensIn: 0,
  tokensOut: 1000,
  reasoningTokensOut: 0,
  servedTier: "flex",
  servedTierRaw: "flex",
  tierAssumed: false,
  providerModel: target.name,
  providerRequestId: "fake",
  durationMs: 1,
  attempts: 1,
};
const request = (schema: JSONSchema = output): CompletionRequest => ({
  target,
  instructions: "Return structured output",
  input: "<data>{}</data>",
  schema,
  schemaName: "rhizome_test",
  effort: "low",
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  signal: new AbortController().signal,
  trace: { operationUuid: "test", call: 1 },
});

describe("inference boundary primitives", () => {
  test("parses qualified model targets and refuses other grammars", () => {
    expect(modelIdentity(target)).toBe("openai/gpt-5.6-luna");
    for (const value of [
      "gpt-5.6-luna",
      "openai/gpt-5.6-luna",
      "model:OpenAI/test",
      "model:openai/",
      "model:openai/a/b",
      `model:openai/${"x".repeat(129)}`,
    ])
      expect(() => parseModelTarget(value)).toThrow();
  });
  test("registry is optional and refuses a fake target it cannot serve at boot", () => {
    expect(createModelConnectorRegistry(undefined)).toBeUndefined();
    expect(createModelConnectorRegistry(loadInferenceConfig({}))).toBeUndefined();
    const config = loadInferenceConfig({ RHIZOME_USE_FAKE_INFERENCE_PROVIDER: "true" });
    expect(createModelConnectorRegistry(config)?.identity).toBe("openai/gpt-5.6-luna");
    expect(() =>
      createModelConnectorRegistry({ ...config, defaultTarget: "model:openai/unknown" }),
    ).toThrow("does not serve");
    expect(() =>
      createModelConnectorRegistry({ ...config, defaultTarget: "model:other/gpt-5.6-luna" }),
    ).toThrow("does not serve");
  });
  test("strict-subset checks inspect every nested schema without transforming it", () => {
    const before = JSON.stringify(output);
    expect(() => assertStructuredOutputSchema(output)).not.toThrow();
    expect(JSON.stringify(output)).toBe(before);
    for (const key of "$schema $id $ref $defs title default examples minLength maxLength uniqueItems patternProperties allOf oneOf not if then else".split(
      " ",
    )) {
      expect(() =>
        assertStructuredOutputSchema({
          ...output,
          properties: { name: { type: "string", [key]: "forbidden" } },
        } as JSONSchema),
      ).toThrow("Unsupported");
    }
    for (const schema of [
      { type: "array", items: output },
      { ...output, additionalProperties: true },
      { ...output, required: [] },
      { ...output, required: ["name", "name"] },
      { ...output, properties: { name: { type: "object", properties: {}, required: [] } } },
      { ...output, properties: { name: { type: "string", format: "uri" } } },
    ])
      expect(() => assertStructuredOutputSchema(schema as JSONSchema)).toThrow();
  });
  test("fake samples patterns and returns every batch ref once", async () => {
    const refs = Array.from({ length: 25 }, (_, index) => `o${index + 1}`);
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          minItems: 25,
          maxItems: 25,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ref", "result"],
            properties: {
              ref: { type: "string", enum: refs },
              result: { anyOf: [output, { type: "null" }] },
            },
          },
        },
      },
    } as const;
    const fake = new FakeModelConnector();
    const response = await fake.complete(request(schema));
    expect(
      (response.output as { results: { ref: string }[] }).results.map(({ ref }) => ref),
    ).toEqual(refs);
    expect(Number(fake.reportCost(response.usage, target).usd)).toBeGreaterThan(0);
    expect(fake.requests).toHaveLength(1);
    for (const pattern of [
      "^[a-z0-9][a-z0-9-]{0,31}$",
      "^[a-z0-9][a-z0-9 .'&-]{0,47}$",
      "^(/[^/~]*(~[01][^/~]*)*)+$",
      "^[\\s\\S]{1,600}$",
    ]) {
      const result = await fake.complete(
        request({ ...output, properties: { name: { type: "string", pattern } } }),
      );
      expect(new RegExp(pattern).test((result.output as { name: string }).name)).toBe(true);
    }
  });
  test("fake accepts scripted output and billable failures and rejects schema misses with usage", async () => {
    const fake = new FakeModelConnector({
      respond: () => ({ output: { name: "scripted" }, usage }),
    });
    expect((await fake.complete(request())).output).toEqual({ name: "scripted" });
    const failure = new ModelConnectorError("provider_unavailable", { retryable: true, usage });
    await expect(
      new FakeModelConnector({ respond: () => failure }).complete(request()),
    ).rejects.toBe(failure);
    try {
      await new FakeModelConnector({
        respond: () => ({ output: { wrong: true }, usage }),
      }).complete(request());
      throw new Error("unexpected success");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelConnectorError);
      expect((error as ModelConnectorError).usage).toEqual(usage);
    }
  });
});

describe("Luna rate card", () => {
  test("1M input plus 1M output across short-context flex calls costs 0.700000", () => {
    // Each completion remains below the long-context threshold; aggregate token volume is 1M+1M.
    const call = priceUsage({ ...usage, tokensIn: 200_000, tokensOut: 200_000 }, target);
    expect((Number(call.usd) * 5).toFixed(6)).toBe("0.700000");
    expect(call.rateCard.longContext).toBe(false);
  });
  test("long-context threshold applies to the whole request", () => {
    expect(priceUsage({ ...usage, tokensIn: 272_000 }, target).rateCard.longContext).toBe(false);
    expect(priceUsage({ ...usage, tokensIn: 272_001 }, target).rateCard.longContext).toBe(true);
    expect(priceUsage({ ...usage, tokensIn: 1_000_000, tokensOut: 1_000_000 }, target).usd).toBe(
      "1.100000",
    );
  });
  test("prices the served tier, cached reads and cache writes with provenance", () => {
    expect(priceUsage(usage, target).usd).toBe("0.000700");
    expect(priceUsage({ ...usage, servedTier: "standard" }, target).usd).toBe("0.001400");
    expect(priceUsage({ ...usage, cachedTokensIn: 500, cacheWriteTokensIn: 100 }, target).usd).toBe(
      "0.000658",
    );
    expect(priceUsage(usage, target).rateCard.id).toBe(LUNA_RATE_CARD.id);
    expect(() => priceUsage(usage, { ...target, name: "unknown" })).toThrow("Unknown model");
  });
});
