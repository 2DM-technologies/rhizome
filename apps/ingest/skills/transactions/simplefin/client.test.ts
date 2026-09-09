import { describe, expect, test } from "bun:test";

import { SimpleFinClient } from "./client.ts";

const allowedHosts = ["bridge.simplefin.test"];
const claimUrl = "https://bridge.simplefin.test/simplefin/claim/once";
const setupToken = Buffer.from(claimUrl).toString("base64");
const accessUrl = "https://alice:secret@bridge.simplefin.test/simplefin";

describe("SimpleFIN HTTP client", () => {
  test("claims a one-time setup token without exposing access credentials to callers", async () => {
    const requests: Request[] = [];
    const client = new SimpleFinClient({
      allowedHosts,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(`${accessUrl}\n`);
      },
    });

    expect(await client.claimSetupToken(setupToken)).toBe(accessUrl);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(claimUrl);
    expect(requests[0]?.method).toBe("POST");
  });

  test("fetches v2 accounts with Basic Auth and returns the exact response bytes", async () => {
    const requests: Request[] = [];
    const payload = await Bun.file(fixture("accounts-current-v2.json")).text();
    const client = new SimpleFinClient({
      allowedHosts,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(payload, { headers: { "Content-Type": "application/json" } });
      },
    });

    const bytes = await client.fetchAccounts(accessUrl);
    expect(new TextDecoder().decode(bytes)).toBe(payload);
    expect(requests[0]?.url).toBe("https://bridge.simplefin.test/simplefin/accounts?version=2");
    expect(requests[0]?.headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    );
    expect(requests[0]?.url).not.toContain("secret");
  });

  test("sends a bounded date window, unique account filters, and pending when configured", async () => {
    const requests: Request[] = [];
    const client = new SimpleFinClient({
      allowedHosts,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response('{"errlist":[],"connections":[],"accounts":[]}');
      },
    });

    await client.fetchAccounts(accessUrl, {
      accountIds: ["shared", "other", "shared"],
      startDateEpoch: 1_700_000_000,
      endDateEpoch: 1_707_776_000,
      includePending: true,
    });
    expect(requests[0]?.url).toBe(
      "https://bridge.simplefin.test/simplefin/accounts?version=2&start-date=1700000000&end-date=1707776000&account=other&account=shared&pending=1",
    );
  });

  test("rejects malformed or reversed date windows before making a request", async () => {
    const requests: Request[] = [];
    const client = new SimpleFinClient({
      allowedHosts,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response('{"errlist":[],"connections":[],"accounts":[]}');
      },
    });

    await expect(client.fetchAccounts(accessUrl, { startDateEpoch: -1 })).rejects.toThrow(
      "non-negative integer",
    );
    await expect(
      client.fetchAccounts(accessUrl, { startDateEpoch: 20, endDateEpoch: 10 }),
    ).rejects.toThrow("must not exceed");
    expect(requests).toHaveLength(0);
  });

  test("follows only same-origin HTTPS redirects", async () => {
    const requests: Request[] = [];
    const client = new SimpleFinClient({
      allowedHosts,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return requests.length === 1
          ? new Response(null, { status: 307, headers: { Location: "/v2/accounts" } })
          : new Response('{"errlist":[],"connections":[],"accounts":[]}');
      },
    });

    await client.fetchAccounts(accessUrl);
    expect(requests.map((request) => request.url)).toEqual([
      "https://bridge.simplefin.test/simplefin/accounts?version=2",
      "https://bridge.simplefin.test/v2/accounts",
    ]);

    const crossOrigin = new SimpleFinClient({
      allowedHosts: [...allowedHosts, "other.simplefin.test"],
      fetch: async () =>
        new Response(null, {
          status: 307,
          headers: { Location: "https://other.simplefin.test/accounts" },
        }),
    });
    await expect(crossOrigin.fetchAccounts(accessUrl)).rejects.toMatchObject({
      kind: "unsafe_endpoint",
    });
  });

  test("fails closed for unsafe URLs, reused tokens, revoked access, and oversized data", async () => {
    const noNetwork = new SimpleFinClient({
      allowedHosts,
      fetch: async () => {
        throw new Error("network should not be reached");
      },
    });
    const unsafeToken = Buffer.from("http://127.0.0.1/simplefin/claim/token").toString("base64");
    await expect(noNetwork.claimSetupToken(unsafeToken)).rejects.toMatchObject({
      kind: "invalid_setup_token",
    });

    const claimRejected = new SimpleFinClient({
      allowedHosts,
      fetch: async () => new Response(null, { status: 403 }),
    });
    await expect(claimRejected.claimSetupToken(setupToken)).rejects.toMatchObject({
      kind: "claim_rejected",
      message: expect.stringContaining("compromised"),
    });
    await expect(claimRejected.claimSetupToken(setupToken)).rejects.toMatchObject({
      message: expect.stringContaining("disable"),
    });

    const customPortToken = Buffer.from(
      "https://bridge.simplefin.test:444/simplefin/claim/token",
    ).toString("base64");
    await expect(noNetwork.claimSetupToken(customPortToken)).rejects.toMatchObject({
      kind: "invalid_setup_token",
    });

    const accessRejected = new SimpleFinClient({
      allowedHosts,
      fetch: async () => new Response(null, { status: 403 }),
    });
    await expect(accessRejected.fetchAccounts(accessUrl)).rejects.toMatchObject({
      kind: "provider_rejected",
    });

    const oversized = new SimpleFinClient({
      allowedHosts,
      maxAccountsBytes: 4,
      fetch: async () => new Response("12345"),
    });
    await expect(oversized.fetchAccounts(accessUrl)).rejects.toMatchObject({
      kind: "response_too_large",
    });
  });

  test("enforces one deadline across provider fetches and streaming bodies", async () => {
    let fetchSignal: AbortSignal | null = null;
    let providerSettled = false;
    const stalledFetch = new SimpleFinClient({
      allowedHosts,
      requestTimeoutMs: 10,
      fetch: async (_input, init) => {
        fetchSignal = init?.signal ?? null;
        if (!fetchSignal) throw new Error("Expected a provider abort signal");
        return new Promise<Response>((_resolve, reject) => {
          const rejectOnAbort = () => {
            providerSettled = true;
            reject(fetchSignal?.reason);
          };
          if (fetchSignal?.aborted) rejectOnAbort();
          else fetchSignal?.addEventListener("abort", rejectOnAbort, { once: true });
        });
      },
    });
    await expect(stalledFetch.claimSetupToken(setupToken)).rejects.toMatchObject({
      kind: "request_timeout",
      message: expect.stringContaining("outcome is unknown"),
    });
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(providerSettled).toBe(true);

    let bodyCancelled = false;
    const stalledBody = new SimpleFinClient({
      allowedHosts,
      requestTimeoutMs: 10,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
            },
            cancel() {
              bodyCancelled = true;
            },
          }),
        ),
    });
    await expect(stalledBody.fetchAccounts(accessUrl)).rejects.toMatchObject({
      kind: "request_timeout",
    });
    expect(bodyCancelled).toBe(true);
  });

  test("combines caller cancellation with the request deadline", async () => {
    let fetchSignal: AbortSignal | undefined;
    let providerSettled = false;
    const client = new SimpleFinClient({
      allowedHosts,
      requestTimeoutMs: 60_000,
      fetch: async (_input, init) => {
        fetchSignal = init?.signal ?? undefined;
        if (!fetchSignal) throw new Error("Expected a provider abort signal");
        return new Promise<Response>((_resolve, reject) => {
          const rejectOnAbort = () => {
            providerSettled = true;
            reject(fetchSignal?.reason);
          };
          if (fetchSignal?.aborted) rejectOnAbort();
          else fetchSignal?.addEventListener("abort", rejectOnAbort, { once: true });
        });
      },
    });
    const caller = new AbortController();
    const reason = new Error("caller cancelled");

    const retrieval = client.fetchAccounts(accessUrl, {}, caller.signal);
    caller.abort(reason);

    await expect(retrieval).rejects.toBe(reason);
    expect(fetchSignal?.aborted).toBe(true);
    expect(providerSettled).toBe(true);
  });
});

function fixture(name: string): URL {
  return new URL(`./fixtures/${name}`, import.meta.url);
}
