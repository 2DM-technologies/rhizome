import { describe, expect, test } from "bun:test";
import { imageDimensions } from "../src/inference/image.ts";
import { lunaImageTokens } from "../src/inference/openai/image-tokens.ts";
import { OpenAIConnector } from "../src/inference/openai/connector.ts";
import { FakeModelConnector } from "../src/inference/fake-connector.ts";
import { batchEnvelope, packChunks } from "../src/push/chunking.ts";
import { describeMedia } from "../src/push/tasks/element/describe-media/manifest.ts";
import { DEFAULT_PUSH_LIMITS } from "../src/push/limits.ts";
import type { CompletionRequest } from "../src/inference/model-connector.ts";
import type { OpenAIResponsesRequest } from "../src/inference/openai/responses-api.ts";
import { PNG, pngHeader } from "./fixtures/push-images.ts";

const target = { provider: "openai", name: "gpt-5.6-luna" };
function webp(kind: "VP8 " | "VP8L" | "VP8X") {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from("RIFF"));
  bytes.set(Buffer.from(`WEBP${kind}`), 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 22, true);
  view.setUint32(16, 10, true);
  if (kind === "VP8X") {
    bytes[24] = 31;
    bytes[27] = 63;
  } else if (kind === "VP8L") {
    bytes[20] = 0x2f;
    view.setUint32(21, 31 | (63 << 14), true);
  } else {
    bytes.set([0x9d, 1, 0x2a], 23);
    view.setUint16(26, 32, true);
    view.setUint16(28, 64, true);
  }
  return bytes;
}

