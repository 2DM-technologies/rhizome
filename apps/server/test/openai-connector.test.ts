import { describe, expect, test } from "bun:test";
import type { JSONSchema } from "json-schema-to-ts";
import {
  ModelConnectorError,
  type CompletionRequest,
  type ModelConnectorErrorKind,
} from "../src/inference/model-connector.ts";
import { OpenAIConnector, type OpenAIFetch } from "../src/inference/openai/connector.ts";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string" } },
} as const satisfies JSONSchema;

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    target: { provider: "openai", name: "gpt-5.6-luna" },
    instructions: "instructions",
    input: "assembled input",
    schema,
    schemaName: "rhizome_test",
    effort: "high",
    maxOutputTokens: 321,
    timeoutMs: 10_000,
    signal: new AbortController().signal,
    trace: { operationUuid: "operation-1", call: 2 },
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_1",
    status: "completed",
    model: "gpt-5.6-luna-2026-08-01",
    service_tier: "flex",
    incomplete_details: null,
    output: [{ type: "message", content: [{ type: "output_text", text: '{"name":"ok"}' }] }],
    usage: {
      input_tokens: 40,
      input_tokens_details: { cached_tokens: 12 },
      cache_write_tokens: 3,
      output_tokens: 9,
      output_tokens_details: { reasoning_tokens: 4 },
    },
    ...overrides,
  };
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function connector(
  fetchImpl: OpenAIFetch,
  clock: { value: number } = { value: 1000 },
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void> = async (milliseconds) => {
    clock.value += milliseconds;
  },
) {
  return new OpenAIConnector(
    { apiKey: "secret-key", baseUrl: "https://example.test" },
    { fetch: fetchImpl, now: () => clock.value, sleep },
  );
}

