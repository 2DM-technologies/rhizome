import { describe, expect, test } from "bun:test";

import {
  createSafePublicAssetFetcher,
  isSafePublicIpAddress,
  type PinnedPublicRequest,
  type ResolvedPublicAddress,
  SafePublicFetcher,
  type SafePublicDnsResolver,
  type SafePublicTransport,
} from "../src/public-fetch/index.ts";
import { createPinnedAddressLookup } from "../src/public-fetch/safe-public-fetcher.ts";

interface StubReply {
  body?: readonly (string | Uint8Array)[];
  close?: () => void;
  headers?: HeadersInit;
  status?: number;
}

interface CapturedRequest {
  address: ResolvedPublicAddress;
  headers: Record<string, string>;
  hostHeader: string;
  tlsServername?: string;
  url: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function repliesTransport(
  replies: Map<string, StubReply[]>,
  requests: CapturedRequest[] = [],
): SafePublicTransport {
  return async (request) => {
    requests.push(captureRequest(request));
    const reply = replies.get(request.url.href)?.shift();
    if (reply === undefined) throw new Error(`Unexpected request: ${request.url.href}`);
    return {
      body: chunks(reply.body ?? []),
      close: reply.close,
      headers: new Headers(reply.headers),
      status: reply.status ?? 200,
    };
  };
}

function captureRequest(request: PinnedPublicRequest): CapturedRequest {
  return {
    address: { ...request.address },
    headers: { ...request.headers },
    hostHeader: request.hostHeader,
    ...(request.tlsServername === undefined ? {} : { tlsServername: request.tlsServername }),
    url: request.url.href,
  };
}

async function* chunks(values: readonly (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  for (const value of values) {
    yield typeof value === "string" ? encoder.encode(value) : value;
  }
}

function fixedResolver(
  answers: Readonly<Record<string, readonly ResolvedPublicAddress[]>>,
  calls: string[] = [],
): SafePublicDnsResolver {
  return async (hostname) => {
    calls.push(hostname);
    const result = answers[hostname];
    if (result === undefined) throw new Error(`Unexpected hostname: ${hostname}`);
    return result;
  };
}

function publicV4(address = "93.184.216.34"): ResolvedPublicAddress {
  return { address, family: 4 };
}

describe("pinned HTTPS transport lookup", () => {
  test("returns the selected address in both single-address and all-address forms", () => {
    const address = publicV4("8.8.4.4");
    const lookup = createPinnedAddressLookup(address);
    let singleResult: unknown;
    let allResult: unknown;

    lookup("assets.example", { all: false }, (error, result, family) => {
      singleResult = { error, result, family };
    });
    lookup("assets.example", { all: true }, (error, result, family) => {
      allResult = { error, result, family };
    });

    expect(singleResult).toEqual({ error: null, result: "8.8.4.4", family: 4 });
    expect(allResult).toEqual({
      error: null,
      result: [{ address: "8.8.4.4", family: 4 }],
      family: undefined,
    });
  });
});

describe("SafePublicFetcher IP policy", () => {
  test("allows ordinary public unicast addresses", () => {
    expect(isSafePublicIpAddress("8.8.8.8")).toBe(true);
    expect(isSafePublicIpAddress("93.184.216.34")).toBe(true);
    expect(isSafePublicIpAddress("2001:4860:4860::8888")).toBe(true);
    expect(isSafePublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  test("denies private, local, documentation, benchmark, multicast, and reserved addresses", () => {
    const denied = [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.2",
      "203.0.113.3",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:8.8.8.8",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::7f00:1",
      "2001:2::1",
      "2001:db8::1",
      "2002::1",
      "3fff::1",
      "3000::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "not-an-address",
    ];
    denied.forEach((address) => expect(isSafePublicIpAddress(address)).toBe(false));
  });
});

describe("SafePublicFetcher request boundary", () => {
  test("rejects malformed, credentialed, non-HTTPS, and non-default-port URLs before I/O", async () => {
    let resolverCalls = 0;
    let transportCalls = 0;
    const fetcher = new SafePublicFetcher({
      resolver: async () => {
        resolverCalls += 1;
        return [publicV4()];
      },
      transport: async () => {
        transportCalls += 1;
        throw new Error("must not run");
      },
    });

    await expect(fetcher.fetch("not a URL")).rejects.toMatchObject({ kind: "invalid_url" });
    await expect(fetcher.fetch("http://example.com/file")).rejects.toMatchObject({
      kind: "invalid_url",
    });
    await expect(fetcher.fetch("https://user:secret@example.com/file")).rejects.toMatchObject({
      kind: "invalid_url",
    });
    await expect(fetcher.fetch("https://example.com:8443/file")).rejects.toMatchObject({
      kind: "invalid_url",
    });
    expect(resolverCalls).toBe(0);
    expect(transportCalls).toBe(0);
  });

  test("fails closed for unsafe, mixed, empty, or malformed DNS answers", async () => {
    const cases: [string, readonly ResolvedPublicAddress[], string][] = [
      ["private.test", [{ address: "127.0.0.1", family: 4 }], "unsafe_address"],
      ["mixed.test", [publicV4(), { address: "10.0.0.1", family: 4 }], "unsafe_address"],
      ["empty.test", [], "dns_failure"],
      ["mismatch.test", [{ address: "8.8.8.8", family: 6 }], "dns_failure"],
    ];
    let transportCalls = 0;
    for (const [hostname, answers, kind] of cases) {
      const fetcher = new SafePublicFetcher({
        resolver: fixedResolver({ [hostname]: answers }),
        transport: async () => {
          transportCalls += 1;
          throw new Error("must not run");
        },
      });
      await expect(fetcher.fetch(`https://${hostname}/asset`)).rejects.toMatchObject({ kind });
    }

    const literalFetcher = new SafePublicFetcher({
      resolver: async () => {
        throw new Error("IP literals do not need DNS");
      },
      transport: async () => {
        transportCalls += 1;
        throw new Error("must not run");
      },
    });
    await expect(literalFetcher.fetch("https://127.0.0.1/metadata")).rejects.toMatchObject({
      kind: "unsafe_address",
    });
    expect(transportCalls).toBe(0);
  });

  test("pins a vetted address, preserves host identity, and forwards only safe headers", async () => {
    const requests: CapturedRequest[] = [];
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver({ "assets.example": [publicV4("8.8.4.4")] }),
      transport: repliesTransport(
        new Map([
          [
            "https://assets.example/image.png?size=2",
            [
              {
                body: ["abc", "def"],
                headers: { "Content-Type": "image/png" },
                status: 206,
              },
            ],
          ],
        ]),
        requests,
      ),
    });

    const result = await fetcher.fetch("https://assets.example:443/image.png?size=2#ignored", {
      headers: {
        Accept: "image/png",
        Authorization: "Bearer secret",
        Cookie: "session=secret",
        Host: "attacker.test",
        "Proxy-Authorization": "Basic secret",
        "X-Api-Key": "secret",
      },
    });

    expect(requests).toEqual([
      {
        address: publicV4("8.8.4.4"),
        headers: { accept: "image/png", "accept-encoding": "identity" },
        hostHeader: "assets.example",
        tlsServername: "assets.example",
        url: "https://assets.example/image.png?size=2",
      },
    ]);
    expect(decoder.decode(result.bytes)).toBe("abcdef");
    expect(result).toMatchObject({
      finalUrl: "https://assets.example/image.png?size=2",
      redirects: [],
      requestedUrl: "https://assets.example/image.png?size=2",
      status: 206,
    });
    expect(result.headers.get("content-type")).toBe("image/png");
  });

  test("resolves and validates every redirect hop independently", async () => {
    const resolverCalls: string[] = [];
    const requests: CapturedRequest[] = [];
    let redirectsClosed = 0;
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver(
        {
          "first.example": [publicV4("8.8.8.8")],
          "second.example": [publicV4("1.1.1.1")],
        },
        resolverCalls,
      ),
      transport: repliesTransport(
        new Map([
          [
            "https://first.example/start",
            [
              {
                close: () => {
                  redirectsClosed += 1;
                },
                headers: { Location: "https://second.example/final" },
                status: 302,
              },
            ],
          ],
          ["https://second.example/final", [{ body: ["done"], status: 200 }]],
        ]),
        requests,
      ),
    });

    const result = await fetcher.fetch("https://first.example/start");

    expect(resolverCalls).toEqual(["first.example", "second.example"]);
    expect(
      requests.map(({ address, hostHeader, tlsServername }) => ({
        address,
        hostHeader,
        tlsServername,
      })),
    ).toEqual([
      { address: publicV4("8.8.8.8"), hostHeader: "first.example", tlsServername: "first.example" },
      {
        address: publicV4("1.1.1.1"),
        hostHeader: "second.example",
        tlsServername: "second.example",
      },
    ]);
    expect(redirectsClosed).toBe(1);
    expect(result.redirects).toEqual([
      {
        fromUrl: "https://first.example/start",
        location: "https://second.example/final",
        status: 302,
        toUrl: "https://second.example/final",
      },
    ]);
    expect(result.finalUrl).toBe("https://second.example/final");
    expect(decoder.decode(result.bytes)).toBe("done");
  });

  test("stops before requesting an unsafe redirect target", async () => {
    const requests: CapturedRequest[] = [];
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver({
        "first.example": [publicV4()],
        "metadata.internal": [{ address: "169.254.169.254", family: 4 }],
      }),
      transport: repliesTransport(
        new Map([
          [
            "https://first.example/start",
            [{ headers: { Location: "https://metadata.internal/latest" }, status: 307 }],
          ],
        ]),
        requests,
      ),
    });

    await expect(fetcher.fetch("https://first.example/start")).rejects.toMatchObject({
      kind: "unsafe_address",
    });
    expect(requests.map(({ url }) => url)).toEqual(["https://first.example/start"]);
  });

