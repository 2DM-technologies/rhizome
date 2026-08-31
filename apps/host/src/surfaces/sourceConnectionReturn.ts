import type { SourceConnectionAttemptDocument } from "@rhizome/store-contract";
import { UUIDV7_PATTERN } from "@rnet/types/patterns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { uriOf } from "../api/uris.ts";
import { useSourceConnectionAttempt } from "../queries/index.ts";

const SOURCE_CONNECTION_PARAMETER = "source_connection";
const SOURCE_CONNECTION_ERROR_PARAMETER = "source_connection_error";
const CALLBACK_FAILURE = "callback_failed";
const UUID_V7 = new RegExp(UUIDV7_PATTERN);

export type ExpectedImportDestination =
  { readonly kind: "new_vibe" } | { readonly kind: "existing_vibe"; readonly vibeUuid: string };

type CapturedConnection =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "callback_failure" }
  | { readonly kind: "attempt"; readonly id: string };

export interface SourceConnectionReturn {
  readonly attemptId?: string;
  readonly attempt?: SourceConnectionAttemptDocument;
  readonly isPending: boolean;
  /** Safe, generic message for any terminal callback-marker or attempt-loading failure. */
  readonly failureMessage?: string;
  /** Removes the one-shot callback marker without retaining it in browser storage or history. */
  readonly consume: () => void;
}

/**
 * Captures an OAuth callback marker during render, before shell URL reconciliation can replace
 * search parameters. The durable attempt remains the source of truth; no connection state is
 * copied to localStorage or sessionStorage.
 */
export function useSourceConnectionReturn(
  expected: ExpectedImportDestination,
): SourceConnectionReturn {
  const location = useLocation();
  const navigate = useNavigate();
  const expectedPath = expected.kind === "new_vibe" ? "/imports" : `/vibes/${expected.vibeUuid}`;
  const parsed = useMemo(
    () =>
      pathsMatch(location.pathname, expectedPath)
        ? connectionFromSearch(location.search)
        : ({ kind: "none" } as const),
    [expectedPath, location.pathname, location.search],
  );
  const [captured, setCaptured] = useState<CapturedConnection>(parsed);

  useEffect(() => {
    if (parsed.kind !== "none") setCaptured(parsed);
  }, [parsed]);

  const attemptId = captured.kind === "attempt" ? captured.id : undefined;
  const query = useSourceConnectionAttempt(attemptId);
  const destinationError = query.data
    ? destinationMatches(query.data, expected)
      ? undefined
      : "This source connection does not belong to this import destination. Start the connection again."
    : undefined;
  const failureMessage = sourceConnectionReturnFailureMessage({
    callbackFailed: captured.kind === "callback_failure",
    invalidParameter: captured.kind === "invalid",
    destinationError,
    loadFailed: query.isError,
  });

  const consume = useCallback(() => {
    setCaptured({ kind: "none" });
    if (!pathsMatch(location.pathname, expectedPath)) return;
    const parameters = new URLSearchParams(location.search);
    if (
      !parameters.has(SOURCE_CONNECTION_PARAMETER) &&
      !parameters.has(SOURCE_CONNECTION_ERROR_PARAMETER)
    ) {
      return;
    }
    parameters.delete(SOURCE_CONNECTION_PARAMETER);
    parameters.delete(SOURCE_CONNECTION_ERROR_PARAMETER);
    const search = parameters.toString();
    void navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  }, [expectedPath, location.hash, location.pathname, location.search, navigate]);

  return {
    attemptId,
    attempt: query.data,
    isPending: query.isPending && Boolean(attemptId),
    failureMessage,
    consume,
  };
}

export function sourceConnectionReturnFailureMessage(input: {
  readonly callbackFailed: boolean;
  readonly invalidParameter: boolean;
  readonly destinationError?: string;
  readonly loadFailed: boolean;
}): string | undefined {
  if (input.callbackFailed) {
    return "The source connection could not be completed. Start the connection again.";
  }
  if (input.invalidParameter) {
    return "The source connection return was invalid. Start the connection again.";
  }
  if (input.destinationError) return input.destinationError;
  if (input.loadFailed) {
    return "The source connection could not be loaded. Start the connection again.";
  }
  return undefined;
}

function connectionFromSearch(search: string): CapturedConnection {
  const parameters = new URLSearchParams(search);
  const attempts = parameters.getAll(SOURCE_CONNECTION_PARAMETER);
  const errors = parameters.getAll(SOURCE_CONNECTION_ERROR_PARAMETER);
  if (attempts.length === 0 && errors.length === 0) return { kind: "none" };
  if (attempts.length === 1 && errors.length === 0 && UUID_V7.test(attempts[0] ?? "")) {
    return { kind: "attempt", id: attempts[0]! };
  }
  if (attempts.length === 0 && errors.length === 1 && errors[0] === CALLBACK_FAILURE) {
    return { kind: "callback_failure" };
  }
  return { kind: "invalid" };
}

function pathsMatch(left: string, right: string): boolean {
  return left.replace(/\/$/u, "") === right.replace(/\/$/u, "");
}

function destinationMatches(
  attempt: SourceConnectionAttemptDocument,
  expected: ExpectedImportDestination,
): boolean {
  const destination = attempt.intent.destination;
  if (expected.kind === "new_vibe") return destination.kind === "new_vibe";
  return (
    destination.kind === "existing_vibe" &&
    destination.id.toLocaleLowerCase() === uriOf("vibe", expected.vibeUuid).toLocaleLowerCase()
  );
}
