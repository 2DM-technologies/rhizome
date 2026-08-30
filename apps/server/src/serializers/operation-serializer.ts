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
    request: operationRequestForViewer(operation, options.exposeOwnerOnlyResult),
    result: operationResultForViewer(operation, options.exposeOwnerOnlyResult),
    error: operation.error,
    created_at: operation.createdAt.toISOString(),
    ...(operation.reviewDigest ? { review_digest: operation.reviewDigest } : {}),
    ...(operation.committedAt ? { committed_at: operation.committedAt.toISOString() } : {}),
    ...(operation.finishedAt ? { finished_at: operation.finishedAt.toISOString() } : {}),
  };
}

function operationRequestForViewer(
  operation: DbOperation,
  exposeOwnerOnlyResult: boolean,
): DbOperation["request"] {
  if (exposeOwnerOnlyResult || operation.kind !== "pull" || operation.request.mode !== "pull") {
    return operation.request;
  }
  const { sources: _sources, ...safeRequest } = operation.request;
  return safeRequest;
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

  if (isOwnerSimpleFinRecovery(operation.result)) {
    // A pull grantee may learn that owner action is required, but not which connected banking
    // source failed or why its transaction history no longer reconciles.
    return {
      code: "simplefin_history_gap",
      recovery: "owner_reviewed_rebaseline",
    };
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

function isOwnerSimpleFinRecovery(result: DbOperation["result"]): boolean {
  return (
    result?.code === "simplefin_history_gap" &&
    result.recovery === "reviewed_rebaseline" &&
    typeof result.source === "string"
  );
}
