import {
  SOURCE_SKILL_ID_PATTERN,
  sourceConnectionAttemptDocumentSchema,
  startSourceConnectionRequestSchema,
  startSourceConnectionResponseSchema,
} from "@rhizome/store-contract";

import type { CredentialedSourceCatalog } from "../../../ingest/connected-sources/types.ts";
import type { Database } from "../db/index.ts";
import type { SourceCredentialCrypto } from "../services/source-credential-crypto.ts";
import {
  SourceConnectionService,
  clearSourceConnectionBindingCookie,
} from "../services/source-connection-service.ts";
import {
  ProblemSchema,
  RecordIdParamsSchema,
  jsonSchema,
  withResponseHeaders,
} from "./contracts.ts";
import { createRhizomeRouter } from "./rhizome-router.ts";

const SourceConnectionAttemptDocumentSchema = jsonSchema(sourceConnectionAttemptDocumentSchema);
const StartSourceConnectionRequestSchema = jsonSchema(startSourceConnectionRequestSchema);
const StartSourceConnectionResponseSchema = jsonSchema(startSourceConnectionResponseSchema);
const SourceSkillParamsSchema = jsonSchema({
  type: "object",
  required: ["skill_id"],
  properties: { skill_id: { type: "string", pattern: SOURCE_SKILL_ID_PATTERN } },
  additionalProperties: false,
});
const OAuthCallbackQuerySchema = jsonSchema({
  type: "object",
  required: ["state"],
  properties: {
    state: { type: "string", minLength: 32, maxLength: 512, pattern: "^\\S+$" },
    code: { type: "string", minLength: 1, maxLength: 8_192, pattern: "^\\S+$" },
    error: { type: "string", minLength: 1, maxLength: 256 },
    error_description: { type: "string", maxLength: 2_048 },
  },
  oneOf: [
    {
      required: ["code"],
      properties: {
        code: { type: "string", minLength: 1, maxLength: 8_192, pattern: "^\\S+$" },
        error: false,
        error_description: false,
      },
    },
    {
      required: ["error"],
      properties: {
        code: false,
        error: { type: "string", minLength: 1, maxLength: 256 },
        error_description: { type: "string", maxLength: 2_048 },
      },
    },
  ],
  additionalProperties: false,
});

const CacheControlHeader = {
  type: "string",
  const: "no-store",
  description: "Prevents OAuth request and response material from being cached.",
} as const;
const ReferrerPolicyHeader = {
  type: "string",
  const: "no-referrer",
  description: "Prevents callback query values from being sent as a referrer.",
} as const;
const SetCookieHeader = {
  type: "string",
  description: "Sets or clears the HttpOnly browser binding for this OAuth attempt.",
} as const;
const LocationHeader = {
  type: "string",
  format: "uri",
  description: "A server-approved host URL containing only the opaque connection attempt id.",
} as const;

