import { describe, expect, test } from "bun:test";

import { PublicRemoteSourceCatalog, type PublicAssetFetcher } from "../../public-sources/types.ts";
import {
  assertCandidateBundleLimits,
  assertCaptureLimit,
} from "../../source-skills/execution-limits.ts";
import { CONTENT_IMPORT_PUSH_PIPELINE } from "../../source-skills/import-push-pipelines.ts";
import type { ArenaApiFetch } from "./client.ts";
import {
  ARENA_CONNECTOR_VERSION,
  ARENA_PARSER_NAME,
  ARENA_SKILL_ID,
  normalizeArenaChannelLocator,
} from "./contracts.ts";
import { arenaSourceSkillManifest } from "./manifest.ts";
import { type ArenaCaptureV1, parseArenaCapture } from "./scripts/parse-arena.ts";
import { createArenaSourceSkill } from "./source.ts";

const LARGE_ASSET_BYTE_SIZE = 13_093_327;

describe("Are.na public-remote source skill", () => {
  test("publishes a serializable manifest and normalizes only Are.na channel locators", () => {
    const serialized = JSON.parse(JSON.stringify(arenaSourceSkillManifest));
    expect(serialized).toMatchObject({
      skill_id: ARENA_SKILL_ID,
      source_kind: "public_remote",
      connector_version: ARENA_CONNECTOR_VERSION,
      parser: { name: ARENA_PARSER_NAME, version: "arena@1.2.0" },
      limits: expect.objectContaining({ maxElementBytes: 16 * 1_024 * 1_024 }),
      review_actions: ["review_import", "refresh_source"],
      import_push_pipeline: CONTENT_IMPORT_PUSH_PIPELINE,
      input_fields: [
        expect.objectContaining({ name: "url", control: "url", required: true, secret: false }),
      ],
    });
    expect(
      createArenaSourceSkill({ assetFetch: async () => Promise.reject() }).fetchPolicy,
    ).toEqual({ attempts: 24, windowHours: 24 });
    expect(normalizeArenaChannelLocator("https://are.na/noah-putnam/love-always-wins/")).toEqual({
      canonicalUrl: "https://www.are.na/noah-putnam/love-always-wins",
      ownerSlug: "noah-putnam",
      channelSlug: "love-always-wins",
    });
    expect(
      normalizeArenaChannelLocator("https://www.are.na/noah-putnam/closer-skimdvjv7_k"),
    ).toEqual({
      canonicalUrl: "https://www.are.na/noah-putnam/closer-skimdvjv7_k",
      ownerSlug: "noah-putnam",
      channelSlug: "closer-skimdvjv7_k",
    });
    for (const value of [
      "https://example.test/noah-putnam/love-always-wins",
      "http://www.are.na/noah-putnam/love-always-wins",
      "https://www.are.na/noah-putnam/love-always-wins?token=x",
      "https://user:secret@www.are.na/noah-putnam/love-always-wins",
      "https://www.are.na/love-always-wins",
    ]) {
      expect(() => normalizeArenaChannelLocator(value), value).toThrow();
    }
  });

  test("round-trips the committed fixture through fixed API and injected asset transports", async () => {
    const fixtureBytes = await readFixtureBytes();
    const fixture = JSON.parse(new TextDecoder().decode(fixtureBytes)) as ArenaCaptureV1;
    const apiUrls: string[] = [];
    const assetUrls: string[] = [];
    const apiFetch: ArenaApiFetch = async (input, init) => {
      const url = new URL(input.toString()).toString();
      apiUrls.push(url);
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
      const response = [fixture.channel, ...fixture.contents_pages].find(
        (entry) => entry.url === url,
      );
      if (!response) throw new Error(`Unexpected API request: ${url}`);
      return new Response(Buffer.from(response.body_base64, "base64"), {
        status: 200,
        headers: { "Content-Type": response.content_type },
      });
    };
    const assetFetch: PublicAssetFetcher = async (request) => {
      assetUrls.push(request.url);
      expect(request.accept).toBe("*/*");
      expect(request.maxBytes).toBe(16 * 1024 * 1024);
      const asset = fixture.assets.find((entry) => entry.requested_url === request.url);
      if (!asset) throw new Error(`Unexpected asset request: ${request.url}`);
      return {
        requestedUrl: asset.requested_url,
        finalUrl: asset.url,
        contentType: asset.content_type,
        bytes: new Uint8Array(Buffer.from(asset.body_base64, "base64")),
        redirects: asset.redirects,
      };
    };
    const skill = createArenaSourceSkill({
      apiFetch,
      assetFetch,
      now: () => new Date(fixture.retrieved_at),
    });
    const catalog = new PublicRemoteSourceCatalog({ current: [skill] });
    const config = skill.normalizeConfig({ url: fixture.channel_url + "/" });
    const captured = await skill.retrieve(config);
    const parsed = await skill.parser.parse(captured);
    const bundle = await skill.compiledSource.compile({
      bytes: captured,
      config,
      limits: skill.manifest.limits,
    });

    expect(parsed).toEqual(parseArenaCapture(fixtureBytes));
    expect(catalog.currentForSkillId(ARENA_SKILL_ID)).toBe(skill);
    expect(apiUrls.every((url) => new URL(url).origin === "https://api.are.na")).toBe(true);
    expect(assetUrls).toEqual(fixture.assets.map(({ requested_url }) => requested_url));
    expect(bundle.verify).toMatchObject({ ok: true, candidate_count: 5 });
    expect(bundle.destination).toEqual({ title: "Synthetic Media Study" });
    expect(bundle.candidates.map(({ keys }) => keys)).toEqual([
      { arena_block_id: "1101", arena_channel_id: "7001" },
      { arena_block_id: "1102", arena_channel_id: "7001" },
      { arena_block_id: "1103", arena_channel_id: "7001" },
      { arena_block_id: "1104", arena_channel_id: "7001" },
      { arena_block_id: "1105", arena_channel_id: "7001" },
    ]);
    expect(bundle.candidates[1]?.elements[1]?.bytes).toEqual(
      parseArenaCapture(fixtureBytes).blocks[1]?.elements[1]?.bytes,
    );
    expect(bundle.candidates[1]?.elements[1]).toMatchObject({
      role: "content",
      alt: "Synthetic primary",
    });
    expect(skill.stateDigest(config)).toEqual({
      version: "arena-source-state@1",
      url: fixture.channel_url,
    });
    expect(skill.capture.label(config, "fetch-1")).toBe("arena-synthetic-media-study-fetch-1.json");
  });

  test("delegates arbitrary provider-declared HTTPS asset hosts to the safe fetch boundary", async () => {
    const fixture = JSON.parse(await Bun.file(fixtureUrl()).text()) as ArenaCaptureV1;
    const replacementUrl = "https://media.example-cdn.test/assets/original.png";
    const page = JSON.parse(
      Buffer.from(fixture.contents_pages[0]!.body_base64, "base64").toString("utf8"),
    ) as { data: Array<Record<string, unknown>> };
    const image = page.data.find((entry) => entry.id === 1102)?.image as Record<string, unknown>;
    image.src = replacementUrl;
    fixture.contents_pages[0]!.body_base64 = Buffer.from(JSON.stringify(page)).toString("base64");
    const originalAsset = fixture.assets.find(({ block_id }) => block_id === 1102)!;
    originalAsset.requested_url = replacementUrl;
    originalAsset.url = replacementUrl;

    const { skill, requestedAssets } = skillForCapture(fixture);
    const config = skill.normalizeConfig({ url: fixture.channel_url });
    const captured = await skill.retrieve(config);
    const bundle = await skill.compiledSource.compile({
      bytes: captured,
      config,
      limits: skill.manifest.limits,
    });

    expect(requestedAssets).toContain(replacementUrl);
    expect(bundle.verify.ok).toBe(true);
  });

  test("retrieves and compiles an asset above the former 10 MiB element ceiling", async () => {
    const fixture = JSON.parse(await Bun.file(fixtureUrl()).text()) as ArenaCaptureV1;
    const page = JSON.parse(
      Buffer.from(fixture.contents_pages[0]!.body_base64, "base64").toString("utf8"),
    ) as { data: Array<Record<string, unknown>> };
    const imageBlock = page.data.find((entry) => entry.id === 1102);
    if (!imageBlock || !imageBlock.image || typeof imageBlock.image !== "object") {
      throw new Error("Synthetic fixture is missing its image block");
    }
    (imageBlock.image as Record<string, unknown>).file_size = LARGE_ASSET_BYTE_SIZE;
    fixture.contents_pages[0]!.body_base64 = Buffer.from(JSON.stringify(page)).toString("base64");

    const largeAsset = new Uint8Array(LARGE_ASSET_BYTE_SIZE);
    largeAsset.set(Buffer.from("89504e470d0a1a0a", "hex"));
    const { skill } = skillForCapture(fixture, new Map<number, Uint8Array>([[1102, largeAsset]]));
    const config = skill.normalizeConfig({ url: fixture.channel_url });

    const captured = await skill.retrieve(config);
    expect(() => assertCaptureLimit(captured.byteLength, skill.manifest.limits)).not.toThrow();
    const bundle = await skill.compiledSource.compile({
      bytes: captured,
      config,
      limits: skill.manifest.limits,
    });
    expect(() => assertCandidateBundleLimits(bundle, skill.manifest.limits)).not.toThrow();

    const imageCandidate = bundle.candidates.find(({ keys }) => keys.arena_block_id === "1102");
    const imageElement = imageCandidate?.elements.find(({ role }) => role === "content");
    expect(bundle.verify.ok).toBe(true);
    expect(imageElement).toMatchObject({
      kind: "image",
      byteSize: LARGE_ASSET_BYTE_SIZE,
    });
    expect(imageElement?.bytes.byteLength).toBe(LARGE_ASSET_BYTE_SIZE);
    expect(LARGE_ASSET_BYTE_SIZE).toBeGreaterThan(10 * 1_024 * 1_024);
    expect(LARGE_ASSET_BYTE_SIZE).toBeLessThan(skill.manifest.limits.maxElementBytes);
  });

  test("times out the whole channel capture when the API transport never settles", async () => {
    const skill = createArenaSourceSkill({
      requestTimeoutMs: 10,
      apiFetch: () => new Promise<Response>(() => undefined),
      assetFetch: () => Promise.reject(new Error("Asset fetch should not be reached")),
    });
    const config = skill.normalizeConfig({
      url: "https://www.are.na/synthetic-author/synthetic-media-study",
    });

    await expect(skill.retrieve(config)).rejects.toMatchObject({
      kind: "request_timeout",
      message: "Are.na channel capture timed out",
    });
  });

  test("rejects capture/config mismatches before candidate materialization", async () => {
    const bytes = await readFixtureBytes();
    const { skill } = skillForCapture(JSON.parse(await Bun.file(fixtureUrl()).text()));
    const different = { url: "https://www.are.na/synthetic-author/different-channel" };
    const bundle = await skill.compiledSource.compile({
      bytes,
      config: different,
      limits: skill.manifest.limits,
    });
    expect(bundle.verify.ok).toBe(false);
  });
});

