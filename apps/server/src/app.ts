import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import {
  ConnectedSourceError,
  type CredentialedSourceCatalog,
} from "../../ingest/connected-sources/types.ts";
import type { FileSourceCatalog } from "../../ingest/file-sources/types.ts";
import type {
  PublicAssetFetcher,
  PublicRemoteSourceCatalog,
} from "../../ingest/public-sources/types.ts";
import { createCredentialedSourceCatalog } from "../../ingest/src/credentialed-source-catalog.ts";
import { createPublicRemoteSourceCatalog } from "../../ingest/src/public-remote-source-catalog.ts";
import {
  createSourceSkillManifestCatalog,
  installedFileSourceSkills,
} from "../../ingest/src/source-skill-catalog.ts";
import { devAuth } from "./auth.ts";
import type { BlobStore } from "./blobs/index.ts";
import type { ServerConfig } from "./config.ts";
import type { Database } from "./db/index.ts";
import { notFound, Problem, problemResponse } from "./errors.ts";
import { createOpenApiDocument } from "./openapi.ts";
import { createSafePublicAssetFetcher, SafePublicFetcher } from "./public-fetch/index.ts";
import { createMediaElementRoutes } from "./routes/media-elements.ts";
import { createIngestionSourceRoutes } from "./routes/ingestion-sources.ts";
import { createPendingImportRoutes } from "./routes/imports.ts";
import { createMediaObjectRoutes } from "./routes/media-objects.ts";
import { createOperationRoutes } from "./routes/operations.ts";
import { createOriginRoutes } from "./routes/origins.ts";
import { createSourceCredentialRoutes } from "./routes/source-credentials.ts";
import { createSourceConnectionRoutes } from "./routes/source-connections.ts";
import { createSourceSkillRoutes } from "./routes/source-skills.ts";
import type { RegisteredRhizomeRoute } from "./routes/rhizome-router.ts";
import type { AppEnvironment } from "./routes/types.ts";
import { createVibeRoutes } from "./routes/vibes.ts";
import type { SourceCredentialCrypto } from "./services/source-credential-crypto.ts";
import { createSourceCredentialCrypto } from "./services/source-credential-crypto-factory.ts";

export interface AppDependencies {
  config: ServerConfig;
  db: Database;
  blobs: BlobStore;
  credentialedSources?: CredentialedSourceCatalog;
  fileSources?: FileSourceCatalog;
  publicAssetFetcher?: PublicAssetFetcher;
  publicRemoteSources?: PublicRemoteSourceCatalog;
  sourceCredentialCrypto?: SourceCredentialCrypto;
}