export function createSourceConnectionRoutes(
  db: Database,
  catalog: CredentialedSourceCatalog,
  credentialCrypto: SourceCredentialCrypto,
  options: { baseUrl: string; allowedReturnOrigins: readonly string[] },
) {
  const router = createRhizomeRouter();
  const callbackUrl = `${options.baseUrl.replace(/\/$/u, "")}/rnet/v0/source-connections/oauth/callback`;
  const callbackFailureUrl = sanitizedCallbackFailureUrl(options.allowedReturnOrigins);

  router.hono.use("/oauth/callback", async (context, next) => {
    context.header("Cache-Control", "no-store");
    context.header("Referrer-Policy", "no-referrer");
    try {
      await next();
      // Contract validators return a problem response rather than throwing. OAuth callback
      // query values are provider-controlled secrets, so even malformed callbacks must leave
      // through the same fixed, query-free redirect boundary as thrown failures.
      if (context.res.status >= 400 && callbackFailureUrl) {
        context.res = context.redirect(callbackFailureUrl, 303);
        return;
      }
    } catch (error) {
      if (!callbackFailureUrl) throw error;
      context.res = context.redirect(callbackFailureUrl, 303);
    }
  });

  router.post(
    "/:skill_id/oauth",
    {
      operationId: "startSourceOAuthConnection",
      auth: "user",
      request: { param: SourceSkillParamsSchema, json: StartSourceConnectionRequestSchema },
      responses: {
        201: withResponseHeaders(StartSourceConnectionResponseSchema, {
          "Cache-Control": CacheControlHeader,
          "Set-Cookie": SetCookieHeader,
        }),
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
        429: ProblemSchema,
      },
    },
    async (context) => {
      const connection = new SourceConnectionService({
        db,
        actor: context.get("actor"),
        baseUrl: options.baseUrl,
        allowedReturnOrigins: options.allowedReturnOrigins,
        catalog,
        credentialCrypto,
      });
      const started = await connection.start(
        context.req.valid("param").skill_id,
        context.req.valid("json"),
      );
      context.header("Cache-Control", "no-store");
      context.header("Set-Cookie", started.browserBindingCookie);
      return context.json(started.attempt, 201);
    },
  );

  router.get(
    "/oauth/callback",
    {
      operationId: "completeSourceOAuthConnection",
      request: { query: OAuthCallbackQuerySchema },
      responses: {
        303: withResponseHeaders(null, {
          "Cache-Control": CacheControlHeader,
          Location: LocationHeader,
          "Referrer-Policy": ReferrerPolicyHeader,
          "Set-Cookie": SetCookieHeader,
        }),
        422: withResponseHeaders(ProblemSchema, {
          "Cache-Control": CacheControlHeader,
          "Referrer-Policy": ReferrerPolicyHeader,
          "Set-Cookie": SetCookieHeader,
        }),
      },
    },
    async (context) => {
      const query = context.req.valid("query");
      const connection = new SourceConnectionService({
        db,
        actor: context.get("actor"),
        baseUrl: options.baseUrl,
        allowedReturnOrigins: options.allowedReturnOrigins,
        catalog,
        credentialCrypto,
      });
      let callback: Parameters<SourceConnectionService["complete"]>[0];
      if (typeof query.code === "string") {
        callback = { state: query.state, code: query.code };
      } else if (typeof query.error === "string") {
        callback = {
          state: query.state,
          error: query.error,
          ...(query.error_description ? { errorDescription: query.error_description } : {}),
        };
      } else {
        throw new Error("Validated OAuth callback has no result");
      }
      const completed = await connection.complete(callback, context.req.header("Cookie"));
      context.header(
        "Set-Cookie",
        clearSourceConnectionBindingCookie(completed.attemptUuid, callbackUrl),
      );
      return context.redirect(completed.returnUrl, 303);
    },
  );

  router.get(
    "/:id",
    {
      operationId: "getSourceConnectionAttempt",
      auth: "user",
      request: { param: RecordIdParamsSchema },
      responses: {
        200: SourceConnectionAttemptDocumentSchema,
        401: ProblemSchema,
        403: ProblemSchema,
        404: ProblemSchema,
        422: ProblemSchema,
      },
    },
    async (context) => {
      const connection = new SourceConnectionService({
        db,
        actor: context.get("actor"),
        baseUrl: options.baseUrl,
        allowedReturnOrigins: options.allowedReturnOrigins,
        catalog,
        credentialCrypto,
      });
      return context.json(await connection.getOwned(context.req.valid("param").id));
    },
  );

  return router;
}

function sanitizedCallbackFailureUrl(allowedOrigins: readonly string[]): string | undefined {
  for (const value of allowedOrigins) {
    try {
      const origin = new URL(value);
      if (
        (origin.protocol === "https:" || origin.protocol === "http:") &&
        origin.href === origin.origin + "/"
      ) {
        const destination = new URL("/imports", origin);
        destination.searchParams.set("source_connection_error", "callback_failed");
        return destination.href;
      }
    } catch {
      // Ignore malformed deployment configuration here; start() rejects it as a return origin.
    }
  }
  return undefined;
}
