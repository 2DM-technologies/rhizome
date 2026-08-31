import { describe, expect, test } from "bun:test";

import { PublicRemoteSourceCatalog, type PublicAssetFetcher } from "../../public-sources/types.ts";
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

describe("Are.na public-remote source skill", () => {
  test("publishes a serializable manifest and normalizes only Are.na channel locators", () => {
    const serialized = JSON.parse(JSON.stringify(arenaSourceSkillManifest));
    expect(serialized).toMatchObject({
      skill_id: ARENA_SKILL_ID,
      source_kind: "public_remote",
      connector_version: ARENA_CONNECTOR_VERSION,
      parser: { name: ARENA_PARSER_NAME, version: "arena@1.2.0" },
      review_actions: ["review_import", "refresh_source"],
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
      expect(request.maxBytes).toBeGreaterThan(0);
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

function skillForCapture(fixture: ArenaCaptureV1): {
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
          bytes: new Uint8Array(Buffer.from(asset.body_base64, "base64")),
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
