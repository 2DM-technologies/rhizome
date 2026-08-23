import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { logger } from "hono/logger";

import { devAuth } from "./auth.ts";
import type { BlobStore } from "./blobs/index.ts";
import type { ServerConfig } from "./config.ts";
import type { Database } from "./db/index.ts";
import { notFound, Problem, problemResponse } from "./errors.ts";
import { createMediaElementRoutes } from "./routes/media-elements.ts";
import { createMediaObjectRoutes } from "./routes/media-objects.ts";
import { createOperationRoutes } from "./routes/operations.ts";
import { createOriginRoutes } from "./routes/origins.ts";
import type { AppEnvironment } from "./routes/types.ts";
import { createVibeRoutes } from "./routes/vibes.ts";
import { IdentityService } from "./services/identities.ts";

export interface AppDependencies {
  config: ServerConfig;
  db: Database;
  blobs: BlobStore;
}

export function createApp({ db, blobs }: AppDependencies) {
  const identityService = new IdentityService(db);
  const app = new Hono<AppEnvironment>();

  app.use(logger());
  app.use(
    "*",
    createMiddleware(async (context, next) => {
      await next();
      context.header("Access-Control-Allow-Origin", context.req.header("Origin") ?? "*");
      context.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, If-Match, X-Rnet-Kind, X-Rnet-Label, X-Rnet-Vibe",
      );
      context.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      context.header("Vary", "Origin");
    }),
  );
  app.options("*", (context) => context.body(null, 204));
  app.use("/rnet/*", devAuth);

  app.onError((error, context) => {
    if (error instanceof Problem) return problemResponse(context, error);
    console.error(error);
    return problemResponse(
      context,
      new Problem(500, "internal_error", "Internal error", "The store could not complete the request"),
    );
  });
  app.notFound((context) => problemResponse(context, notFound("Route")));

  app.get("/health", (context) => context.json({ ok: true, service: "rhizome" }));
  app.route("/rnet/v0/vibes", createVibeRoutes(db));
  app.route("/rnet/v0/objects", createMediaObjectRoutes(db));
  app.route("/rnet/v0/elements", createMediaElementRoutes(db, blobs));
  app.route("/rnet/v0/origins", createOriginRoutes(db, blobs));
  app.route("/rnet/v0/operations", createOperationRoutes(db));

  return { app, identityService };
}
