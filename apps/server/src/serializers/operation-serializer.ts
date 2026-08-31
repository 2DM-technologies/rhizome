import type { OperationDocument } from "@rhizome/store-contract";

import type { DbOperation } from "../db/models/operation.ts";

export function serializeOperation(
  operation: DbOperation,
  options: { exposeOwnerOnlyResult: boolean },
): OperationDocument {
  return {
    operation_id: operation.uuid,
    kind: operation.kind,
    status: operation.status,
    request: operation.request,
    result: operationResultForViewer(operation, options.exposeOwnerOnlyResult),
    error: operation.error,
    created_at: operation.createdAt.toISOString(),
    ...(operation.reviewDigest ? { review_digest: operation.reviewDigest } : {}),
    ...(operation.committedAt ? { committed_at: operation.committedAt.toISOString() } : {}),
    ...(operation.finishedAt ? { finished_at: operation.finishedAt.toISOString() } : {}),
  };
}

function operationResultForViewer(
  operation: DbOperation,
  exposeOwnerOnlyResult: boolean,
): DbOperation["result"] {
  if (
    exposeOwnerOnlyResult ||
    operation.kind !== "pull" ||
    operation.request.mode !== "pull" ||
    !operation.result
  ) {
    return operation.result;
  }

  // A pull grant authorizes refreshing configured sources, not learning the owner-only
  // OriginArtifact identifiers embedded in candidate provenance. Redact at read time too:
  // otherwise a grantee could poll an operation that the owner originally invoked.
  const {
    candidates: _candidates,
    elements: _elements,
    source_results: _sourceResults,
    staged_origin: _stagedOrigin,
    ...safeResult
  } = operation.result;
  return { ...safeResult, candidates: [], elements: [], source_results: [] };
}
