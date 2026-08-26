import type { RnetRecordKind } from "@rnet/types";

/**
 * Records travel as `rnet://{kind}/{uuid}` but the store's routes take a bare uuid, so the
 * two forms meet constantly. `@rnet/types` supplies patterns for *validating* a URI; these
 * are the parse and format pair, which it deliberately does not have.
 *
 * The type import is erased at build time, so this module costs nothing at runtime and can
 * be imported by the router without dragging the HTTP client along with it.
 */

/** The uuid of an `rnet://` record URI. Throws rather than returning a wrong id silently. */
export function uuidOf(uri: string): string {
  const separator = uri.lastIndexOf("/");
  const uuid = separator === -1 ? "" : uri.slice(separator + 1);
  if (!uuid) throw new Error(`Not an rnet record URI: ${uri}`);
  return uuid;
}

/** The `rnet://` URI for a record kind and uuid. */
export function uriOf(kind: RnetRecordKind, uuid: string): string {
  return `rnet://${kind}/${uuid}`;
}
