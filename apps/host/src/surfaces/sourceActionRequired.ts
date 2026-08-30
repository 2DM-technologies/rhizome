import {
  SOURCE_ID_PATTERN,
  type ProblemDocument,
  type SourceActionRequired,
} from "@rhizome/store-contract";

const sourceIdPattern = new RegExp(SOURCE_ID_PATTERN);
const requiredActionKeys = new Set([
  "action",
  "continuation_token",
  "detail",
  "kind",
  "source",
  "title",
]);

/**
 * Extracts an owner-visible, provider-neutral review continuation for a source already configured
 * on this Vibe. A required action can arrive in an immediate RFC 9457 Problem or in the result of
 * a failed, polled operation. Delegated results intentionally omit the source and bearer token.
 */
export function sourceActionRequired(
  synchronousError: unknown,
  failedOperationResult: unknown,
  configuredSources: readonly string[],
): SourceActionRequired | undefined {
  const action =
    actionFromProblem(synchronousError) ?? actionFromOperationResult(failedOperationResult);
  if (!action || !configuredSources.includes(action.source)) return undefined;
  return action;
}

function actionFromProblem(value: unknown): SourceActionRequired | undefined {
  if (!isProblemDocument(value) || value.code !== "source_action_required") return undefined;
  return parseRequiredAction(value.required_action);
}

function actionFromOperationResult(value: unknown): SourceActionRequired | undefined {
  if (!isRecord(value) || value.code !== "source_action_required") return undefined;
  return parseRequiredAction(value.required_action);
}

function parseRequiredAction(value: unknown): SourceActionRequired | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== requiredActionKeys.size ||
    Object.keys(value).some((key) => !requiredActionKeys.has(key)) ||
    value.kind !== "source_action_required" ||
    value.action !== "review_import" ||
    !boundedString(value.title, 1, 256) ||
    !boundedString(value.detail, 1, 2_048) ||
    typeof value.source !== "string" ||
    !sourceIdPattern.test(value.source) ||
    !boundedString(value.continuation_token, 32, 8_192) ||
    /\s/u.test(value.continuation_token)
  ) {
    return undefined;
  }

  return {
    kind: "source_action_required",
    action: "review_import",
    title: value.title,
    detail: value.detail,
    source: value.source,
    continuation_token: value.continuation_token,
  };
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isProblemDocument(value: unknown): value is ProblemDocument {
  if (!isRecord(value)) return false;
  return (
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "number" &&
    typeof value.detail === "string" &&
    typeof value.code === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