function skillForCapture(
  fixture: ArenaCaptureV1,
  assetBytesByBlockId: ReadonlyMap<number, Uint8Array> = new Map(),
): {
  skill: ReturnType<typeof createArenaSourceSkill>;
  requestedAssets: string[];
} {
  const requestedAssets: string[] = [];
  return {
    requestedAssets,
    skill: createArenaSourceSkill({
      now: () => new Date(fixture.retrieved_at),
      apiFetch: async (input) => {
        const url = new URL(input.toString()).toString();
        const response = [fixture.channel, ...fixture.contents_pages].find(
          (entry) => entry.url === url,
        );
        if (!response) throw new Error(`Unexpected API request: ${url}`);
        return new Response(Buffer.from(response.body_base64, "base64"), {
          headers: { "Content-Type": response.content_type },
        });
      },
      assetFetch: async (request) => {
        requestedAssets.push(request.url);
        const asset = fixture.assets.find((entry) => entry.requested_url === request.url);
        if (!asset) throw new Error(`Unexpected asset request: ${request.url}`);
        return {
          requestedUrl: request.url,
          finalUrl: asset.url,
          contentType: asset.content_type,
          bytes:
            assetBytesByBlockId.get(asset.block_id) ??
            new Uint8Array(Buffer.from(asset.body_base64, "base64")),
          redirects: asset.redirects,
        };
      },
    }),
  };
}

function fixtureUrl(): URL {
  return new URL("./fixtures/mixed-channel-capture.json", import.meta.url);
}

async function readFixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(fixtureUrl()).arrayBuffer());
}
