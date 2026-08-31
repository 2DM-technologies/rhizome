import {
  CredentialConnectionError,
  type OAuth2PkceConnectionDefinition,
  type OAuth2PkceCredentialResult,
} from "../../../connected-sources/types.ts";
import type { XAccountIdentity } from "../contracts.ts";
import {
  XApiClient,
  XApiClientError,
  type XApiClientOptions,
  type XApiTokenResponse,
} from "./client.ts";
import type { XOAuthSettings } from "./config.ts";

export const X_OAUTH_SCOPES = Object.freeze([
  "tweet.read",
  "users.read",
  "offline.access",
] as const);
export const X_OAUTH_TOKEN_FORMAT = "rhizome.x-oauth-token-set@1" as const;

const MAX_SECRET_BYTES = 64 * 1_024;
const REFRESH_EARLY_SECONDS = 5 * 60;
const ORPHAN_REVOKE_TIMEOUT_MS = 3_000;
const TOKEN = /^[\x21-\x7e]{1,16384}$/u;
const DECIMAL_ID = /^[0-9]{1,19}$/u;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/u;

export interface XOAuthCredential {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAtEpoch?: number;
  readonly account: XAccountIdentity;
}

export interface XOAuthConnectionOptions extends XApiClientOptions {
  readonly client?: XApiClient;
  readonly now?: () => Date;
}

export function createXOAuthConnection(
  settings: XOAuthSettings,
  options: XOAuthConnectionOptions = {},
): OAuth2PkceConnectionDefinition {
  const client = options.client ?? new XApiClient(options);
  const now = options.now ?? (() => new Date());
  return {
    mode: "oauth2_pkce",
    authorizationUrl({ callbackUrl, codeChallenge, state }) {
      const url = new URL(client.endpoints.authorization);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", settings.clientId);
      url.searchParams.set("redirect_uri", callbackUrl);
      url.searchParams.set("scope", X_OAUTH_SCOPES.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },
    async exchange({ callbackUrl, code, codeVerifier, signal }) {
      let token: XApiTokenResponse | undefined;
      try {
        token = await client.exchangeAuthorizationCode(settings, {
          callbackUrl,
          code,
          codeVerifier,
          signal,
        });
        assertExactScopes(token.scopes);
        assertOfflineToken(token);
        const identity = await client.getAuthenticatedUser(token.accessToken, signal);
        const account = { id: identity.id, handle: identity.username, name: identity.name };
        return credentialResult(tokenCredential(token, identity, now()), account);
      } catch (error) {
        if (token) {
          await revokeIssuedToken(client, settings, token).catch(() => undefined);
        }
        throw connectionError(error, "X could not complete authorization");
      }
    },
    callbackError({ error }) {
      return new CredentialConnectionError(
        callbackErrorCode(error),
        "rejected",
        error === "access_denied"
          ? "X authorization was cancelled or denied"
          : "X could not complete authorization",
      );
    },
    async refresh(secret, { signal }) {
      const previous = parseXOAuthSecret(secret);
      const expiresAt = previous.expiresAtEpoch;
      if (expiresAt === undefined || expiresAt > epochSeconds(now()) + REFRESH_EARLY_SECONDS) {
        return undefined;
      }
      if (!previous.refreshToken) {
        throw new CredentialConnectionError(
          "x_reconnect_required",
          "rejected",
          "The X connection has expired and must be connected again",
        );
      }
      try {
        const refreshed = await client.refreshAccessToken(settings, previous.refreshToken, signal);
        assertExactScopes(refreshed.scopes);
        if (!refreshed.expiresInSeconds) {
          throw new CredentialConnectionError(
            "x_refresh_invalid",
            "ambiguous",
            "X returned an invalid refreshed authorization",
          );
        }
        const credential: XOAuthCredential = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? previous.refreshToken,
          expiresAtEpoch: epochSeconds(now()) + refreshed.expiresInSeconds,
          account: previous.account,
        };
        return credentialResult(credential, previous.account);
      } catch (error) {
        throw connectionError(error, "X could not refresh authorization");
      }
    },
    async revoke(secret, { signal }) {
      const credential = parseXOAuthSecret(secret);
      const tokens = [
        ...new Set([credential.refreshToken, credential.accessToken].filter(Boolean)),
      ] as string[];
      let failure: unknown;
      for (const token of tokens) {
        try {
          await client.revokeToken(settings, token, signal);
        } catch (error) {
          failure ??= error;
          if (signal.aborted) throw signal.reason;
        }
      }
      if (failure) throw connectionError(failure, "X could not revoke authorization");
    },
  };
}

