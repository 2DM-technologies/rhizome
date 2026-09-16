import { describe, expect, test } from "bun:test";
import { validateMediaObject, validateMediaObjectProperties, type MediaObject } from "@rnet/types";

import { SourceSkillManifestCatalog } from "../../source-skills/manifest-catalog.ts";
import type {
  NormalizedXAttachment,
  NormalizedXPost,
  SelectedXPosts,
  XAccountIdentity,
} from "./contracts.ts";
import { X_SOURCE_LIMITS } from "./definition.ts";
import { xOAuthSourceManifest } from "./oauth/manifest.ts";
import { classifyXPost, compileXPostCandidates, selectXPosts } from "./tweet-candidates.ts";

interface FixtureAttachment {
  status: "available" | "omitted";
  sourceRef: string;
  kind?: "image" | "video";
  mime?: string;
  alt?: string;
  body?: string;
  reason?: "missing_media" | "unsupported_media";
  byteSize?: number;
}

interface FixturePost extends Omit<NormalizedXPost, "attachments" | "references"> {
  attachments: FixtureAttachment[];
  references: Array<{
    kind: "replied_to" | "quoted" | "reposted";
    postId: string;
    url?: string;
    textUrl?: string;
  }>;
}

const fixture = (await Bun.file(
  new URL("./fixtures/normalized-posts.json", import.meta.url),
).json()) as {
  account: XAccountIdentity;
  retrievedAt: string;
  posts: FixturePost[];
};

describe("X shared post candidates", () => {
  test("keeps the OAuth source identity quarantined behind shared definitions", () => {
    expect(new SourceSkillManifestCatalog([xOAuthSourceManifest]).all()[0]).toEqual(
      xOAuthSourceManifest,
    );
    expect(xOAuthSourceManifest.limits).toEqual(X_SOURCE_LIMITS);
    expect(xOAuthSourceManifest).toMatchObject({
      skill_id: "x_oauth",
      source_kind: "credentialed_remote",
      connection: { mode: "oauth2_pkce", button_label: "Sign in with X" },
      limits: X_SOURCE_LIMITS,
    });
  });

  test("filters before capping and sorts newest-first with a stable post-ID tie-breaker", () => {
    const selection = selected(3);
    expect(selection.posts.map(({ id }) => id)).toEqual(["105", "101", "100"]);
    expect(selection.counts).toEqual({
      sourceRecordCount: 7,
      repliesExcluded: 1,
      repostsExcluded: 1,
      quotesWithoutCommentaryExcluded: 1,
      authorMismatchesExcluded: 1,
      eligibleCount: 3,
      importedCount: 3,
      cap: 3,
    });
  });

  test("removes only the provider-identified quote URL span for eligibility", () => {
    const posts = normalizedPosts();
    const bareQuote = posts.find(({ id }) => id === "102")!;
    const authoredQuote = posts.find(({ id }) => id === "101")!;
    expect(classifyXPost(bareQuote, fixture.account.id)).toEqual({
      eligible: false,
      reason: "quote_without_commentary",
    });
    expect(classifyXPost(authoredQuote, fixture.account.id)).toEqual({
      eligible: true,
      postKind: "quote",
    });
  });

  test("stores exact text first, preserves media order/alt, and emits registered tweet facts", async () => {
    const selection = selected(X_SOURCE_LIMITS.maxCandidates);
    const bundle = await compileXPostCandidates(selection, X_SOURCE_LIMITS);

    expect(bundle.kind).toBe("candidate_bundle@1");
    expect(bundle.destination).toEqual({ title: "@example_user Tweets" });
    expect(bundle.verify.ok).toBe(true);
    const [original, quote] = bundle.candidates;
    expect(new TextDecoder().decode(original?.elements[0]?.bytes)).toBe(
      "Newest original with https://t.co/unchanged",
    );
    expect(original?.elements.map(({ kind }) => kind)).toEqual(["text", "image"]);
    expect(original?.elements[1]?.alt).toBe("A synthetic landscape");
    expect(original?.sourceProperties.text).toBeUndefined();
    expect(original?.sourceProperties.full_text).toBeUndefined();
    expect(original?.sourceProperties.entities).toEqual({
      urls: [
        {
          start: 21,
          end: 43,
          url: "https://t.co/unchanged",
          expanded_url: "https://example.test/article",
        },
      ],
    });
    expect(original?.sourceProperties.media_omissions).toEqual([
      {
        attachment_index: 1,
        source_ref: "tweet_media/105-two.svg",
        reason: "unsupported_media",
        kind: "image",
        mime: "image/svg+xml",
        byte_size: 120,
      },
    ]);
    expect(validateMediaObjectProperties("tweet", original?.sourceProperties).ok).toBe(true);
    const elementUuids = [
      "0198f2a1-a005-7a05-8005-000000000005",
      "0198f2a1-a006-7a06-8006-000000000006",
    ];
    const stagedCandidate: MediaObject = {
      rnet_schema: "0.1",
      uri: "rnet://object/0198f2a1-a001-7a01-8001-000000000001",
      owner: "rnet://id/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47",
      type: original!.type,
      elements: original!.elements.map(({ role }, index) => ({
        uri: `rnet://element/${elementUuids[index]}`,
        role,
      })),
      keys: { ...original!.keys },
      source: {
        ingest: {
          method: "parser",
          reproducible: true,
          skill: xOAuthSourceManifest.parser.version,
        },
        origins: ["rnet://origin/0198f2a1-a002-7a02-8002-000000000002"],
        retrieved_at: original!.retrievedAt,
        properties: { ...original!.sourceProperties },
      },
    };
    expect(stagedCandidate.source.ingest.skill).toBe("x-posts@1.0.0");
    expect(validateMediaObject(stagedCandidate).ok).toBe(true);
    expect(quote?.keys).toMatchObject({
      x_tweet_id: "101",
      x_quoted_tweet_id: "73",
      x_quoted_tweet_url: "https://x.com/quoted/status/73",
    });
    expect(new TextDecoder().decode(quote?.elements[0]?.bytes)).toBe(
      "Worth reading 🔥 https://x.com/quoted/status/73",
    );
    expect(quote?.semanticIdentity).toEqual({
      type: "tweet",
      x_tweet_id: "101",
      x_author_id: "42",
    });
    expect(bundle.verify).toMatchObject({
      source_record_count: 7,
      replies_excluded: 1,
      reposts_excluded: 1,
      quotes_without_commentary_excluded: 1,
      eligible_count: 3,
      candidate_count: 3,
      configured_cap: 25,
      media_omissions: {
        missing_media: 1,
        unsupported_media: 1,
        element_too_large: 0,
        total_element_budget: 0,
      },
    });
  });

  test("continues after oversized and aggregate-budgeted media to include later small items", async () => {
    const post = normalizedPosts().find(({ id }) => id === "100")!;
    const attachments: NormalizedXAttachment[] = [
      available("large", new Uint8Array(6)),
      available("aggregate", new Uint8Array(4)),
      available("small", new Uint8Array(2)),
    ];
    const selection = selectXPosts({
      account: fixture.account,
      posts: [{ ...post, text: "A", attachments }],
      cap: 1,
    });
    const bundle = await compileXPostCandidates(selection, {
      maxCandidates: 1,
      maxCaptureBytes: 1_024,
      maxElementBytes: 5,
      maxTotalElementBytes: 4,
    });
    expect(bundle.candidates[0]?.elements.map(({ byteSize }) => byteSize)).toEqual([1, 2]);
    expect(bundle.verify).toMatchObject({
      ok: true,
      media_omissions: {
        element_too_large: 1,
        total_element_budget: 1,
      },
    });
  });

  test("fails closed on duplicate IDs, invalid spans, and required text that cannot fit", async () => {
    const post = normalizedPosts().find(({ id }) => id === "100")!;
    const quote = normalizedPosts().find(({ id }) => id === "101")!;
    expect(() => selectXPosts({ account: fixture.account, posts: [post, post], cap: 2 })).toThrow(
      "Duplicate X post id",
    );
    expect(() =>
      classifyXPost(
        {
          ...post,
          references: [{ kind: "quoted", postId: "1", textSpan: { start: 1, end: 99 } }],
        },
        fixture.account.id,
      ),
    ).toThrow("invalid quote URL span");
    expect(() => classifyXPost({ ...quote, entities: undefined }, fixture.account.id)).toThrow(
      "matching structured entity",
    );
    expect(() =>
      selectXPosts({
        account: fixture.account,
        posts: [
          {
            ...post,
            entities: { urls: [{ start: 0, end: 1, url: "not-the-text" }] },
          },
        ],
        cap: 1,
      }),
    ).toThrow("offsets do not match");
    const selection = selectXPosts({ account: fixture.account, posts: [post], cap: 1 });
    await expect(
      compileXPostCandidates(selection, {
        maxCandidates: 1,
        maxCaptureBytes: 1_024,
        maxElementBytes: 2,
        maxTotalElementBytes: 2,
      }),
    ).rejects.toThrow("text exceeds");
  });
});

