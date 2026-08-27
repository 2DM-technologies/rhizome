import { expect, test } from "bun:test";
import createClient from "openapi-fetch";

import { serializeRequestBody, StoreRequest } from "../src/api/bodySerializer.ts";
import type { paths } from "../src/api/generated/openapi.ts";

test("generated binary uploads preserve bytes and their required content type", async () => {
  let captured: Request | undefined;
  const client = createClient<paths>({
    baseUrl: "http://rhizome.test",
    bodySerializer: serializeRequestBody,
    Request: StoreRequest,
    fetch: async (request) => {
      captured = request;
      return new Response("{}", {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  await client.POST("/rnet/v0/elements", {
    params: {
      header: {
        "x-rnet-kind": "text",
      },
    },
    body: new Blob(["hello"], { type: "text/plain" }),
  });

  expect(captured?.headers.get("Content-Type")?.split(";", 1)[0]).toBe("text/plain");
  expect(await captured?.text()).toBe("hello");
});

test("multipart and JSON bodies keep their native encodings", () => {
  const form = new FormData();
  expect(serializeRequestBody(form)).toBe(form);
  expect(serializeRequestBody({ title: "Vibe" })).toBe('{"title":"Vibe"}');
});