/** Provider-internal opener for the opaque token-set string stored by the generic credential vault. */
export function parseXOAuthSecret(secret: string): XOAuthCredential {
  if (!secret || Buffer.byteLength(secret) > MAX_SECRET_BYTES) throw invalidStoredSecret();
  let value: unknown;
  try {
    value = JSON.parse(secret);
  } catch {
    throw invalidStoredSecret();
  }
  if (!record(value) || value.format !== X_OAUTH_TOKEN_FORMAT || !record(value.account)) {
    throw invalidStoredSecret();
  }
  const allowed = new Set([
    "format",
    "access_token",
    "refresh_token",
    "expires_at_epoch",
    "scope",
    "account",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalidStoredSecret();
  const accountAllowed = new Set(["id", "handle", "name"]);
  if (Object.keys(value.account).some((key) => !accountAllowed.has(key)))
    throw invalidStoredSecret();
  if (
    typeof value.access_token !== "string" ||
    !TOKEN.test(value.access_token) ||
    (value.refresh_token !== undefined &&
      (typeof value.refresh_token !== "string" || !TOKEN.test(value.refresh_token))) ||
    !Array.isArray(value.scope) ||
    value.scope.some((scope) => typeof scope !== "string") ||
    !exactScopes(value.scope as string[]) ||
    !DECIMAL_ID.test(String(value.account.id ?? "")) ||
    (value.account.handle !== undefined &&
      (typeof value.account.handle !== "string" || !X_HANDLE.test(value.account.handle))) ||
    (value.account.name !== undefined &&
      (typeof value.account.name !== "string" ||
        Buffer.byteLength(value.account.name) > 256 ||
        /[\u0000-\u001f\u007f]/u.test(value.account.name))) ||
    (value.expires_at_epoch !== undefined &&
      (!Number.isSafeInteger(value.expires_at_epoch) || Number(value.expires_at_epoch) <= 0))
  ) {
    throw invalidStoredSecret();
  }
  return {
    accessToken: value.access_token,
    ...(typeof value.refresh_token === "string" ? { refreshToken: value.refresh_token } : {}),
    ...(typeof value.expires_at_epoch === "number"
      ? { expiresAtEpoch: value.expires_at_epoch }
      : {}),
    account: {
      id: String(value.account.id),
      ...(typeof value.account.handle === "string" ? { handle: value.account.handle } : {}),
      ...(typeof value.account.name === "string" ? { name: value.account.name } : {}),
    },
  };
}

export function serializeXOAuthSecret(credential: XOAuthCredential): string {
  const value = JSON.stringify({
    format: X_OAUTH_TOKEN_FORMAT,
    access_token: credential.accessToken,
    ...(credential.refreshToken ? { refresh_token: credential.refreshToken } : {}),
    ...(credential.expiresAtEpoch ? { expires_at_epoch: credential.expiresAtEpoch } : {}),
    scope: X_OAUTH_SCOPES,
    account: {
      id: credential.account.id,
      ...(credential.account.handle ? { handle: credential.account.handle } : {}),
      ...(credential.account.name !== undefined ? { name: credential.account.name } : {}),
    },
  });
  parseXOAuthSecret(value);
  return value;
}

function tokenCredential(
  token: XApiTokenResponse,
  identity: { id: string; username: string; name: string },
  now: Date,
): XOAuthCredential {
  return {
    accessToken: token.accessToken,
    ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
    ...(token.expiresInSeconds
      ? { expiresAtEpoch: epochSeconds(now) + token.expiresInSeconds }
      : {}),
    account: { id: identity.id, handle: identity.username, name: identity.name },
  };
}

function credentialResult(
  credential: XOAuthCredential,
  account: XAccountIdentity,
): OAuth2PkceCredentialResult {
  return {
    secret: serializeXOAuthSecret(credential),
    publicMetadata: {
      account_id: account.id,
      ...(account.handle ? { account_handle: account.handle } : {}),
      ...(account.name !== undefined ? { account_name: account.name } : {}),
    },
  };
}

async function revokeTokenSet(
  client: XApiClient,
  settings: XOAuthSettings,
  token: XApiTokenResponse,
  signal: AbortSignal,
): Promise<void> {
  let failure: unknown;
  for (const value of [
    ...new Set([token.refreshToken, token.accessToken].filter(Boolean)),
  ] as string[]) {
    try {
      await client.revokeToken(settings, value, signal);
    } catch (error) {
      failure ??= error;
      if (signal.aborted) throw signal.reason;
    }
  }
  if (failure) throw failure;
}

async function revokeIssuedToken(
  client: XApiClient,
  settings: XOAuthSettings,
  token: XApiTokenResponse,
): Promise<void> {
  await revokeTokenSet(client, settings, token, AbortSignal.timeout(ORPHAN_REVOKE_TIMEOUT_MS));
}

function assertExactScopes(scopes: readonly string[] | undefined): void {
  if (!scopes || !exactScopes(scopes)) {
    throw new CredentialConnectionError(
      "x_scope_mismatch",
      "rejected",
      "X did not grant the exact required authorization scopes",
    );
  }
}

function assertOfflineToken(token: XApiTokenResponse): void {
  if (!token.refreshToken || !token.expiresInSeconds) {
    throw new CredentialConnectionError(
      "x_offline_token_incomplete",
      "ambiguous",
      "X did not return a complete offline authorization",
    );
  }
}

function exactScopes(scopes: readonly string[]): boolean {
  return (
    scopes.length === X_OAUTH_SCOPES.length &&
    X_OAUTH_SCOPES.every((scope) => scopes.includes(scope)) &&
    new Set(scopes).size === scopes.length
  );
}

function connectionError(error: unknown, fallback: string): CredentialConnectionError {
  if (error instanceof CredentialConnectionError) return error;
  if (error instanceof XApiClientError) {
    const rejected = ["token_rejected", "unauthorized"].includes(error.kind);
    return new CredentialConnectionError(
      rejected ? "x_authorization_rejected" : "x_provider_failure",
      rejected ? "rejected" : "ambiguous",
      rejected ? "X authorization is invalid or expired" : fallback,
    );
  }
  return new CredentialConnectionError("x_provider_failure", "ambiguous", fallback);
}

function callbackErrorCode(value: string): string {
  return value === "access_denied" ? "x_authorization_denied" : "x_authorization_failed";
}

function invalidStoredSecret(): CredentialConnectionError {
  return new CredentialConnectionError(
    "x_reconnect_required",
    "rejected",
    "The stored X connection is invalid and must be connected again",
  );
}

function epochSeconds(value: Date): number {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("X OAuth clock returned an invalid date");
  return Math.floor(timestamp / 1_000);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