function selected(cap: number): SelectedXPosts {
  return selectXPosts({
    account: fixture.account,
    posts: normalizedPosts(),
    cap,
    retrievedAt: fixture.retrievedAt,
  });
}

function normalizedPosts(): NormalizedXPost[] {
  return fixture.posts.map((post) => ({
    ...post,
    references: post.references.map(({ textUrl, ...reference }) => ({
      ...reference,
      ...(textUrl
        ? {
            textUrl,
            textSpan: {
              start: post.text.indexOf(textUrl),
              end: post.text.indexOf(textUrl) + textUrl.length,
            },
          }
        : {}),
    })),
    attachments: post.attachments.map((attachment): NormalizedXAttachment =>
      attachment.status === "available"
        ? {
            status: "available",
            kind: attachment.kind!,
            mime: attachment.mime!,
            sourceRef: attachment.sourceRef,
            ...(attachment.alt ? { alt: attachment.alt } : {}),
            bytes: new TextEncoder().encode(attachment.body),
          }
        : {
            status: "omitted",
            reason: attachment.reason!,
            sourceRef: attachment.sourceRef,
            ...(attachment.kind ? { kind: attachment.kind } : {}),
            ...(attachment.mime ? { mime: attachment.mime } : {}),
            ...(attachment.byteSize !== undefined ? { byteSize: attachment.byteSize } : {}),
          },
    ),
  }));
}

function available(sourceRef: string, bytes: Uint8Array): NormalizedXAttachment {
  return { status: "available", kind: "image", mime: "image/jpeg", sourceRef, bytes };
}
