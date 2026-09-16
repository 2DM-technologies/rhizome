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
    error: operationErrorForViewer(operation, options.exposeOwnerOnlyResult),
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
  if (operation.request.mode === "push") {
    const { resolved: _resolved, ...request } = operation.request;
    return request;
  }
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
  if (operation.request.mode === "push" && operation.result && !exposeOwnerOnlyResult) {
    const { usage: _usage, ...result } = operation.result;
    return result;
  }
  if (
    exposeOwnerOnlyResult ||
    operation.kind !== "pull" ||
    operation.request.mode !== "pull" ||
    !operation.result
  ) {
    return operation.result;
  }

  if (isOwnerSourceAction(operation.result)) {
    // A pull grantee may learn that owner action is required, but not which connected source
    // failed, its continuation bearer, or any provider-private action state.
    return {
      action: "review_import",
      code: "source_action_required",
      owner_action_required: true,
    };
  }

  // Skill/parser failures are owner-private. A pull grant authorizes invoking the source,
  // not inspecting diagnostics or structured failure state returned by its implementation.
  if (operation.status === "failed") return null;

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

function operationErrorForViewer(
  operation: DbOperation,
  exposeOwnerOnlyResult: boolean,
): string | null {
  if (!exposeOwnerOnlyResult && operation.kind === "pull" && operation.request.mode === "pull") {
    if (isOwnerSourceAction(operation.result)) {
      return "The connected source owner must review an import before pulling again.";
    }
    return operation.error ? "The pull operation could not complete." : null;
  }
  return operation.error;
}

function isOwnerSourceAction(result: DbOperation["result"]): boolean {
  return result?.code === "source_action_required";
}
