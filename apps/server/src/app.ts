import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { devAuth } from "./auth.ts";
import type { BlobStore } from "./blobs/index.ts";
import type { ServerConfig } from "./config.ts";
import type { Database } from "./db/index.ts";
import { notFound, Problem, problemResponse } from "./errors.ts";
import { createOpenApiDocument } from "./openapi.ts";
import { createMediaElementRoutes } from "./routes/media-elements.ts";
import { createMediaObjectRoutes } from "./routes/media-objects.ts";
import { createOperationRoutes } from "./routes/operations.ts";
import { createOriginRoutes } from "./routes/origins.ts";
import type { RegisteredRnetRoute } from "./routes/rnet-router.ts";
import type { AppEnvironment } from "./routes/types.ts";
import { createVibeRoutes } from "./routes/vibes.ts";

export interface AppDependencies {
  config: ServerConfig;
  db: Database;
  blobs: BlobStore;
}

export function createApp({ config, db, blobs }: AppDependencies) {
  const app = new Hono<AppEnvironment>();

  app.use(logger());
  app.use(
    "*",
    createMiddleware(async (context, next) => {
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
      const origin = context.req.header("Origin");
      if (origin && config.allowedOrigins.includes(origin)) {
        context.header("Access-Control-Allow-Origin", origin);
      }
      context.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, If-Match, X-Rnet-Kind, X-Rnet-Label",
      );
      context.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      context.header("Vary", "Origin");
    }),
  );
  app.options("*", (context) => context.body(null, 204));
  if (config.authMode === "dev") app.use("/rnet/*", devAuth);

  app.onError((error, context) => {
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
    { basePath: "/rnet/v0/vibes", router: createVibeRoutes(db) },
    { basePath: "/rnet/v0/objects", router: createMediaObjectRoutes(db, blobs) },
    { basePath: "/rnet/v0/elements", router: createMediaElementRoutes(db, blobs) },
    { basePath: "/rnet/v0/origins", router: createOriginRoutes(db, blobs) },
    { basePath: "/rnet/v0/operations", router: createOperationRoutes(db) },
  ];
  const openApiRoutes: RegisteredRnetRoute[] = [];
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
