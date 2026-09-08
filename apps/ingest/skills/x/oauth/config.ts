const ENABLED_VALUE = "true";

export const X_OAUTH_CLIENT_ID_ENV = "RHIZOME_X_OAUTH_CLIENT_ID" as const;
export const X_OAUTH_CLIENT_SECRET_ENV = "RHIZOME_X_OAUTH_CLIENT_SECRET" as const;
export const X_OAUTH_BUDGET_ENABLED_ENV = "RHIZOME_X_OAUTH_BUDGET_ENABLED" as const;

export interface XOAuthSettings {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly budgetEnabled: boolean;
}

/**
 * X is active only with operator configuration and explicit provider-budget opt-in. When client
 * configuration remains but budget is off, its adapter stays lifecycle-only so existing tokens
 * can still be revoked. A wholly unset environment remains a supported state.
 */
export function loadXOAuthSettings(
  environment: Record<string, string | undefined> = process.env,
): XOAuthSettings | undefined {
  const budget = environment[X_OAUTH_BUDGET_ENABLED_ENV]?.trim();
  if (budget !== undefined && budget !== "" && budget !== ENABLED_VALUE && budget !== "false") {
    throw new Error(`${X_OAUTH_BUDGET_ENABLED_ENV} must be either true or false`);
  }

  const clientId = environment[X_OAUTH_CLIENT_ID_ENV]?.trim();
  const clientSecret = environment[X_OAUTH_CLIENT_SECRET_ENV]?.trim();
  if (clientSecret && !clientId) {
    throw new Error(`${X_OAUTH_CLIENT_SECRET_ENV} requires ${X_OAUTH_CLIENT_ID_ENV}`);
  }
  if (!clientId && budget !== ENABLED_VALUE) {
    return undefined;
  }
  if (!clientId) {
    throw new Error(`${X_OAUTH_CLIENT_ID_ENV} is required when ${X_OAUTH_BUDGET_ENABLED_ENV}=true`);
  }
  if (!/^[\x21-\x7e]{1,512}$/u.test(clientId) || clientId.includes(":")) {
    throw new Error(`${X_OAUTH_CLIENT_ID_ENV} is invalid`);
  }
  if (clientSecret !== undefined && !/^[\x21-\x7e]{1,4096}$/u.test(clientSecret)) {
    throw new Error(`${X_OAUTH_CLIENT_SECRET_ENV} is invalid`);
  }

  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    budgetEnabled: budget === ENABLED_VALUE,
  };
}

export function isXOAuthConfigured(
  settings: XOAuthSettings | undefined,
): settings is XOAuthSettings {
  return settings !== undefined;
}
