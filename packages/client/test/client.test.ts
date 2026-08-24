import { describe, expect, test } from "bun:test";

import { createRhizomeClient } from "../src/index.ts";

describe("generated Rhizome client", () => {
  test("serializes JSON and adds a dynamic bearer token", async () => {
    const requests: Request[] = [];
    const client = createRhizomeClient({
      baseUrl: "http://rhizome.test/",
      token: async () => "test-token",
      fetch: recordingFetch(requests, {}),
    });

    await client.POST("/rnet/v0/vibes", { body: { title: "My Vibe" } });

    const request = requiredRequest(requests[0]);
    expect(request.url).toBe("http://rhizome.test/rnet/v0/vibes");
    expect(request.headers.get("Authorization")).toBe("Bearer test-token");
    expect(await request.json()).toEqual({ title: "My Vibe" });
  });

  test("serializes multipart upload maps as FormData", async () => {
    const requests: Request[] = [];
    const client = createRhizomeClient({
      baseUrl: "http://rhizome.test",
      fetch: recordingFetch(requests, { mediaObjects: [] }),
    });
    const metadata = JSON.stringify({ objects: [{ type: "note" }] });

    await client.POST("/rnet/v0/objects", {
      body: { metadata, attachment: new Blob(["hello"], { type: "text/plain" }) },
    });

    const request = requiredRequest(requests[0]);
    expect(request.headers.get("Content-Type")?.startsWith("multipart/form-data; boundary=")).toBe(
      true,
    );
    const form = await request.formData();
    expect(form.get("metadata")).toBe(metadata);
    expect(await (form.get("attachment") as File).text()).toBe("hello");
  });

  test("passes binary bodies through without JSON encoding", async () => {
    const requests: Request[] = [];
    const client = createRhizomeClient({
      baseUrl: "http://rhizome.test",
      fetch: recordingFetch(requests, {}),
    });

    await client.POST("/rnet/v0/elements", {
      body: new Blob(["hello"], { type: "text/plain" }),
      headers: { "Content-Type": "text/plain", "X-Rnet-Kind": "text" },
    });

    const request = requiredRequest(requests[0]);
    expect(request.headers.get("Content-Type")).toBe("text/plain");
    expect(request.headers.get("X-Rnet-Kind")).toBe("text");
    expect(await request.text()).toBe("hello");
  });
});

function recordingFetch(requests: Request[], responseBody: unknown): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(input instanceof Request ? input.clone() : new Request(input, init));
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

function requiredRequest(request: Request | undefined): Request {
  if (!request) throw new Error("Expected a recorded request");
  return request;
}
