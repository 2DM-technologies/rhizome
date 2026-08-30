import type {
  ConnectedSourceActionKind,
  SourceJsonValue,
} from "../../../ingest/connected-sources/types.ts";

import type { SourceCredentialCrypto } from "./source-credential-crypto.ts";

const MAX_RESUME_BYTES = 4_096;
const MAX_RESUME_DEPTH = 16;
const MAX_TOKEN_BYTES = 8_192;
const TOKEN_TTL_SECONDS = 15 * 60;
const TOKEN_VERSION = 1;

export interface ConnectedSourceContinuation {
  expectedSourceStateDigest: string;
  kind: ConnectedSourceActionKind;
  resume: SourceJsonValue;
}

export interface SourceContinuationContext {
  ownerUuid: string;
  source: string;
  sourceStateDigest: string;
  vibeUuid: string;
}

interface SourceContinuationPayload {
  action: ConnectedSourceActionKind;
  expires_at: number;
  resume: SourceJsonValue;
  source_state_digest: string;
  v: 1;
}

/** All untrusted-token failures deliberately collapse to one public-safe error. */
export class SourceContinuationTokenError extends Error {
  constructor() {
    super("The source continuation token is invalid or expired");
    this.name = "SourceContinuationTokenError";
  }
}

/** Stateless, short-lived continuation codec backed by the credential crypto keyring/KMS. */
export class SourceContinuationCodec {
  constructor(
    private readonly crypto: SourceCredentialCrypto,
    private readonly now: () => number = Date.now,
  ) {}

  async seal(
    input: SourceContinuationContext & {
      kind: ConnectedSourceActionKind;
      resume: SourceJsonValue;
    },
  ): Promise<string> {
    assertResume(input.resume);
    if (!/^sha256:[a-f0-9]{64}$/.test(input.sourceStateDigest)) {
      throw new Error("Connected-source continuation state digest is invalid");
    }
    const payload: SourceContinuationPayload = {
      action: input.kind,
      expires_at: Math.floor(this.now() / 1_000) + TOKEN_TTL_SECONDS,
      resume: input.resume,
      source_state_digest: input.sourceStateDigest,
      v: TOKEN_VERSION,
    };
    const prepared = await this.crypto.prepareSeal(associatedData(input, input.kind));
    try {
      const sealed = await prepared.seal(JSON.stringify(payload));
      const token = Buffer.from(sealed).toString("base64url");
      if (token.length > MAX_TOKEN_BYTES) {
        throw new Error("Connected-source continuation exceeds its token size limit");
      }
      return token;
    } finally {
      prepared.destroy();
    }
  }

  async open(
    token: string,
    context: SourceContinuationContext,
  ): Promise<ConnectedSourceContinuation> {
    try {
      const sealed = tokenBytes(token);
      const plaintext = await this.crypto.open(sealed, associatedData(context, "review_import"));
      const payload = continuationPayload(plaintext, Math.floor(this.now() / 1_000));
      if (payload.source_state_digest !== context.sourceStateDigest) throw tokenError();
      return {
        expectedSourceStateDigest: payload.source_state_digest,
        kind: payload.action,
        resume: payload.resume,
      };
    } catch {
      throw tokenError();
    }
  }
}

function associatedData(
  context: Pick<SourceContinuationContext, "ownerUuid" | "source" | "vibeUuid">,
  action: ConnectedSourceActionKind,
): string {
  return `rhizome:source-continuation:v1:${context.ownerUuid}:${context.vibeUuid}:${context.source}:${action}`;
}

function tokenBytes(token: string): Uint8Array {
  if (token.length < 32 || token.length > MAX_TOKEN_BYTES || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw tokenError();
  }
  const bytes = Uint8Array.from(Buffer.from(token, "base64url"));
  if (Buffer.from(bytes).toString("base64url") !== token) throw tokenError();
  return bytes;
}

function continuationPayload(plaintext: string, now: number): SourceContinuationPayload {
  const value: unknown = JSON.parse(plaintext);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw tokenError();
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).some(
      (key) =>
        key !== "action" &&
        key !== "expires_at" &&
        key !== "resume" &&
        key !== "source_state_digest" &&
        key !== "v",
    ) ||
    Object.keys(payload).length !== 5 ||
    payload.v !== TOKEN_VERSION ||
    payload.action !== "review_import" ||
    !Number.isSafeInteger(payload.expires_at) ||
    (payload.expires_at as number) <= now ||
    (payload.expires_at as number) > now + TOKEN_TTL_SECONDS ||
    typeof payload.source_state_digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(payload.source_state_digest) ||
    !isSourceJsonValue(payload.resume)
  ) {
    throw tokenError();
  }
  assertResume(payload.resume);
  return payload as unknown as SourceContinuationPayload;
}

function assertResume(value: unknown): asserts value is SourceJsonValue {
  if (!isSourceJsonValue(value)) {
    throw new Error("Connected-source continuation resume is not serializable JSON");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_RESUME_BYTES) {
    throw new Error("Connected-source continuation resume exceeds its size limit");
  }
}

function isSourceJsonValue(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
): value is SourceJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (!value || typeof value !== "object" || seen.has(value) || depth >= MAX_RESUME_DEPTH) {
    return false;
  }
  seen.add(value);
  const serializable = Array.isArray(value)
    ? value.every((entry) => isSourceJsonValue(entry, seen, depth + 1))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((entry) => isSourceJsonValue(entry, seen, depth + 1));
  seen.delete(value);
  return serializable;
}

function tokenError(): SourceContinuationTokenError {
  return new SourceContinuationTokenError();
}