describe("image attachment inputs", () => {
  test("recognizes PNG, both GIF headers, JPEG SOF variants, and all WebP headers", () => {
    expect(imageDimensions("image/png", PNG)).toEqual({ width: 1, height: 1 });
    for (const signature of ["GIF87a", "GIF89a"]) {
      const bytes = new Uint8Array(13);
      bytes.set(Buffer.from(signature));
      bytes[6] = 32;
      bytes[8] = 64;
      expect(imageDimensions("image/gif", bytes)).toEqual({ width: 32, height: 64 });
    }
    for (const marker of [0xc0, 0xc1, 0xc2]) {
      const bytes = Uint8Array.from([
        0xff,
        0xd8,
        0xff,
        0xe0,
        0,
        4,
        1,
        2,
        0xff,
        marker,
        0,
        8,
        8,
        0,
        64,
        0,
        32,
        0,
      ]);
      expect(imageDimensions("image/jpeg", bytes)).toEqual({ width: 32, height: 64 });
    }
    for (const kind of ["VP8 ", "VP8L", "VP8X"] as const)
      expect(imageDimensions("image/webp", webp(kind))).toEqual({ width: 32, height: 64 });
    const backing = new Uint8Array(PNG.length + 7);
    backing.set(PNG, 7);
    expect(imageDimensions("image/png", backing.subarray(7))).toEqual({ width: 1, height: 1 });
  });
  test("rejects unlisted MIME, mismatched magic, truncated and invalid headers", () => {
    for (const mime of ["text/plain", "image/svg+xml", "image/jpeg", "image/webp", "image/gif"])
      expect(imageDimensions(mime, PNG)).toBeUndefined();
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"])
      for (const bytes of [new Uint8Array(), Uint8Array.of(1, 2, 3)])
        expect(imageDimensions(mime, bytes)).toBeUndefined();
    expect(imageDimensions("image/png", PNG.subarray(0, 24))).toBeUndefined();
    expect(imageDimensions("image/png", pngHeader(0, 10))).toBeUndefined();
    expect(
      imageDimensions("image/jpeg", Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 30)),
    ).toBeUndefined();
    expect(imageDimensions("image/webp", webp("VP8X").subarray(0, 25))).toBeUndefined();
  });
  test("uses Luna high-detail patches, dimension scaling, and rounded image tokens", () => {
    expect(lunaImageTokens(1, 1)).toBe(2);
    expect(lunaImageTokens(32, 32)).toBe(2);
    expect(lunaImageTokens(33, 32)).toBe(3);
    expect(lunaImageTokens(1024, 1024)).toBe(1229);
    expect(lunaImageTokens(2048, 2048)).toBe(3000);
    expect(lunaImageTokens(4096, 4096)).toBe(3000);
    expect(lunaImageTokens(4096, 512)).toBe(615);
    expect(lunaImageTokens(1, 100000)).toBe(77);
    expect(() => lunaImageTokens(0, 32)).toThrow();
    expect(() => lunaImageTokens(32.5, 32)).toThrow();
  });
  test("sends data first and each ref immediately before its image with high detail", async () => {
    let body: OpenAIResponsesRequest | undefined;
    const fake = new FakeModelConnector();
    const request: CompletionRequest = {
      target,
      instructions: describeMedia.prompt,
      input: '<data>{"elements":[{"ref":"e1"},{"ref":"e2"}]}</data>',
      attachments: [
        { ref: "e1", mime: "image/png", bytes: PNG },
        { ref: "e2", mime: "image/png", bytes: pngHeader(1024, 1024) },
      ],
      schema: batchEnvelope(describeMedia.outputSchema, ["e1", "e2"]),
      schemaName: "rhizome_describe_media",
      effort: "low",
      maxOutputTokens: 2176,
      timeoutMs: 1000,
      signal: new AbortController().signal,
      trace: { operationUuid: "image-test", call: 1 },
    };
    const generated = await fake.complete(request);
    const openai = new OpenAIConnector(
      { apiKey: "test", baseUrl: "https://example.test" },
      {
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({
            id: "resp-image",
            status: "completed",
            service_tier: "flex",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: JSON.stringify(generated.output) }],
              },
            ],
            usage: { input_tokens: 123, output_tokens: 45 },
          });
        },
      },
    );
    const result = await openai.complete(request);
    expect(body?.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: request.input },
          ...request.attachments!.flatMap(
            ({ ref, mime, bytes }) =>
              [
                { type: "input_text", text: ref },
                {
                  type: "input_image",
                  detail: "high",
                  image_url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
                },
              ] as const,
          ),
        ],
      },
    ]);
    expect(fake.requests[0]?.attachments).toEqual(request.attachments);
    const expected =
      Math.ceil(
        new TextEncoder().encode(request.instructions + request.input + "e1e2").byteLength / 4,
      ) +
      2 +
      1229;
    expect(await fake.countTokens(request)).toBe(expected);
    expect(await openai.countTokens(request)).toBe(expected);
    expect(result.usage.tokensIn).toBe(123);
  });
  test("packs images by bytes, tokens, and count while reading at most a chunk and lookahead", async () => {
    const connector = new FakeModelConnector();
    const registry = { target, identity: "openai/gpt-5.6-luna", connector };
    const attachments = (records: readonly Uint8Array[]) =>
      records.map((bytes, i) => ({ ref: `e${i + 1}`, mime: "image/png", bytes }));
    for (const limits of [
      { ...DEFAULT_PUSH_LIMITS, maxAttachmentBytesPerCall: PNG.length * 2 },
      { ...DEFAULT_PUSH_LIMITS, maxObjectsPerCall: 2 },
    ]) {
      let reads = 0;
      async function* source() {
        for (let i = 0; i < 8; i++) {
          reads++;
          yield PNG;
        }
      }
      const chunks = packChunks(
        source(),
        describeMedia,
        registry,
        limits,
        () => "",
        () => {
          throw new Error("Unexpected skip");
        },
        attachments,
      );
      expect((await chunks.next()).value).toHaveLength(2);
      expect(reads).toBe(3);
      await chunks.return(undefined);
      expect(reads).toBe(3);
    }
    const skipped: Uint8Array[] = [],
      sizes: number[] = [];
    for await (const chunk of packChunks(
      [PNG, PNG, pngHeader(4096, 4096), PNG],
      { ...describeMedia, prompt: "" },
      registry,
      { ...DEFAULT_PUSH_LIMITS, maxInputTokensPerCall: 5 },
      () => "",
      (value) => skipped.push(value),
      attachments,
    ))
      sizes.push(chunk.length);
    expect(sizes).toEqual([2, 1]);
    expect(skipped).toHaveLength(1);
    const bytesSkipped: Uint8Array[] = [];
    for await (const _ of packChunks(
      [PNG],
      describeMedia,
      registry,
      { ...DEFAULT_PUSH_LIMITS, maxAttachmentBytesPerCall: PNG.length - 1 },
      () => "",
      (record) => bytesSkipped.push(record),
      attachments,
    ))
      throw new Error("Oversized attachment dispatched");
    expect(bytesSkipped).toEqual([PNG]);
  });
});