export function createApp({
  config,
  db,
  blobs,
  credentialedSources,
  fileSources,
  publicAssetFetcher,
  publicRemoteSources,
  sourceCredentialCrypto,
}: AppDependencies) {
  const app = new Hono<AppEnvironment>();
  const resolvedCredentialedSources =
    credentialedSources ?? createCredentialedSourceCatalog(config.sourceCredentials.sources);
  const resolvedFileSources = fileSources ?? installedFileSourceSkills;
  const resolvedPublicRemoteSources =
    publicRemoteSources ??
    createPublicRemoteSourceCatalog({
      assetFetch: publicAssetFetcher ?? createSafePublicAssetFetcher(new SafePublicFetcher()),
    });
  const sourceSkillManifests = createSourceSkillManifestCatalog(
    resolvedFileSources,
    resolvedCredentialedSources,
    resolvedPublicRemoteSources,
  );
  const credentialCrypto =
    sourceCredentialCrypto ?? createSourceCredentialCrypto(config.sourceCredentials.keyProvider);

  const requestLogger = logger();
  app.use("*", async (context, next) => {
    // OAuth providers deliver authorization codes in the callback query. Do not allow the
    // ordinary request logger to serialize that URL, even transiently.
    if (context.req.path === "/rnet/v0/source-connections/oauth/callback") {
      await next();
      return;
    }
    await requestLogger(context, next);
  });
  app.use(
    "*",
    createMiddleware(async (context, next) => {
      const origin = context.req.header("Origin");
      if (origin && config.allowedOrigins.includes(origin)) {
        context.header("Access-Control-Allow-Origin", origin);
        context.header("Access-Control-Allow-Credentials", "true");
      }
      context.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Rnet-Kind, X-Rnet-Label",
      );
      context.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      context.header("Vary", "Origin");

      const contentLength = Number(context.req.header("Content-Length"));
      if (Number.isFinite(contentLength) && contentLength > config.maxRequestBodySize) {
        throw new Problem(
          413,
          "payload_too_large",
          "Payload too large",
          `Request bodies are limited to ${config.maxRequestBodySize} bytes`,
        );
      }
      await next();
    }),
  );
  app.options("*", (context) => context.body(null, 204));
  if (config.authMode === "dev") app.use("/rnet/*", devAuth);

  app.onError((error, context) => {
    if (error instanceof ConnectedSourceError) {
      return problemResponse(
        context,
        new Problem(error.status, error.code, error.title, error.detail, error.extensions),
      );
    }
    if (error instanceof Problem) return problemResponse(context, error);
    if (error instanceof HTTPException && error.status === 400) {
      return problemResponse(
        context,
        new Problem(422, "schema_violation", "Invalid request", error.message),
      );
    }
    console.error(error);
    return problemResponse(
      context,
      new Problem(
        500,
        "internal_error",
        "Internal error",
        "The store could not complete the request",
      ),
    );
  });
  app.notFound((context) => problemResponse(context, notFound("Route")));

  app.get("/health", (context) => context.json({ ok: true, service: "rhizome" }));
  const routeGroups = [
    {
      basePath: "/rnet/v0/imports",
      router: createPendingImportRoutes(db, blobs, {
        baseUrl: config.baseUrl,
        credentialCrypto,
        credentialedSources: resolvedCredentialedSources,
        fileSources: resolvedFileSources,
        publicRemoteSources: resolvedPublicRemoteSources,
      }),
    },
    {
      basePath: "/rnet/v0/vibes",
      router: createVibeRoutes(db, blobs, {
        baseUrl: config.baseUrl,
        credentialCrypto,
        credentialedSources: resolvedCredentialedSources,
        fileSources: resolvedFileSources,
        publicRemoteSources: resolvedPublicRemoteSources,
      }),
    },
    {
      basePath: "/rnet/v0/ingestion-sources",
      router: createIngestionSourceRoutes(
        db,
        resolvedFileSources,
        resolvedCredentialedSources,
        resolvedPublicRemoteSources,
      ),
    },
    {
      basePath: "/rnet/v0/source-connections",
      router: createSourceConnectionRoutes(db, resolvedCredentialedSources, credentialCrypto, {
        baseUrl: config.baseUrl,
        allowedReturnOrigins: config.allowedOrigins,
      }),
    },
    {
      basePath: "/rnet/v0/source-credentials",
      router: createSourceCredentialRoutes(db, resolvedCredentialedSources, credentialCrypto),
    },
    {
      basePath: "/rnet/v0/source-skills",
      router: createSourceSkillRoutes(sourceSkillManifests),
    },
    { basePath: "/rnet/v0/objects", router: createMediaObjectRoutes(db, blobs) },
    {
      basePath: "/rnet/v0/elements",
      router: createMediaElementRoutes(db, blobs, config.baseUrl),
    },
    {
      basePath: "/rnet/v0/origins",
      router: createOriginRoutes(db, blobs, config.baseUrl),
    },
    { basePath: "/rnet/v0/operations", router: createOperationRoutes(db, blobs) },
  ];
  const openApiRoutes: RegisteredRhizomeRoute[] = [];
  for (const { basePath, router } of routeGroups) {
    app.route(basePath, router.hono);
    openApiRoutes.push(
      ...router.routes.map((route) => ({
        ...route,
        path: route.path === "/" ? basePath : `${basePath}${route.path}`,
      })),
    );
  }
  const openApiDocument = createOpenApiDocument(openApiRoutes);
  app.get("/rnet/v0/openapi.json", (context) => context.json(openApiDocument));

  return { app, openApiDocument };
}
