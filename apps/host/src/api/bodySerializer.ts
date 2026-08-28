/** Preserve web-native request bodies; JSON-encode the API's structured bodies. */
export function serializeRequestBody(body: unknown): BodyInit | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    (body instanceof Blob || body instanceof FormData)
  ) {
    return body;
  }
  return JSON.stringify(body);
}

/**
 * `openapi-fetch` defaults every non-FormData body to JSON. A Blob is already encoded, and its
 * media type is the request Content-Type unless the Blob has no declared type.
 */
export class StoreRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (!(init?.body instanceof Blob)) {
      super(input, init);
      return;
    }

    const headers = new Headers(init.headers);
    headers.set("Content-Type", init.body.type || "application/octet-stream");
    super(input, { ...init, headers });
  }
}
