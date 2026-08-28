import type { Page, Request, Route } from "@playwright/test";
import type { MediaElement, MediaObject, Vibe } from "@rnet/types";

export const OWNER_ID = "0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b47";
export const VIBE_ID = "0198f2a1-a09b-76aa-95d8-fc5b55b41fd2";
export const NEW_VIBE_ID = "0198f2a1-d3be-79dd-88ab-2f8e88e74cf5";
export const OBJECT_ID = "0198f2a1-b19c-77bb-a6e9-0d6c66c52ae3";
export const ELEMENT_ID = "0198f2a1-c2ad-78cc-b7fa-1e7d77d63bf4";

export const VIBE_URI = `rnet://vibe/${VIBE_ID}` as const;
export const OBJECT_URI = `rnet://object/${OBJECT_ID}` as const;
export const ELEMENT_URI = `rnet://element/${ELEMENT_ID}` as const;
export const PAYLOAD_TEXT = "A seeded payload for browser tests.\n";

const fixtureVibe = {
  rnet_schema: "0.1",
  uri: VIBE_URI,
  owner: `rnet://id/${OWNER_ID}`,
  title: "Spending",
  objects: [OBJECT_URI],
  created_at: "2026-08-27T12:00:00.000Z",
  grants: [],
  inferred: {},
} satisfies Vibe;

const fixtureObject = {
  rnet_schema: "0.1",
  uri: OBJECT_URI,
  owner: `rnet://id/${OWNER_ID}`,
  type: "note",
  elements: [ELEMENT_URI],
  source: {
    ingest: { method: "authored", reproducible: false },
    origins: ["rnet://client/0198f2a1-7c3d-7e4b-9f21-3a5c8d0e1b48"],
    properties: { title: "Monthly plan" },
  },
  user: { properties: { reviewed: false }, updated_at: "2026-08-27T12:00:00.000Z" },
} satisfies MediaObject;

const fixtureElement = {
  rnet_schema: "0.1",
  kind: "text",
  uri: ELEMENT_URI,
  owner: `rnet://id/${OWNER_ID}`,
  content_hash: "sha256:ddc08041941729fa9a0bdc8703756e531b8b187e3af3bc7455a424c7691d62db",
  mime: "text/plain",
  bytes: `http://127.0.0.1/rnet/v0/elements/${ELEMENT_ID}/bytes`,
  byte_size: PAYLOAD_TEXT.length,
  created_at: "2026-08-27T12:00:00.000Z",
} satisfies MediaElement;

export interface MockStore {
  readonly requests: Request[];
  readonly vibes: Vibe[];
  readonly objects: Map<string, MediaObject>;
  readonly elements: Map<string, MediaElement>;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function problem(route: Route, status: number, code: string, detail: string) {
  return route.fulfill({
    status,
    contentType: "application/problem+json",
    body: JSON.stringify({
      type: `https://rhizome.tools/problems/${code.replaceAll("_", "-")}`,
      title: status === 404 ? "Not found" : "Invalid request",
      status,
      detail,
      code,
    }),
  });
}

function noContent(route: Route) {
  return route.fulfill({ status: 204 });
}

/**
 * A stateful Store boundary for browser tests that exercise the real generated client and Query
 * integration without sharing Postgres or object-storage state with the server suites.
 */
export async function installMockStore(page: Page): Promise<MockStore> {
  const store: MockStore = {
    requests: [],
    vibes: [structuredClone(fixtureVibe)],
    objects: new Map([[OBJECT_ID, structuredClone(fixtureObject)]]),
    elements: new Map([[ELEMENT_ID, structuredClone(fixtureElement)]]),
  };

  await page.route("**/rnet/v0/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    store.requests.push(request);

    if (method === "GET" && path === "/rnet/v0/vibes") {
      return json(route, { vibes: store.vibes });
    }

    if (method === "POST" && path === "/rnet/v0/vibes") {
      const input = request.postDataJSON() as { title: string };
      const vibe = {
        rnet_schema: "0.1",
        uri: `rnet://vibe/${NEW_VIBE_ID}`,
        owner: `rnet://id/${OWNER_ID}`,
        title: input.title,
        objects: [],
        created_at: "2026-08-27T12:02:00.000Z",
        grants: [],
        inferred: {},
      } satisfies Vibe;
      store.vibes.push(vibe);
      return json(route, vibe, 201);
    }

    const vibeObjects = path.match(/^\/rnet\/v0\/vibes\/([^/]+)\/objects$/);
    if (vibeObjects) {
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibeObjects[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (method === "GET") {
        return json(route, {
          mediaObjects: vibe.objects.flatMap((uri) => {
            const object = store.objects.get(uri.split("/").at(-1) ?? "");
            return object ? [object] : [];
          }),
        });
      }
      if (method === "POST" || method === "DELETE") {
        const input = request.postDataJSON() as { objects: string[] };
        if (method === "POST") vibe.objects.push(...input.objects);
        else vibe.objects = vibe.objects.filter((uri) => !input.objects.includes(uri));
        return noContent(route);
      }
    }

    const vibeDocument = path.match(/^\/rnet\/v0\/vibes\/([^/]+)$/);
    if (vibeDocument) {
      const id = vibeDocument[1] ?? "";
      const vibe = store.vibes.find((candidate) => candidate.uri.endsWith(`/${vibeDocument[1]}`));
      if (!vibe) return problem(route, 404, "not_found", "The Vibe does not exist");
      if (method === "GET") return json(route, vibe);
      if (method === "PATCH") {
        const input = request.postDataJSON() as { title?: string };
        if (input.title !== undefined) vibe.title = input.title;
        return json(route, vibe);
      }
      if (method === "DELETE") {
        store.vibes.splice(
          store.vibes.findIndex((candidate) => candidate.uri.endsWith(`/${id}`)),
          1,
        );
        return noContent(route);
      }
    }

    const elementBytes = path.match(/^\/rnet\/v0\/elements\/([^/]+)\/bytes$/);
    if (method === "GET" && elementBytes) {
      const element = store.elements.get(elementBytes[1] ?? "");
      if (!element) return problem(route, 404, "not_found", "The element does not exist");
      return route.fulfill({ status: 200, contentType: element.mime, body: PAYLOAD_TEXT });
    }

    const elementDocument = path.match(/^\/rnet\/v0\/elements\/([^/]+)$/);
    if (method === "GET" && elementDocument) {
      const element = store.elements.get(elementDocument[1] ?? "");
      return element
        ? json(route, element)
        : problem(route, 404, "not_found", "The element does not exist");
    }

    const objectDocument = path.match(/^\/rnet\/v0\/objects\/([^/]+)$/);
    if (method === "GET" && objectDocument) {
      const object = store.objects.get(objectDocument[1] ?? "");
      return object
        ? json(route, object)
        : problem(route, 404, "not_found", "The object does not exist");
    }

    const setUser = path.match(/^\/rnet\/v0\/objects\/([^/]+)\/user$/);
    if (method === "PATCH" && setUser) {
      const id = setUser[1] ?? "";
      const object = store.objects.get(id);
      if (!object) return problem(route, 404, "not_found", "The object does not exist");
      const input = request.postDataJSON() as { properties: Record<string, unknown> };
      const updated: MediaObject = {
        ...object,
        user: { properties: input.properties, updated_at: "2026-08-27T12:01:00.000Z" },
      };
      store.objects.set(id, updated);
      return json(route, updated);
    }

    return problem(route, 404, "not_found", `No mock route for ${method} ${path}`);
  });

  return store;
}