  test("rejects a redirect to a non-default HTTPS port before more I/O", async () => {
    const resolverCalls: string[] = [];
    const requests: CapturedRequest[] = [];
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver({ "first.example": [publicV4()] }, resolverCalls),
      transport: repliesTransport(
        new Map([
          [
            "https://first.example/start",
            [{ headers: { Location: "https://assets.example:8443/file" }, status: 302 }],
          ],
        ]),
        requests,
      ),
    });

    await expect(fetcher.fetch("https://first.example/start")).rejects.toMatchObject({
      kind: "invalid_url",
    });
    expect(resolverCalls).toEqual(["first.example"]);
    expect(requests.map(({ url }) => url)).toEqual(["https://first.example/start"]);
  });

  test("enforces redirect and per-call policy ceilings", async () => {
    const requests: CapturedRequest[] = [];
    const fetcher = new SafePublicFetcher({
      maxBytes: 10,
      maxRedirects: 1,
      resolver: fixedResolver({ "loop.example": [publicV4()] }),
      transport: repliesTransport(
        new Map([
          [
            "https://loop.example/start",
            [
              { headers: { Location: "/start" }, status: 301 },
              { headers: { Location: "/start" }, status: 301 },
            ],
          ],
        ]),
        requests,
      ),
    });

    await expect(fetcher.fetch("https://loop.example/start")).rejects.toMatchObject({
      kind: "too_many_redirects",
    });
    expect(requests).toHaveLength(2);
    await expect(
      fetcher.fetch("https://loop.example/start", { maxBytes: 11 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      fetcher.fetch("https://loop.example/start", { maxRedirects: 2 }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("SafePublicFetcher resource limits", () => {
  test("allows callers to tighten the 16 MiB server default but not widen it", async () => {
    let transportCalls = 0;
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver({ "assets.example": [publicV4()] }),
      transport: async () => {
        transportCalls += 1;
        return { body: chunks(["ok"]), headers: new Headers(), status: 200 };
      },
    });

    await expect(
      fetcher.fetch("https://assets.example/file", { maxBytes: 16 * 1024 * 1024 }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      fetcher.fetch("https://assets.example/file", { maxBytes: 16 * 1024 * 1024 + 1 }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(transportCalls).toBe(1);
  });

  test("accepts only an absent, empty, or single identity Content-Encoding", async () => {
    let bodiesRead = 0;
    let rejectedResponsesClosed = 0;
    const transport: SafePublicTransport = async (request) => {
      const encodingByPath: Record<string, string | undefined> = {
        "/absent": undefined,
        "/empty": "   ",
        "/identity": "  IdEnTiTy  ",
        "/gzip": "gzip",
        "/stacked": "gzip, br",
        "/repeated-identity": "identity, identity",
      };
      const encoding = encodingByPath[request.url.pathname];
      const headers = new Headers({ "Content-Type": "text/plain" });
      if (encoding !== undefined) headers.set("Content-Encoding", encoding);
      return {
        body: (async function* () {
          bodiesRead += 1;
          yield encoder.encode("ok");
        })(),
        close: () => {
          rejectedResponsesClosed += 1;
        },
        headers,
        status: 200,
      };
    };
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver({ "encoding.example": [publicV4()] }),
      transport,
    });

    for (const path of ["absent", "empty", "identity"]) {
      const result = await fetcher.fetch(`https://encoding.example/${path}`);
      expect(decoder.decode(result.bytes)).toBe("ok");
    }
    for (const path of ["gzip", "stacked", "repeated-identity"]) {
      await expect(fetcher.fetch(`https://encoding.example/${path}`)).rejects.toMatchObject({
        kind: "invalid_response",
      });
    }
    expect(bodiesRead).toBe(3);
    expect(rejectedResponsesClosed).toBe(3);
  });

  test("rejects oversized declared and streamed bodies and closes each response", async () => {
    let closed = 0;
    const makeFetcher = (reply: StubReply) =>
      new SafePublicFetcher({
        maxBytes: 5,
        resolver: fixedResolver({ "large.example": [publicV4()] }),
        transport: repliesTransport(
          new Map([
            [
              "https://large.example/file",
              [
                {
                  ...reply,
                  close: () => {
                    closed += 1;
                  },
                },
              ],
            ],
          ]),
        ),
      });

    await expect(
      makeFetcher({ body: ["unused"], headers: { "Content-Length": "6" } }).fetch(
        "https://large.example/file",
      ),
    ).rejects.toMatchObject({ kind: "response_too_large" });
    await expect(
      makeFetcher({ body: ["abc", "def"] }).fetch("https://large.example/file"),
    ).rejects.toMatchObject({ kind: "response_too_large" });
    expect(closed).toBe(2);
  });

  test("times out even when an injected transport ignores cancellation", async () => {
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver({ "slow.example": [publicV4()] }),
      timeoutMs: 10,
      transport: () => new Promise(() => undefined),
    });

    await expect(fetcher.fetch("https://slow.example/file")).rejects.toMatchObject({
      kind: "request_timeout",
    });
  });

  test("bounds in-flight responses across concurrent callers", async () => {
    let releaseBodies!: () => void;
    const bodiesReleased = new Promise<void>((resolve) => {
      releaseBodies = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    const transport: SafePublicTransport = async () => {
      active += 1;
      started += 1;
      maximumActive = Math.max(maximumActive, active);
      return {
        body: (async function* () {
          try {
            await bodiesReleased;
            yield encoder.encode("ok");
          } finally {
            active -= 1;
          }
        })(),
        headers: new Headers(),
        status: 200,
      };
    };
    const fetcher = new SafePublicFetcher({
      maxConcurrentRequests: 2,
      resolver: fixedResolver({ "parallel.example": [publicV4()] }),
      transport,
    });

    const pending = [1, 2, 3].map((id) => fetcher.fetch(`https://parallel.example/${id}`));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(2);
    expect(maximumActive).toBe(2);

    releaseBodies();
    const results = await Promise.all(pending);
    expect(started).toBe(3);
    expect(maximumActive).toBe(2);
    expect(results.map(({ bytes }) => decoder.decode(bytes))).toEqual(["ok", "ok", "ok"]);
  });
});

describe("SafePublicFetcher public-asset adapter", () => {
  test("forwards only Accept and maps a normalized successful response", async () => {
    const requests: CapturedRequest[] = [];
    const fetcher = new SafePublicFetcher({
      maxBytes: 20,
      maxRedirects: 2,
      resolver: fixedResolver({
        "origin.example": [publicV4("8.8.8.8")],
        "cdn.example": [publicV4("1.1.1.1")],
      }),
      transport: repliesTransport(
        new Map([
          [
            "https://origin.example/image",
            [
              {
                headers: { Location: "https://cdn.example/image.png" },
                status: 302,
              },
            ],
          ],
          [
            "https://cdn.example/image.png",
            [
              {
                body: ["png"],
                headers: { "Content-Type": "Image/PNG; Charset=binary" },
                status: 200,
              },
            ],
          ],
        ]),
        requests,
      ),
    });
    const assetFetch = createSafePublicAssetFetcher(fetcher);

    const result = await assetFetch({
      url: "https://origin.example/image",
      accept: "image/*",
      signal: new AbortController().signal,
      maxBytes: 3,
      maxRedirects: 1,
    });

    expect(requests.map(({ headers }) => headers)).toEqual([
      { accept: "image/*", "accept-encoding": "identity" },
      { accept: "image/*", "accept-encoding": "identity" },
    ]);
    expect(result).toEqual({
      requestedUrl: "https://origin.example/image",
      finalUrl: "https://cdn.example/image.png",
      contentType: "image/png",
      bytes: encoder.encode("png"),
      redirects: [
        {
          status: 302,
          from_url: "https://origin.example/image",
          location: "https://cdn.example/image.png",
          to_url: "https://cdn.example/image.png",
        },
      ],
    });
  });

  test("rejects non-200 responses and invalid content types", async () => {
    const fetcher = new SafePublicFetcher({
      resolver: fixedResolver({ "assets.example": [publicV4()] }),
      transport: repliesTransport(
        new Map([
          [
            "https://assets.example/missing",
            [{ headers: { "Content-Type": "text/plain" }, status: 404 }],
          ],
          ["https://assets.example/no-mime", [{ body: ["bytes"], status: 200 }]],
        ]),
      ),
    });
    const assetFetch = createSafePublicAssetFetcher(fetcher);
    const request = {
      accept: "*/*",
      signal: new AbortController().signal,
      maxBytes: 10,
      maxRedirects: 0,
    };

    await expect(
      assetFetch({ ...request, url: "https://assets.example/missing" }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
    await expect(
      assetFetch({ ...request, url: "https://assets.example/no-mime" }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  test("passes stricter byte, redirect, and abort limits through to the boundary", async () => {
    let transportCalls = 0;
    const fetcher = new SafePublicFetcher({
      maxBytes: 10,
      maxRedirects: 2,
      resolver: fixedResolver({ "assets.example": [publicV4()] }),
      transport: async () => {
        transportCalls += 1;
        return {
          body: chunks(["abc"]),
          headers: new Headers({ "Content-Type": "text/plain" }),
          status: 200,
        };
      },
    });
    const assetFetch = createSafePublicAssetFetcher(fetcher);

    await expect(
      assetFetch({
        url: "https://assets.example/file",
        accept: "*/*",
        signal: new AbortController().signal,
        maxBytes: 2,
        maxRedirects: 0,
      }),
    ).rejects.toMatchObject({ kind: "response_too_large" });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      assetFetch({
        url: "https://assets.example/file",
        accept: "*/*",
        signal: aborted.signal,
        maxBytes: 2,
        maxRedirects: 0,
      }),
    ).rejects.toMatchObject({ kind: "aborted" });
    expect(transportCalls).toBe(1);
  });
});