async function expectKind(promise: Promise<unknown>, kind: ModelConnectorErrorKind) {
  try {
    await promise;
    throw new Error("Expected connector failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelConnectorError);
    expect((error as ModelConnectorError).kind).toBe(kind);
    expect((error as Error).message).not.toContain("secret provider body");
    return error as ModelConnectorError;
  }
}

describe("OpenAI Responses connector", () => {
  test("sends the exact flex structured-output request and maps usage", async () => {
    let init: RequestInit | undefined;
    let url: string | URL | Request | undefined;
    const client = connector(async (requestUrl, requestInit) => {
      url = requestUrl;
      init = requestInit;
      return response(envelope(), 200, { "x-request-id": "req_1" });
    });
    const result = await client.complete(request());
    expect(result.output).toEqual({ name: "ok" });
    expect(url).toBe("https://example.test/v1/responses");
    expect(result.usage).toEqual({
      tokensIn: 40,
      cachedTokensIn: 12,
      cacheWriteTokensIn: 3,
      tokensOut: 9,
      reasoningTokensOut: 4,
      servedTier: "flex",
      servedTierRaw: "flex",
      tierAssumed: false,
      providerModel: "gpt-5.6-luna-2026-08-01",
      providerRequestId: "req_1",
      durationMs: 0,
      attempts: 1,
    });
    expect(init?.headers).toEqual({
      authorization: "Bearer secret-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "gpt-5.6-luna",
      service_tier: "flex",
      store: false,
      instructions: "instructions",
      input: [{ role: "user", content: [{ type: "input_text", text: "assembled input" }] }],
      text: { format: { type: "json_schema", name: "rhizome_test", strict: true, schema } },
      reasoning: { effort: "high" },
      max_output_tokens: 321,
      metadata: { rhizome_operation: "operation-1" },
    });
  });

  test("normalizes missing, default, and unknown served tiers conservatively", async () => {
    const bodies = [
      envelope({ service_tier: undefined }),
      envelope({ service_tier: "default" }),
      envelope({ service_tier: "priority" }),
    ];
    const client = connector(async () => response(bodies.shift()));
    expect((await client.complete(request())).usage).toMatchObject({
      servedTier: "flex",
      servedTierRaw: null,
      tierAssumed: true,
      providerRequestId: null,
    });
    expect((await client.complete(request())).usage).toMatchObject({
      servedTier: "standard",
      servedTierRaw: "default",
      tierAssumed: false,
    });
    expect((await client.complete(request())).usage).toMatchObject({
      servedTier: "standard",
      servedTierRaw: "priority",
      tierAssumed: true,
    });
  });

  test("retries 429 then succeeds without escalating service tier", async () => {
    const bodies: string[] = [];
    let calls = 0;
    const client = connector(async (_url, init) => {
      bodies.push(init?.body as string);
      calls++;
      return calls === 1 ? response({ error: "secret provider body" }, 429) : response(envelope());
    });
    expect((await client.complete(request())).usage.attempts).toBe(2);
    expect(bodies.every((body) => JSON.parse(body).service_tier === "flex")).toBe(true);
  });

  test("maps every terminal HTTP status and never exposes response bodies", async () => {
    const cases: Array<[number, ModelConnectorErrorKind, number]> = [
      [401, "auth", 1],
      [403, "auth", 1],
      [400, "invalid_request", 1],
      [404, "invalid_request", 1],
      [422, "invalid_request", 1],
      [408, "timeout", 4],
      [409, "provider_unavailable", 4],
      [429, "rate_limited", 4],
      [503, "provider_unavailable", 4],
      [302, "provider_unavailable", 1],
    ];
    for (const [status, kind, expectedCalls] of cases) {
      let calls = 0;
      const client = connector(async () => {
        calls++;
        return response({ error: "secret provider body" }, status);
      });
      await expectKind(client.complete(request()), kind);
      expect(calls).toBe(expectedCalls);
    }
  });

  test("maps exhausted network errors to provider_unavailable", async () => {
    let calls = 0;
    const client = connector(async () => {
      calls++;
      throw new TypeError("network failed");
    });
    await expectKind(client.complete(request()), "provider_unavailable");
    expect(calls).toBe(4);
  });

  test("rejects malformed envelopes, body read failures, and completed responses without usage", async () => {
    const badResponses: Response[] = [
      response({ not: "an envelope" }),
      {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => Promise.reject("bad"),
      } as unknown as Response,
      response(envelope({ usage: undefined })),
    ];
    for (const badResponse of badResponses) {
      const error = await expectKind(
        connector(async () => badResponse).complete(request()),
        "provider_unavailable",
      );
      expect(error.usage).toBeUndefined();
    }
  });

  test("malformed output shapes fail with valid billed usage attached", async () => {
    for (const output of [{}, [{ type: "message", content: {} }], [null]]) {
      const error = await expectKind(
        connector(async () => response(envelope({ output }))).complete(request()),
        "output_invalid",
      );
      expect(error.usage?.tokensIn).toBe(40);
    }
  });

  test("maps completed output failures and refusal with usage", async () => {
    const cases: Array<[Record<string, unknown>, ModelConnectorErrorKind]> = [
      [{ output: [] }, "output_invalid"],
      [
        { output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] },
        "output_invalid",
      ],
      [
        { output: [{ type: "message", content: [{ type: "output_text", text: '{"wrong":1}' }] }] },
        "output_invalid",
      ],
      [
        { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] },
        "output_refused",
      ],
    ];
    for (const [override, kind] of cases) {
      const error = await expectKind(
        connector(async () => response(envelope(override))).complete(request()),
        kind,
      );
      expect(error.usage?.tokensIn).toBe(40);
    }
  });

  test("maps every incomplete reason with usage", async () => {
    for (const [reason, kind] of [
      ["max_output_tokens", "output_truncated"],
      ["content_filter", "output_refused"],
      ["other", "output_invalid"],
    ] as const) {
      const error = await expectKind(
        connector(async () =>
          response(envelope({ status: "incomplete", incomplete_details: { reason } })),
        ).complete(request()),
        kind,
      );
      expect(error.usage?.tokensOut).toBe(9);
    }
  });

  test("maps failed and asynchronous statuses, retaining usage when present", async () => {
    for (const status of ["failed", "queued", "in_progress", "cancelled"] as const) {
      const withUsage = await expectKind(
        connector(async () => response(envelope({ status }))).complete(request()),
        "provider_unavailable",
      );
      expect(withUsage.usage?.tokensIn).toBe(40);
      const withoutUsage = await expectKind(
        connector(async () => response(envelope({ status, usage: null }))).complete(request()),
        "provider_unavailable",
      );
      expect(withoutUsage.usage).toBeUndefined();
    }
  });

  test("one cumulative deadline spans attempts and backoff", async () => {
    const clock = { value: 0 };
    let calls = 0;
    const client = connector(async () => {
      calls++;
      clock.value += 700;
      return response({}, 503);
    }, clock);
    await expectKind(client.complete(request({ timeoutMs: 1000 })), "timeout");
    expect(calls).toBe(1);
    expect(clock.value).toBe(1000);
  });

  test("a successful later response cannot escape the cumulative deadline", async () => {
    const clock = { value: 0 };
    let calls = 0;
    const client = connector(async () => {
      calls++;
      clock.value += calls === 1 ? 100 : 500;
      return calls === 1 ? response({}, 503) : response(envelope());
    }, clock);
    const error = await expectKind(client.complete(request({ timeoutMs: 1000 })), "timeout");
    expect(calls).toBe(2);
    expect(error.usage?.tokensIn).toBe(40);
  });

  test("honors numeric and HTTP-date Retry-After values within the deadline", async () => {
    const clock = { value: 1_000_000 };
    const delays: number[] = [];
    let calls = 0;
    const headers = [
      { "retry-after": "1.5" },
      { "retry-after": new Date(clock.value + 4000).toUTCString() },
    ];
    const client = connector(
      async () => {
        const current = calls++;
        return current < 2 ? response({}, 429, headers[current]) : response(envelope());
      },
      clock,
      async (milliseconds) => {
        delays.push(milliseconds);
        clock.value += milliseconds;
      },
    );
    await client.complete(request({ timeoutMs: 10_000 }));
    expect(delays).toEqual([1500, 2500]);
  });

  test("Retry-After beyond the deadline returns the last failure kind", async () => {
    const clock = { value: 0 };
    let slept = false;
    const client = connector(
      async () => response({}, 429, { "retry-after": "20" }),
      clock,
      async () => {
        slept = true;
      },
    );
    await expectKind(client.complete(request({ timeoutMs: 1000 })), "rate_limited");
    expect(slept).toBe(false);
  });

  test("an external abort during backoff maps to aborted", async () => {
    const controller = new AbortController();
    const client = connector(
      async () => response({}, 503),
      { value: 0 },
      async (_milliseconds, signal) => {
        controller.abort();
        throw signal.reason;
      },
    );
    await expectKind(client.complete(request({ signal: controller.signal })), "aborted");
  });

  test("an operation abort after a billed body arrives retains usage", async () => {
    const controller = new AbortController();
    const client = connector(async () => {
      controller.abort();
      return response(envelope());
    });
    const error = await expectKind(
      client.complete(request({ signal: controller.signal })),
      "aborted",
    );
    expect(error.usage?.tokensIn).toBe(40);
  });

  test("deadline and operation abort remain active while reading the body", async () => {
    for (const cause of ["deadline", "operation"] as const) {
      const controller = new AbortController();
      const client = new OpenAIConnector(
        { apiKey: "key", baseUrl: "https://example.test" },
        {
          fetch: async (_url, init) =>
            ({
              ok: true,
              status: 200,
              headers: new Headers(),
              json: () =>
                new Promise((_resolve, reject) => {
                  init?.signal?.addEventListener("abort", () => reject(new Error("stalled")), {
                    once: true,
                  });
                  if (cause === "operation") setTimeout(() => controller.abort(), 5);
                }),
            }) as unknown as Response,
        },
      );
      await expectKind(
        client.complete(request({ timeoutMs: 15, signal: controller.signal })),
        cause === "deadline" ? "timeout" : "aborted",
      );
    }
  });
});
