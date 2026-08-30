import type {
  PublicAssetFetcher,
  PublicAssetRedirect,
} from "../../../ingest/public-sources/types.ts";

import { SafePublicFetchError, type SafePublicFetcher } from "./safe-public-fetcher.ts";

const MIME = /^[a-z]+\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** Bridges the server-owned egress boundary to the provider-neutral public-skill contract. */
export function createSafePublicAssetFetcher(fetcher: SafePublicFetcher): PublicAssetFetcher {
  return async (request) => {
    const response = await fetcher.fetch(request.url, {
      headers: { Accept: request.accept },
      maxBytes: request.maxBytes,
      maxRedirects: request.maxRedirects,
      signal: request.signal,
    });
    if (response.status !== 200) {
      throw new SafePublicFetchError(
        "invalid_response",
        `Public asset request failed with HTTP ${response.status}`,
      );
    }
    return {
      requestedUrl: response.requestedUrl,
      finalUrl: response.finalUrl,
      contentType: normalizedContentType(response.headers.get("content-type")),
      bytes: response.bytes,
      redirects: response.redirects.map(mapRedirect),
    };
  };
}

function normalizedContentType(value: string | null): string {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!MIME.test(mime)) {
    throw new SafePublicFetchError(
      "invalid_response",
      "Public asset response had an invalid Content-Type",
    );
  }
  return mime;
}

function mapRedirect(redirect: {
  readonly fromUrl: string;
  readonly location: string;
  readonly status: number;
  readonly toUrl: string;
}): PublicAssetRedirect {
  return {
    status: redirect.status,
    from_url: redirect.fromUrl,
    location: redirect.location,
    to_url: redirect.toUrl,
  };
}
